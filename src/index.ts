#!/usr/bin/env node

import { Command } from "commander";
import { intro, outro } from "@clack/prompts";
import chalk from "chalk";
import { generateCommand } from "./commands/generate.js";
import { slackPromptCommand } from "./commands/slack-prompt.js";
import { configCommand } from "./commands/config.js";
import { version } from "../package.json";

const program = new Command();

program
  .name("resume-cli")
  .description(
    "Generate professional resumes from git commits, GitHub PRs, and Slack messages",
  )
  .version(version);

// Main command: generate
program
  .command("generate")
  .description("Generate resume content")
  .option("-c, --company <company>", "Company name for targeted resume")
  .option("-s, --start-date <date>", "Start date (YYYY-MM-DD)")
  .option("-e, --end-date <date>", "End date (YYYY-MM-DD)")
  .option("-o, --output <file>", "Output file path", "resume.md")
  .option("--template <file>", "Path to resume template example")
  .option(
    "--with-ai",
    "Generate content using AI (requires configured AI provider)",
  )
  .option(
    "--export-prompt",
    "Export prompt for manual AI use (default behavior)",
  )
  .option("--reset", "Reset configuration and prompt for all settings")
  .action(async (options) => {
    intro(chalk.blue("Resume CLI"));
    await generateCommand(options);
    outro(chalk.green("Done!"));
  });

// Helper command: slack-prompt
program
  .command("slack-prompt")
  .description(
    "Generate a prompt template for Slack AI to extract professional contributions",
  )
  .option("-s, --start-date <date>", "Start date (YYYY-MM-DD)")
  .option("-e, --end-date <date>", "End date (YYYY-MM-DD)")
  .option(
    "-c, --channels <channels>",
    "Comma-separated list of channels to focus on",
  )
  .action(async (options) => {
    await slackPromptCommand(options);
  });

// Config command: view and manage configuration
program
  .command("config")
  .description("View and manage configuration")
  .option("--set <key=value...>", "Set configuration values")
  .option(
    "--unset <key...>",
    "Unset configuration values (will prompt on next generate)",
  )
  .action(async (options) => {
    await configCommand(options);
  });

// Error handling
program.configureOutput({
  writeErr: (str) => process.stderr.write(chalk.red(str)),
});

program.exitOverride((err) => {
  if (
    err.code === "commander.helpDisplayed" ||
    err.code === "commander.version"
  ) {
    process.exit(0);
  }
  if (err.code === "commander.unknownCommand") {
    console.error(chalk.red(`Unknown command: ${err.message}`));
    process.exit(1);
  }
  throw err;
});

// Handle unhandled errors
process.on("uncaughtException", (error) => {
  console.error(chalk.red("Uncaught Exception:"), error.message);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(chalk.red("Unhandled Rejection:"), reason);
  process.exit(1);
});

if (import.meta.main) {
  program.parse();
}
