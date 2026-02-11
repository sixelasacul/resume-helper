import chalk from "chalk";
import type { ResumeConfig } from "../types/index.js";
import { saveResumeConfig } from "../utils/config.js";
import type {
  AnyPlugin,
  PluginContentSection,
  PluginOutputMap,
  PluginOutputs,
  DepsFor,
  PromptConfigOptions,
} from "./types.js";

/**
 * PluginManager orchestrates plugin execution
 *
 * Responsibilities:
 * 1. Register plugins
 * 2. Topologically sort plugins by dependencies
 * 3. Run config prompts for all plugins
 * 4. Execute plugins in dependency order
 * 5. Aggregate content sections
 * 6. Collect sensitive config keys from plugins
 */
export class PluginManager {
  private plugins: Map<string, AnyPlugin> = new Map();
  private sortedPlugins: AnyPlugin[] = [];

  /**
   * Register a plugin
   */
  register(plugin: AnyPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin with id '${plugin.id}' is already registered`);
    }
    this.plugins.set(plugin.id, plugin);
    this.sortedPlugins = []; // Invalidate cache
  }

  /**
   * Get all registered plugins in dependency order
   */
  getPlugins(): AnyPlugin[] {
    if (this.sortedPlugins.length === 0 && this.plugins.size > 0) {
      this.sortedPlugins = this.topologicalSort();
    }
    return this.sortedPlugins;
  }

  /**
   * Get all sensitive config keys declared by plugins.
   * Used by config command to mask values in output.
   */
  getSensitiveKeys(): Set<keyof ResumeConfig> {
    const keys = new Set<keyof ResumeConfig>();
    for (const plugin of this.plugins.values()) {
      if (plugin.sensitiveConfigKeys) {
        for (const key of plugin.sensitiveConfigKeys) {
          keys.add(key);
        }
      }
    }
    return keys;
  }

  /**
   * Run configuration prompts for all plugins
   * Saves config after each plugin in case user cancels
   */
  async runConfigPrompts(
    config: ResumeConfig,
    options?: PromptConfigOptions,
  ): Promise<ResumeConfig> {
    let currentConfig = config;

    for (const plugin of this.getPlugins()) {
      try {
        const updatedConfig = await plugin.promptForConfig(currentConfig, options);
        if (updatedConfig !== currentConfig) {
          currentConfig = updatedConfig;
          await saveResumeConfig(currentConfig);
        }
      } catch (error) {
        // Re-throw cancellation errors to stop the flow
        if (error instanceof Error && error.message === "Configuration cancelled") {
          throw error;
        }
        console.error(
          chalk.red(
            `[${plugin.id}] Config prompt failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          ),
        );
        // Continue with other plugins for non-cancellation errors
      }
    }

    return currentConfig;
  }

  /**
   * Execute all plugins and collect content sections
   */
  async execute(config: ResumeConfig): Promise<PluginContentSection[]> {
    const outputs: PluginOutputs = {};
    const allSections: PluginContentSection[] = [];

    console.log(chalk.blue(`\nExecuting ${this.plugins.size} plugins...`));

    for (const plugin of this.getPlugins()) {
      // Build deps object with only what this plugin declared in `needs`
      const deps = this.buildDeps(plugin.needs, outputs);

      // Check if plugin can run
      if (!plugin.canRun(config, deps)) {
        console.log(chalk.dim(`  [${plugin.id}] Skipping (canRun returned false)`));
        continue;
      }

      console.log(chalk.blue(`  [${plugin.id}] ${plugin.name}...`));

      try {
        const result = await plugin.generateContent(config, deps);

        if (result) {
          // Store output for dependent plugins
          // @ts-expect-error - TypeScript can't narrow the output type here
          outputs[plugin.id] = result.output;

          // Collect sections
          if (result.sections.length > 0) {
            allSections.push(...result.sections);
            console.log(chalk.green(`    Generated ${result.sections.length} section(s)`));
          } else {
            console.log(chalk.dim(`    No content generated`));
          }
        } else {
          console.log(chalk.dim(`    Plugin returned null`));
        }
      } catch (error) {
        console.error(
          chalk.yellow(`    Error: ${error instanceof Error ? error.message : "Unknown error"}`),
        );
        // Don't store output - dependent plugins will fail canRun()
      }
    }

    // Sort by priority (lower = higher priority = appears first)
    allSections.sort((a, b) => a.priority - b.priority);

    return allSections;
  }

  /**
   * Build dependencies object for a plugin
   * Only includes outputs for plugins declared in `needs`
   */
  private buildDeps<TNeeds extends (keyof PluginOutputMap)[]>(
    needs: TNeeds,
    outputs: PluginOutputs,
  ): DepsFor<TNeeds> {
    const deps: Partial<PluginOutputMap> = {};

    for (const depId of needs) {
      if (outputs[depId] !== undefined) {
        // @ts-expect-error - TypeScript can't narrow the type here
        deps[depId] = outputs[depId];
      }
    }

    return deps as DepsFor<TNeeds>;
  }

  /**
   * Topologically sort plugins by dependencies (Kahn's algorithm)
   * Plugins with no dependencies come first
   */
  private topologicalSort(): AnyPlugin[] {
    const sorted: AnyPlugin[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (pluginId: string) => {
      if (visited.has(pluginId)) return;
      if (visiting.has(pluginId)) {
        throw new Error(`Circular dependency detected involving plugin: ${pluginId}`);
      }

      const plugin = this.plugins.get(pluginId);
      if (!plugin) return;

      visiting.add(pluginId);

      // Visit dependencies first
      for (const depId of plugin.needs) {
        visit(depId as string);
      }

      visiting.delete(pluginId);
      visited.add(pluginId);
      sorted.push(plugin);
    };

    // Visit all plugins
    for (const pluginId of this.plugins.keys()) {
      visit(pluginId);
    }

    return sorted;
  }
}

// Singleton instance
export const pluginManager = new PluginManager();
