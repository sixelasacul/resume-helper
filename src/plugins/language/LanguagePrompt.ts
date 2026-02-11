import * as p from "@clack/prompts";
import chalk from "chalk";
import type { ResumeConfig } from "../../types/index.js";
import type { PluginPrompt, PluginResult, DepsFor, PromptConfigOptions } from "../types.js";

/**
 * Language Plugin
 *
 * Handles:
 * - Output language configuration (saved to config)
 * - Adds language instruction to AI prompt
 */
export class LanguagePrompt implements PluginPrompt<"language", never[]> {
  readonly id = "language" as const;
  readonly name = "Output Language";
  readonly needs: never[] = [];

  /**
   * Prompt for output language
   */
  async promptForConfig(
    config: ResumeConfig,
    options?: PromptConfigOptions,
  ): Promise<ResumeConfig> {
    // Already configured and not resetting
    if (config.language && !options?.reset) {
      return config;
    }

    console.log(chalk.dim("\nOutput language:"));

    const language = await p.select({
      message: "What language should the resume be in?",
      options: [
        { value: "English", label: "English" },
        { value: "French", label: "French (Français)" },
        { value: "Spanish", label: "Spanish (Español)" },
        { value: "German", label: "German (Deutsch)" },
        { value: "Portuguese", label: "Portuguese (Português)" },
        { value: "Italian", label: "Italian (Italiano)" },
        { value: "Dutch", label: "Dutch (Nederlands)" },
        { value: "Japanese", label: "Japanese (日本語)" },
        { value: "Chinese", label: "Chinese (中文)" },
        { value: "Korean", label: "Korean (한국어)" },
      ],
      initialValue: config.language || "English",
    });

    if (p.isCancel(language)) {
      throw new Error("Configuration cancelled");
    }

    return { ...config, language };
  }

  /**
   * Language plugin always runs
   */
  canRun(config: ResumeConfig, _deps: DepsFor<never[]>): boolean {
    return !!config.language;
  }

  /**
   * Generate language instruction section
   */
  async generateContent(
    config: ResumeConfig,
    _deps: DepsFor<never[]>,
  ): Promise<PluginResult<"language"> | null> {
    const language = config.language || "English";

    const content = this.formatLanguageSection(language);

    return {
      sections: [
        {
          title: "Language Instruction",
          content,
          priority: 0, // Highest priority - should be at the very top
          tokenEstimate: this.estimateTokens(content),
          sourcePlugin: this.id,
        },
      ],
      output: { language },
    };
  }

  /**
   * Format language instruction
   */
  private formatLanguageSection(language: string): string {
    const lines: string[] = [];

    lines.push("## Output Language");
    lines.push("");
    lines.push(`**IMPORTANT: Generate all resume content in ${language}.**`);
    lines.push("");

    if (language !== "English") {
      lines.push(
        `Translate all technical descriptions, achievements, and summaries to ${language}.`,
      );
      lines.push(
        "Keep technical terms, product names, and company names in their original form when appropriate.",
      );
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Estimate token count
   */
  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }
}
