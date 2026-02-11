import { join } from "path";
import type { ResumeConfig } from "../types/index.js";

const CONFIG_FILE = ".resume-cli.json";

/**
 * Default configuration values
 */
const defaultConfig: ResumeConfig = {
  companyName: "",
  startDate: "",
  endDate: "",
  repositories: [],
  authorEmails: [],
  githubToken: "$pending",
  templatePath: "$pending",
  templateContent: "$pending",
  slackAiFilePath: "$pending",
  slackAiContent: "$pending",
  language: "English",
  maxCommits: 100,
  minimumCommitChanges: 3,
};

/**
 * Get the config file path
 */
function getConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, CONFIG_FILE);
}

/**
 * Check if a configuration file exists
 */
export async function configExists(cwd: string = process.cwd()): Promise<boolean> {
  const configPath = getConfigPath(cwd);
  const file = Bun.file(configPath);
  return file.exists();
}

/**
 * Load configuration from JSON file
 */
export async function loadResumeConfig(cwd: string = process.cwd()): Promise<{
  config: ResumeConfig;
  configFile?: string;
}> {
  const configPath = getConfigPath(cwd);
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return {
      config: { ...defaultConfig },
      configFile: undefined,
    };
  }

  try {
    const content = await file.json();
    return {
      config: { ...defaultConfig, ...content },
      configFile: configPath,
    };
  } catch {
    // If JSON parsing fails, return default config
    return {
      config: { ...defaultConfig },
      configFile: undefined,
    };
  }
}

/**
 * Save configuration to JSON file
 */
export async function saveResumeConfig(
  config: ResumeConfig,
  cwd: string = process.cwd(),
): Promise<void> {
  const configPath = getConfigPath(cwd);
  await Bun.write(configPath, JSON.stringify(config, null, 2));
}

/**
 * Update specific fields in the configuration
 */
export async function updateResumeConfig(
  updates: Partial<ResumeConfig>,
  cwd: string = process.cwd(),
): Promise<ResumeConfig> {
  const { config } = await loadResumeConfig(cwd);
  const updated = { ...config, ...updates };
  await saveResumeConfig(updated, cwd);
  return updated;
}

/**
 * Get default configuration (for new configs)
 */
export function getDefaultConfig(): ResumeConfig {
  return { ...defaultConfig };
}

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate the current configuration
 * Returns errors for missing required fields and warnings for optional integrations
 */
export async function validateConfig(cwd: string = process.cwd()): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!(await configExists(cwd))) {
    return {
      valid: false,
      errors: ["No configuration found. Run `resume-cli generate` to configure."],
      warnings: [],
    };
  }

  const { config } = await loadResumeConfig(cwd);

  // Required fields
  if (!config.companyName) {
    errors.push("Company name not configured");
  }

  if (!config.startDate || !config.endDate) {
    errors.push("Date range not configured");
  }

  if (config.repositories.length === 0) {
    errors.push("No repositories configured");
  }

  if (config.authorEmails.length === 0) {
    errors.push("No author emails configured");
  }

  // Optional integrations - just warnings
  if (!config.aiApiKey) {
    warnings.push("AI not configured (prompt will be exported for manual use)");
  }

  if (config.githubToken === "$pending" || config.githubToken === "$declined") {
    warnings.push("GitHub not configured (PR data will be skipped)");
  }

  return { valid: errors.length === 0, errors, warnings };
}
