import * as p from "@clack/prompts";
import chalk from "chalk";
import { existsSync } from "fs";
import type { ResumeConfig } from "../../types/index.js";
import type { PluginPrompt, PluginResult, DepsFor, PromptConfigOptions } from "../types.js";
import { readMultilineInput } from "../../utils/input.js";

/**
 * Template Plugin
 *
 * Handles:
 * - Reading resume template example (from file or pasted content)
 * - Including template in AI prompt for style guidance
 */
export class TemplatePrompt implements PluginPrompt<"template", never[]> {
  readonly id = "template" as const;
  readonly name = "Resume Template";
  readonly needs: never[] = [];

  private templateContent: string | null = null;

  /**
   * Prompt for template (paste content or provide file path)
   */
  async promptForConfig(
    config: ResumeConfig,
    options?: PromptConfigOptions,
  ): Promise<ResumeConfig> {
    // Check for existing values
    const hasExistingPath =
      config.templatePath !== "$pending" && config.templatePath !== "$declined";
    const hasExistingContent =
      config.templateContent !== "$pending" && config.templateContent !== "$declined";

    // If has existing content, keep it (unless resetting)
    if (hasExistingContent && !options?.reset) {
      return config;
    }

    // If has existing file path, check if file still exists
    if (hasExistingPath && !options?.reset) {
      if (existsSync(config.templatePath)) {
        return config; // File exists, use it
      }
      // File doesn't exist anymore, need to re-prompt
      console.log(
        chalk.yellow(`\nTemplate file no longer exists: ${config.templatePath}`),
      );
    }

    // Skip if either was declined and not resetting
    if (!options?.reset) {
      if (config.templatePath === "$declined" || config.templateContent === "$declined") {
        return config;
      }
    }

    console.log(chalk.dim("\nResume template (optional - for style guidance):"));

    const templateChoice = await p.select({
      message: "How would you like to provide a template?",
      options: [
        { value: "paste", label: "Paste content directly" },
        { value: "file", label: "Provide a file path" },
        { value: "skip", label: "Skip (no template)" },
      ],
    });

    if (p.isCancel(templateChoice)) {
      throw new Error("Configuration cancelled");
    }

    if (templateChoice === "skip") {
      return {
        ...config,
        templatePath: "$declined",
        templateContent: "$declined",
      };
    }

    if (templateChoice === "paste") {
      console.log(chalk.dim("\nPaste your template content below."));

      const content = await readMultilineInput();

      if (!content.trim()) {
        console.log(chalk.yellow("No content provided, skipping template."));
        return {
          ...config,
          templatePath: "$declined",
          templateContent: "$declined",
        };
      }

      console.log(chalk.green(`  Template saved (${content.length} characters)`));

      return {
        ...config,
        templatePath: "$declined", // Not using file
        templateContent: content,
      };
    }

    // File path option
    const filePath = await p.text({
      message: "Path to resume template file",
      placeholder: "/path/to/template.md",
      defaultValue: hasExistingPath ? config.templatePath : "",
    });

    if (p.isCancel(filePath)) {
      throw new Error("Configuration cancelled");
    }

    if (!filePath.trim()) {
      return {
        ...config,
        templatePath: "$declined",
        templateContent: "$declined",
      };
    }

    if (!existsSync(filePath.trim())) {
      console.log(chalk.yellow(`  File not found: ${filePath.trim()}`));
      console.log(chalk.dim("  Skipping template."));
      return {
        ...config,
        templatePath: "$declined",
        templateContent: "$declined",
      };
    }

    return {
      ...config,
      templatePath: filePath.trim(),
      templateContent: "$declined", // Not using inline content
    };
  }

  /**
   * Check if Template plugin can run
   */
  canRun(config: ResumeConfig, _deps: DepsFor<never[]>): boolean {
    // Can run if we have inline content
    if (config.templateContent !== "$pending" && config.templateContent !== "$declined") {
      return true;
    }
    // Or if we have a valid file path
    if (config.templatePath !== "$pending" && config.templatePath !== "$declined") {
      return existsSync(config.templatePath);
    }
    return false;
  }

  /**
   * Generate Template content sections
   */
  async generateContent(
    config: ResumeConfig,
    _deps: DepsFor<never[]>,
  ): Promise<PluginResult<"template"> | null> {
    // Try inline content first
    if (config.templateContent !== "$pending" && config.templateContent !== "$declined") {
      this.templateContent = config.templateContent;
      console.log(
        chalk.green(`  Using inline template (${this.templateContent.length} characters)`),
      );
    }
    // Then try file
    else if (config.templatePath !== "$pending" && config.templatePath !== "$declined") {
      try {
        const file = Bun.file(config.templatePath);
        this.templateContent = await file.text();
        console.log(
          chalk.green(`  Loaded template from file (${this.templateContent.length} characters)`),
        );
      } catch (error) {
        console.warn(
          chalk.yellow(
            `  Warning: Could not read file: ${error instanceof Error ? error.message : "Unknown error"}`,
          ),
        );
        return null;
      }
    } else {
      return null;
    }

    const content = this.formatTemplateSection(this.templateContent);

    return {
      sections: [
        {
          title: "Resume Template Example",
          content,
          priority: 1, // High priority - should appear early for AI to understand style
          tokenEstimate: this.estimateTokens(content),
          sourcePlugin: this.id,
        },
      ],
      output: { templateContent: this.templateContent },
    };
  }

  /**
   * Format template into markdown content
   */
  private formatTemplateSection(template: string): string {
    const lines: string[] = [];

    lines.push("## Resume Format Template");
    lines.push("");
    lines.push("Please format the output similar to this example:");
    lines.push("");
    lines.push("```");
    lines.push(template);
    lines.push("```");
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Estimate token count
   */
  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }
}
