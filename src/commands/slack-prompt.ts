import chalk from "chalk";
import { loadResumeConfig } from "../utils/config.js";
import { buildSlackAIPrompt, copyToClipboard } from "../plugins/slack-ai/buildSlackPrompt.js";

interface SlackPromptOptions {
  startDate?: string;
  endDate?: string;
  channels?: string;
}

/**
 * Generate a prompt template for Slack AI to extract professional contributions.
 * The output from Slack AI can then be passed to the generate command via --slack-context.
 */
export async function slackPromptCommand(options: SlackPromptOptions): Promise<void> {
  try {
    const { config } = await loadResumeConfig();

    // Use CLI options, falling back to config values
    const startDate = options.startDate || config.startDate || "[START_DATE]";
    const endDate = options.endDate || config.endDate || "[END_DATE]";
    const channels = options.channels || "";

    const prompt = buildSlackAIPrompt(startDate, endDate, channels);

    console.log(chalk.blue("\nSlack AI Prompt Template"));
    console.log(chalk.dim("─".repeat(60)));
    console.log(chalk.dim("\nCopy the prompt below and paste it into Slack AI:\n"));
    console.log(chalk.dim("─".repeat(60)));
    console.log();
    console.log(prompt);
    console.log();
    console.log(chalk.dim("─".repeat(60)));
    console.log(chalk.dim("\nInstructions:"));
    console.log(chalk.dim("1. Open Slack and start a conversation with Slack AI"));
    console.log(chalk.dim("2. Paste the prompt above"));
    console.log(chalk.dim("3. Wait for Slack AI to generate the summary"));
    console.log(chalk.dim("4. Copy the response to a file (e.g., slack-context.txt)"));
    console.log(
      chalk.dim("5. Pass it to generate: bun run dev generate --slack-context slack-context.txt"),
    );
    console.log();

    // Offer to copy to clipboard if available (macOS)
    const copied = await copyToClipboard(prompt);
    if (copied) {
      console.log(chalk.green("Prompt copied to clipboard!"));
    }
  } catch (error) {
    console.error(chalk.red("Error generating Slack prompt:"), error);
    process.exit(1);
  }
}
