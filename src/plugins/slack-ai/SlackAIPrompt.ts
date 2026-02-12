import * as p from "@clack/prompts";
import chalk from "chalk";
import { existsSync } from "fs";
import type { ResumeConfig } from "../../types/index.js";
import type { PluginPrompt, PluginResult, DepsFor, PromptConfigOptions } from "../types.js";
import { buildSlackAIPrompt, copyToClipboard } from "./buildSlackPrompt.js";
import { readMultilineInput } from "../../utils/input.js";

/**
 * Slack AI Plugin
 *
 * Handles:
 * - Reading Slack AI export (from file or pasted content)
 * - Including Slack context in resume generation
 *
 * This plugin reads from content that the user has exported from Slack AI,
 * either by providing a file path or pasting directly.
 */
export class SlackAIPrompt implements PluginPrompt<"slack-ai", never[]> {
  readonly id = "slack-ai" as const;
  readonly name = "Slack AI Context";
  readonly needs: never[] = [];

  private slackContext: string | null = null;

  /**
   * Prompt for Slack AI context (paste, file, or generate prompt)
   */
  async promptForConfig(
    config: ResumeConfig,
    options?: PromptConfigOptions,
  ): Promise<ResumeConfig> {
    // Check for existing values
    const hasExistingPath =
      config.slackAiFilePath !== "$pending" && config.slackAiFilePath !== "$declined";
    const hasExistingContent =
      config.slackAiContent !== "$pending" && config.slackAiContent !== "$declined";

    // If has existing content, keep it (unless resetting)
    if (hasExistingContent && !options?.reset) {
      return config;
    }

    // If has existing file path, check if file still exists
    if (hasExistingPath && !options?.reset) {
      if (existsSync(config.slackAiFilePath)) {
        return config; // File exists, use it
      }
      // File doesn't exist anymore, need to re-prompt
      console.log(chalk.yellow(`\nSlack AI file no longer exists: ${config.slackAiFilePath}`));
    }

    // Skip if either was declined and not resetting
    if (!options?.reset) {
      if (config.slackAiFilePath === "$declined" || config.slackAiContent === "$declined") {
        return config;
      }
    }

    console.log(chalk.dim("\nSlack AI context (optional - for communication highlights):"));

    const choice = await p.select({
      message: "How would you like to provide Slack AI context?",
      options: [
        { value: "generate", label: "Generate Slack AI prompt (Recommended)" },
        { value: "paste", label: "Paste response directly" },
        { value: "file", label: "Provide a file path" },
        { value: "skip", label: "Skip (no Slack context)" },
      ],
    });

    if (p.isCancel(choice)) {
      throw new Error("Configuration cancelled");
    }

    if (choice === "skip") {
      return {
        ...config,
        slackAiFilePath: "$declined",
        slackAiContent: "$declined",
      };
    }

    if (choice === "generate") {
      return await this.handleGeneratePrompt(config);
    }

    if (choice === "paste") {
      console.log(chalk.dim("\nPaste your Slack AI response below."));

      const content = await readMultilineInput();

      if (!content.trim()) {
        console.log(chalk.yellow("No content provided, skipping Slack AI context."));
        return {
          ...config,
          slackAiFilePath: "$declined",
          slackAiContent: "$declined",
        };
      }

      console.log(chalk.green(`  Slack AI context saved (${content.length} characters)`));

      return {
        ...config,
        slackAiFilePath: "$declined", // Not using file
        slackAiContent: content,
      };
    }

    // File path option
    const filePath = await p.text({
      message: "Path to Slack AI export file",
      placeholder: "/path/to/slack-export.txt",
      defaultValue: hasExistingPath ? config.slackAiFilePath : "",
    });

    if (p.isCancel(filePath)) {
      throw new Error("Configuration cancelled");
    }

    if (!filePath.trim()) {
      return {
        ...config,
        slackAiFilePath: "$declined",
        slackAiContent: "$declined",
      };
    }

    if (!existsSync(filePath.trim())) {
      console.log(chalk.yellow(`  File not found: ${filePath.trim()}`));
      console.log(chalk.dim("  Skipping Slack AI context."));
      return {
        ...config,
        slackAiFilePath: "$declined",
        slackAiContent: "$declined",
      };
    }

    return {
      ...config,
      slackAiFilePath: filePath.trim(),
      slackAiContent: "$declined", // Not using inline content
    };
  }

  /**
   * Handle the "Generate Slack AI prompt" flow
   */
  private async handleGeneratePrompt(config: ResumeConfig): Promise<ResumeConfig> {
    // Optional: channels
    const channels = await p.text({
      message: "Specific channels to focus on (leave empty for all)",
      placeholder: "#team-frontend, #project-x",
      defaultValue: "",
    });

    if (p.isCancel(channels)) {
      throw new Error("Configuration cancelled");
    }

    // Generate the prompt
    const prompt = buildSlackAIPrompt(
      config.startDate || "[START_DATE]",
      config.endDate || "[END_DATE]",
      channels.trim(),
    );

    // Show and copy to clipboard
    console.log(chalk.dim("\n─".repeat(50)));
    console.log(chalk.blue("\nSlack AI Prompt:"));
    console.log(chalk.dim("─".repeat(50)));
    console.log(prompt);
    console.log(chalk.dim("─".repeat(50)));

    const copied = await copyToClipboard(prompt);
    if (copied) {
      console.log(chalk.green("\nPrompt copied to clipboard!"));
    }

    console.log(chalk.dim("\nInstructions:"));
    console.log(chalk.dim("1. Open Slack and start a conversation with Slack AI"));
    console.log(chalk.dim("2. Paste the prompt (already in clipboard)"));
    console.log(chalk.dim("3. Copy Slack AI's response"));
    console.log(chalk.dim("4. Run this CLI again and choose 'Paste response directly'\n"));

    // Mark as pending so we'll ask again next time
    return { ...config, slackAiFilePath: "$pending", slackAiContent: "$pending" };
  }

  /**
   * Check if Slack AI plugin can run
   */
  canRun(config: ResumeConfig, _deps: DepsFor<never[]>): boolean {
    // Can run if we have inline content
    if (config.slackAiContent !== "$pending" && config.slackAiContent !== "$declined") {
      return true;
    }
    // Or if we have a valid file path
    if (config.slackAiFilePath !== "$pending" && config.slackAiFilePath !== "$declined") {
      return existsSync(config.slackAiFilePath);
    }
    return false;
  }

  /**
   * Generate Slack AI content sections
   */
  async generateContent(
    config: ResumeConfig,
    _deps: DepsFor<never[]>,
  ): Promise<PluginResult<"slack-ai"> | null> {
    // Try inline content first
    if (config.slackAiContent !== "$pending" && config.slackAiContent !== "$declined") {
      this.slackContext = config.slackAiContent;
      console.log(
        chalk.green(`  Using inline Slack context (${this.slackContext.length} characters)`),
      );
    }
    // Then try file
    else if (config.slackAiFilePath !== "$pending" && config.slackAiFilePath !== "$declined") {
      try {
        const file = Bun.file(config.slackAiFilePath);
        this.slackContext = await file.text();
        console.log(
          chalk.green(`  Loaded Slack context from file (${this.slackContext.length} characters)`),
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

    const content = this.formatSlackSection(this.slackContext);

    return {
      sections: [
        {
          title: "Slack Communication",
          content,
          priority: 20,
          tokenEstimate: this.estimateTokens(content),
          sourcePlugin: this.id,
        },
      ],
      output: { slackContext: this.slackContext },
    };
  }

  /**
   * Format Slack context into markdown content
   */
  private formatSlackSection(context: string): string {
    const lines: string[] = [];

    lines.push("## Communication & Collaboration (from Slack)");
    lines.push("");
    lines.push(
      "The following is a summary of professional communication and collaboration activities:",
    );
    lines.push("");
    lines.push(context);
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
