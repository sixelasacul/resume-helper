import chalk from "chalk";
import { loadResumeConfig, saveResumeConfig } from "../utils/config.js";
import { initializePlugins, pluginManager } from "../plugins/index.js";
import type { ResumeConfig } from "../types/index.js";

interface ConfigOptions {
  set?: string[];
  unset?: string[];
}

/**
 * Config command - view and manage configuration
 *
 * Usage:
 *   resume-cli config                      # Show current config
 *   resume-cli config --set key=value      # Set a config value
 *   resume-cli config --unset key          # Unset a config value (set to $pending)
 */
export async function configCommand(options: ConfigOptions): Promise<void> {
  // Initialize plugins to get sensitive keys
  initializePlugins();

  const { config, configFile } = await loadResumeConfig();
  let modified = false;

  // Handle --unset
  if (options.unset && options.unset.length > 0) {
    for (const key of options.unset) {
      if (!(key in config)) {
        console.log(chalk.yellow(`Unknown key: ${key}`));
        continue;
      }

      // Set to $pending so it will be asked again on next generate
      (config as unknown as Record<string, unknown>)[key] = "$pending";
      console.log(chalk.green(`Unset: ${key} (will be prompted on next generate)`));
      modified = true;
    }
  }

  // Handle --set
  if (options.set && options.set.length > 0) {
    for (const pair of options.set) {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) {
        console.log(chalk.yellow(`Invalid format: ${pair} (expected key=value)`));
        continue;
      }

      const key = pair.slice(0, eqIndex);
      const value = pair.slice(eqIndex + 1);

      if (!(key in config)) {
        console.log(chalk.yellow(`Unknown key: ${key}`));
        continue;
      }

      // Parse value (handle arrays, booleans, numbers)
      const parsedValue = parseValue(value, key, config);
      (config as unknown as Record<string, unknown>)[key] = parsedValue;
      console.log(chalk.green(`Set: ${key} = ${formatValueForLog(parsedValue)}`));
      modified = true;
    }
  }

  // Save if modified
  if (modified) {
    await saveResumeConfig(config);
    console.log(chalk.dim("\nConfiguration saved."));
  }

  // Display current config
  console.log(chalk.blue("\nCurrent Configuration"));
  console.log(chalk.dim("─".repeat(50)));

  if (configFile) {
    console.log(chalk.dim(`File: ${configFile}\n`));
  } else {
    console.log(chalk.yellow("No config file found. Run 'generate' to create one.\n"));
  }

  // Get sensitive keys from plugins
  const sensitiveKeys = pluginManager.getSensitiveKeys();

  // Pretty print config
  for (const [key, value] of Object.entries(config)) {
    const isSensitive = sensitiveKeys.has(key as keyof ResumeConfig);
    const displayValue = formatValue(key, value, isSensitive);
    console.log(`${chalk.cyan(key)}: ${displayValue}`);
  }
}

/**
 * Parse a string value into the appropriate type based on the config key
 */
function parseValue(value: string, key: string, config: ResumeConfig): unknown {
  // Get current value to determine expected type
  const currentValue = (config as unknown as Record<string, unknown>)[key];

  // Handle arrays - expect comma-separated values
  if (Array.isArray(currentValue)) {
    if (value === "" || value === "[]") {
      return [];
    }
    return value.split(",").map((v) => v.trim());
  }

  // Handle numbers
  if (typeof currentValue === "number") {
    const num = Number(value);
    if (!isNaN(num)) {
      return num;
    }
  }

  // Handle booleans
  if (value === "true") return true;
  if (value === "false") return false;

  // Handle special ConfigValue states
  if (value === "$pending" || value === "$declined") {
    return value;
  }

  // Default to string
  return value;
}

/**
 * Format a value for display in the config output
 *
 * Note: Sensitive field detection uses pluginManager.getSensitiveKeys() which
 * aggregates sensitiveConfigKeys from all registered plugins. If a new plugin
 * with sensitive fields is added, it will automatically be masked here.
 */
function formatValue(key: string, value: unknown, isSensitive: boolean): string {
  // Handle ConfigValue special states
  if (value === "$pending") {
    return chalk.dim("(not set - will prompt)");
  }
  if (value === "$declined") {
    return chalk.dim("(declined)");
  }

  // Mask sensitive values
  if (isSensitive && typeof value === "string" && value) {
    return chalk.dim("(hidden)");
  }

  // Handle arrays
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return chalk.dim("(empty)");
    }
    return value.join(", ");
  }

  // Handle empty strings
  if (typeof value === "string" && !value) {
    return chalk.dim("(empty)");
  }

  // Default
  return String(value);
}

/**
 * Format a value for logging after --set
 */
function formatValueForLog(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.join(", ")}]`;
  }
  return String(value);
}
