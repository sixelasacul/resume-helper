import { writeFile } from "fs/promises";
import chalk from "chalk";
import { loadResumeConfig, configExists, getDefaultConfig } from "../utils/config.js";
import { AIService, type ResumePromptData } from "../services/ai.js";
import { initializePlugins, pluginManager, type PluginContentSection } from "../plugins/index.js";

interface GenerateOptions {
  company?: string;
  startDate?: string;
  endDate?: string;
  output: string;
  template?: string;
  withAi?: boolean;
  exportPrompt?: boolean;
  reset?: boolean;
}

export async function generateCommand(options: GenerateOptions): Promise<void> {
  // Initialize plugin system
  initializePlugins();

  try {
    // Load existing config (for defaults during reset)
    const { config: existingConfig, configFile } = await loadResumeConfig();
    let config = existingConfig;

    // Determine if we need to run config prompts
    const needsConfig = options.reset || !(await configExists());

    if (needsConfig) {
      if (!configFile) {
        console.log(chalk.blue("No configuration found. Let's set one up.\n"));
        config = getDefaultConfig();
      } else if (options.reset) {
        console.log(chalk.blue("Resetting configuration...\n"));
        // Keep existing config for default values in prompts
      }

      // Run config prompts for all plugins
      config = await pluginManager.runConfigPrompts(config, { reset: options.reset });
    }

    // Merge CLI options with config
    const companyName = options.company || config.companyName;
    const startDate = options.startDate || config.startDate;
    const endDate = options.endDate || config.endDate;

    // Validate required fields
    if (!companyName || !startDate || !endDate) {
      console.log(
        chalk.red("Missing required configuration. Please run with --reset to configure."),
      );
      return;
    }

    // Override config with CLI options
    config = {
      ...config,
      companyName,
      startDate,
      endDate,
    };

    console.log(chalk.blue("\nResume Generation"));
    console.log(chalk.dim("─".repeat(40)));
    console.log(`Company: ${chalk.cyan(companyName)}`);
    console.log(`Period: ${chalk.cyan(startDate)} to ${chalk.cyan(endDate)}`);
    console.log(`Output: ${chalk.cyan(options.output)}`);
    if (options.withAi) {
      console.log(`AI: ${chalk.green("Enabled")} (${config.aiProvider || "not configured"})`);
    } else {
      console.log(`AI: ${chalk.yellow("Export prompt only")}`);
    }
    console.log();

    // Execute all plugins and collect content sections
    const allSections = await pluginManager.execute(config);

    // Build the aggregated prompt content
    const aggregatedContent = buildAggregatedContent(allSections, config);

    // Build prompt data for AI service
    const promptData: ResumePromptData = {
      companyName,
      period: { start: startDate, end: endDate },
      repositories: [], // Legacy field - now handled by plugins
      technologies: [], // Legacy field - now handled by plugins
      pullRequests: [], // Legacy field - now handled by plugins
      slackMessages: [], // Legacy field - now handled by plugins
      templateExample: undefined, // Now handled by template plugin
      maxCommits: config.maxCommits ?? 100,
      minimumCommitChanges: config.minimumCommitChanges ?? 3,
      language: config.language || "English",
      slackAiContext: undefined, // Now handled by slack-ai plugin
      pluginContent: aggregatedContent,
    };

    // Initialize AI service
    const aiService = new AIService(config);

    if (options.withAi && config.aiProvider && config.aiApiKey) {
      // Generate with AI
      console.log(chalk.blue("\nGenerating content with AI..."));
      try {
        const content = await aiService.generateWithAI(promptData);
        const markdown = formatGeneratedContent(content, companyName, startDate, endDate);
        await writeFile(options.output, markdown);
        console.log(chalk.green(`\nResume content saved to: ${options.output}`));
      } catch (error) {
        console.error(chalk.red("AI generation failed:"), error);
        console.log(chalk.yellow("Falling back to prompt export..."));
        await exportPrompt(aiService, promptData, options.output);
      }
    } else {
      // Export prompt (default behavior)
      await exportPrompt(aiService, promptData, options.output);
    }

    // Print summary
    printSummary(allSections);
  } catch (error) {
    if (error instanceof Error && error.message === "Configuration cancelled") {
      console.log(chalk.yellow("\nConfiguration cancelled."));
      return;
    }
    console.error(chalk.red("Generation error:"), error);
    process.exit(1);
  }
}

/**
 * Build aggregated content from all plugin sections
 */
function buildAggregatedContent(
  sections: PluginContentSection[],
  config: { companyName: string; startDate: string; endDate: string; language?: string },
): string {
  const lines: string[] = [];

  lines.push(`# Work Experience Data: ${config.companyName}`);
  lines.push(`**Period:** ${config.startDate} to ${config.endDate}`);
  lines.push(`**Language:** ${config.language || "English"}`);
  lines.push("");

  for (const section of sections) {
    lines.push(section.content);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Export prompt to markdown file
 */
async function exportPrompt(
  aiService: AIService,
  promptData: ResumePromptData,
  outputPath: string,
): Promise<void> {
  console.log(chalk.blue("\nExporting prompt..."));
  const promptExport = aiService.buildPrompt(promptData);
  const markdown = aiService.exportToMarkdown(promptExport);

  // Change extension to indicate it's a prompt
  const promptPath = outputPath.replace(/\.md$/, "-prompt.md");
  await writeFile(promptPath, markdown);

  // Estimate tokens and show warning if large
  const estimatedTokens = aiService.estimateTokenCount(markdown);
  const tokenDisplay =
    estimatedTokens >= 1000 ? `~${Math.round(estimatedTokens / 1000)}K` : `~${estimatedTokens}`;

  console.log(chalk.green(`\nPrompt exported to: ${promptPath}`));
  console.log(`Estimated tokens: ${chalk.cyan(tokenDisplay)}`);

  if (estimatedTokens > 50000) {
    console.log(chalk.yellow(`\nWarning: Large prompt detected (${tokenDisplay} tokens)`));
    console.log(chalk.dim("   This may exceed some AI model context limits."));
    console.log(
      chalk.dim("   Consider generating for a shorter time period (e.g., year by year)."),
    );
  }

  console.log(chalk.dim("\nTo generate your resume:"));
  console.log(chalk.dim("1. Open the exported file"));
  console.log(chalk.dim("2. Copy the entire content"));
  console.log(chalk.dim("3. Paste into ChatGPT, Claude, or your preferred AI assistant"));
}

/**
 * Format generated content to markdown
 */
function formatGeneratedContent(
  content: {
    projects: Array<{
      name: string;
      description: string;
      technologies: string[];
      contributions: string[];
      impact: string;
      period: string;
    }>;
    skills: Array<{
      name: string;
      category: string;
      proficiency: string;
    }>;
    achievements: Array<{
      description: string;
    }>;
    summary: string;
  },
  companyName: string,
  startDate: string,
  endDate: string,
): string {
  const lines: string[] = [];

  lines.push(`# Resume Content: ${companyName}`);
  lines.push(`**Period:** ${startDate} to ${endDate}`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push("");

  // Summary
  if (content.summary) {
    lines.push("## Professional Summary");
    lines.push("");
    lines.push(content.summary);
    lines.push("");
  }

  // Projects
  if (content.projects.length > 0) {
    lines.push("## Projects");
    lines.push("");
    for (const project of content.projects) {
      lines.push(`### ${project.name}`);
      if (project.description) {
        lines.push(project.description);
      }
      if (project.technologies.length > 0) {
        lines.push(`**Technologies:** ${project.technologies.join(", ")}`);
      }
      if (project.contributions.length > 0) {
        lines.push("**Contributions:**");
        for (const contribution of project.contributions) {
          lines.push(`- ${contribution}`);
        }
      }
      if (project.impact) {
        lines.push(`**Impact:** ${project.impact}`);
      }
      lines.push("");
    }
  }

  // Skills
  if (content.skills.length > 0) {
    lines.push("## Technical Skills");
    lines.push("");

    // Group by category
    const byCategory = new Map<string, string[]>();
    for (const skill of content.skills) {
      const list = byCategory.get(skill.category) || [];
      list.push(skill.name);
      byCategory.set(skill.category, list);
    }

    for (const [category, skills] of byCategory) {
      lines.push(`**${category}:** ${skills.join(", ")}`);
    }
    lines.push("");
  }

  // Achievements
  if (content.achievements.length > 0) {
    lines.push("## Key Achievements");
    lines.push("");
    for (const achievement of content.achievements) {
      lines.push(`- ${achievement.description}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Print summary of collected plugin data
 */
function printSummary(sections: PluginContentSection[]): void {
  console.log(chalk.blue("\nData Summary"));
  console.log(chalk.dim("─".repeat(40)));
  console.log(`Sections generated: ${chalk.cyan(sections.length)}`);

  const totalTokens = sections.reduce((sum, s) => sum + s.tokenEstimate, 0);
  const tokenDisplay =
    totalTokens >= 1000 ? `~${Math.round(totalTokens / 1000)}K` : `~${totalTokens}`;
  console.log(`Estimated content tokens: ${chalk.cyan(tokenDisplay)}`);

  // Group by source plugin
  const byPlugin = new Map<string, number>();
  for (const section of sections) {
    const current = byPlugin.get(section.sourcePlugin) || 0;
    byPlugin.set(section.sourcePlugin, current + 1);
  }

  if (byPlugin.size > 0) {
    console.log("\nSections by source:");
    for (const [plugin, count] of byPlugin) {
      console.log(`  - ${plugin}: ${count}`);
    }
  }
}
