import * as p from "@clack/prompts";
import chalk from "chalk";
import { existsSync } from "fs";
import { spawn } from "child_process";
import type { ResumeConfig } from "../../types/index.js";
import type { PluginPrompt, PluginResult, DepsFor, PromptConfigOptions } from "../types.js";
import { GitService, type TechnologyMention } from "./GitService.js";

/**
 * Git Plugin
 *
 * Handles:
 * - Repository configuration (saved to config)
 * - Author email configuration (saved to config)
 * - Date range configuration (saved to config)
 * - Commit analysis and content generation
 */
export class GitPrompt implements PluginPrompt<"git", never[]> {
  readonly id = "git" as const;
  readonly name = "Git Commits";
  readonly needs: never[] = [];

  private gitService = new GitService();

  /**
   * Prompt for git-related configuration
   * Asks for: repositories, author emails, date range, company name
   */
  async promptForConfig(
    config: ResumeConfig,
    options?: PromptConfigOptions,
  ): Promise<ResumeConfig> {
    const updatedConfig = { ...config };

    // Company name
    if (!updatedConfig.companyName || options?.reset) {
      const companyName = await p.text({
        message: "What company is this resume for?",
        placeholder: "e.g., Acme Inc.",
        defaultValue: updatedConfig.companyName || undefined,
        validate: (value) => {
          if (!value?.trim()) return "Company name is required";
        },
      });

      if (p.isCancel(companyName)) {
        throw new Error("Configuration cancelled");
      }

      updatedConfig.companyName = companyName;
    }

    // Date range
    if (!updatedConfig.startDate || !updatedConfig.endDate || options?.reset) {
      console.log(chalk.dim("\nDate range for work history:"));

      const startDate = await p.text({
        message: "Start date (YYYY-MM-DD)",
        placeholder: "e.g., 2023-01-01",
        defaultValue: updatedConfig.startDate || undefined,
        validate: (value) => {
          if (!value?.trim()) return "Start date is required";
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "Use format YYYY-MM-DD";
        },
      });

      if (p.isCancel(startDate)) {
        throw new Error("Configuration cancelled");
      }

      const endDate = await p.text({
        message: "End date (YYYY-MM-DD)",
        placeholder: "e.g., 2024-12-31",
        defaultValue: updatedConfig.endDate || undefined,
        validate: (value) => {
          if (!value?.trim()) return "End date is required";
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "Use format YYYY-MM-DD";
        },
      });

      if (p.isCancel(endDate)) {
        throw new Error("Configuration cancelled");
      }

      updatedConfig.startDate = startDate;
      updatedConfig.endDate = endDate;
    }

    // Repositories
    if (updatedConfig.repositories.length === 0 || options?.reset) {
      console.log(chalk.dim("\nAdd git repositories to analyze:"));

      // Show existing repos if resetting
      if (options?.reset && updatedConfig.repositories.length > 0) {
        console.log(chalk.dim(`Current repositories: ${updatedConfig.repositories.join(", ")}`));
      }

      const repos = await this.promptForRepositories(
        options?.reset ? updatedConfig.repositories : [],
      );
      updatedConfig.repositories = repos;
    }

    // Author emails
    if (updatedConfig.authorEmails.length === 0 || options?.reset) {
      console.log(chalk.dim("\nAdd author emails to filter commits:"));

      // Show existing emails if resetting
      if (options?.reset && updatedConfig.authorEmails.length > 0) {
        console.log(chalk.dim(`Current emails: ${updatedConfig.authorEmails.join(", ")}`));
      }

      const emails = await this.promptForEmails(options?.reset ? updatedConfig.authorEmails : []);
      updatedConfig.authorEmails = emails;
    }

    return updatedConfig;
  }

  /**
   * No runtime input needed for git plugin
   */

  /**
   * Check if git plugin can run
   */
  canRun(config: ResumeConfig, _deps: DepsFor<[]>): boolean {
    return (
      config.repositories.length > 0 &&
      config.authorEmails.length > 0 &&
      !!config.startDate &&
      !!config.endDate
    );
  }

  /**
   * Generate git content sections
   */
  async generateContent(
    config: ResumeConfig,
    _deps: DepsFor<[]>,
  ): Promise<PluginResult<"git"> | null> {
    const repositories = [];

    for (const repoPath of config.repositories) {
      try {
        const repo = await this.gitService.analyzeRepository(
          repoPath,
          config.authorEmails,
          config.startDate,
          config.endDate,
        );

        // Filter commits by minimum changes
        const minChanges = config.minimumCommitChanges ?? 3;
        repo.commits = repo.commits.filter((c) => c.stats.total >= minChanges);

        // Limit commits
        const maxCommits = config.maxCommits ?? 100;
        repo.commits = repo.commits.slice(0, maxCommits);

        repositories.push(repo);
      } catch (error) {
        console.warn(
          chalk.yellow(
            `  Warning: Could not analyze ${repoPath}: ${error instanceof Error ? error.message : "Unknown error"}`,
          ),
        );
      }
    }

    if (repositories.length === 0) {
      return null;
    }

    // Generate content sections
    const sections = [];

    // Commits section
    const commitsContent = this.formatCommitsSection(repositories);
    if (commitsContent) {
      sections.push({
        title: "Git Commits",
        content: commitsContent,
        priority: 10,
        tokenEstimate: this.estimateTokens(commitsContent),
        sourcePlugin: this.id,
      });
    }

    // Technologies section
    const techContent = await this.formatTechnologiesSection(repositories);
    if (techContent) {
      sections.push({
        title: "Technologies",
        content: techContent,
        priority: 5,
        tokenEstimate: this.estimateTokens(techContent),
        sourcePlugin: this.id,
      });
    }

    return {
      sections,
      output: { repositories },
    };
  }

  /**
   * Prompt for repository paths
   */
  private async promptForRepositories(existingRepos: string[] = []): Promise<string[]> {
    const repos: string[] = [...existingRepos];

    while (true) {
      const repoPath = await p.text({
        message:
          repos.length === 0
            ? "Repository path"
            : "Add another repository (or leave empty to continue)",
        placeholder: "/path/to/repo",
        validate: (value) => {
          const v = value || "";
          if (repos.length === 0 && !v.trim()) {
            return "At least one repository is required";
          }
          if (v.trim() && !existsSync(v.trim())) {
            return "Path does not exist";
          }
          if (v.trim() && !existsSync(`${v.trim()}/.git`)) {
            return "Not a git repository";
          }
        },
      });

      if (p.isCancel(repoPath)) {
        throw new Error("Configuration cancelled");
      }

      if (!repoPath.trim()) {
        break;
      }

      repos.push(repoPath.trim());
      console.log(chalk.green(`  Added: ${repoPath}`));
    }

    return repos;
  }

  /**
   * Prompt for author emails
   */
  private async promptForEmails(existingEmails: string[] = []): Promise<string[]> {
    const emails: string[] = [...existingEmails];

    // Try to get git user email as default
    const gitEmail = await this.getGitUserEmail();
    if (gitEmail) {
      console.log(chalk.dim(`  Detected git email: ${gitEmail}`));
    }

    while (true) {
      const email = await p.text({
        message:
          emails.length === 0 ? "Author email" : "Add another email (or leave empty to continue)",
        placeholder: "you@example.com",
        initialValue: emails.length === 0 ? gitEmail || "" : "",
        validate: (value) => {
          const v = value || "";
          if (emails.length === 0 && !v.trim()) {
            return "At least one email is required";
          }
          if (v.trim() && !v.includes("@")) {
            return "Invalid email format";
          }
        },
      });

      if (p.isCancel(email)) {
        throw new Error("Configuration cancelled");
      }

      if (!email.trim()) {
        break;
      }

      emails.push(email.trim());
      console.log(chalk.green(`  Added: ${email}`));
    }

    return emails;
  }

  /**
   * Get the current git user email
   */
  private async getGitUserEmail(): Promise<string | null> {
    return new Promise((resolve) => {
      const git = spawn("git", ["config", "user.email"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let output = "";
      git.stdout.on("data", (data) => {
        output += data.toString();
      });

      git.on("close", (code) => {
        if (code === 0 && output.trim()) {
          resolve(output.trim());
        } else {
          resolve(null);
        }
      });

      git.on("error", () => {
        resolve(null);
      });
    });
  }

  /**
   * Format commits into markdown content
   */
  private formatCommitsSection(
    repositories: {
      name: string;
      commits: Array<{
        hash: string;
        date: string;
        message: string;
        stats: { additions: number; deletions: number; total: number };
        files: Array<{ path: string }>;
      }>;
    }[],
  ): string {
    const lines: string[] = [];

    lines.push("## Code Contributions");
    lines.push("");

    for (const repo of repositories) {
      if (repo.commits.length === 0) continue;

      lines.push(`### ${repo.name}`);
      lines.push(`Total commits: ${repo.commits.length}`);
      lines.push("");

      // Group commits by month
      const byMonth = new Map<string, typeof repo.commits>();
      for (const commit of repo.commits) {
        const month = commit.date.slice(0, 7); // YYYY-MM
        const list = byMonth.get(month) || [];
        list.push(commit);
        byMonth.set(month, list);
      }

      for (const [month, commits] of byMonth) {
        lines.push(`**${month}** (${commits.length} commits)`);
        for (const commit of commits.slice(0, 10)) {
          const changes = `+${commit.stats.additions}/-${commit.stats.deletions}`;
          lines.push(`- ${commit.message} (${changes})`);
        }
        if (commits.length > 10) {
          lines.push(`- ... and ${commits.length - 10} more commits`);
        }
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  /**
   * Format technologies into markdown content
   */
  private async formatTechnologiesSection(
    repositories: {
      path: string;
      commits: Array<{ files: Array<{ path: string; additions: number; deletions: number }> }>;
    }[],
  ): Promise<string> {
    const lines: string[] = [];
    const allTechs: TechnologyMention[] = [];

    for (const repo of repositories) {
      const techs = await this.gitService.detectTechnologies(repo.path, repo.commits as any);
      allTechs.push(...techs);
    }

    if (allTechs.length === 0) {
      return "";
    }

    // Deduplicate
    const uniqueTechs = new Map<string, TechnologyMention>();
    for (const tech of allTechs) {
      if (!uniqueTechs.has(tech.name)) {
        uniqueTechs.set(tech.name, tech);
      }
    }

    lines.push("## Technologies Used");
    lines.push("");

    // Group by category
    const byCategory = new Map<string, string[]>();
    for (const tech of uniqueTechs.values()) {
      const list = byCategory.get(tech.category) || [];
      list.push(tech.name);
      byCategory.set(tech.category, list);
    }

    const categoryOrder = [
      "language",
      "framework",
      "library",
      "database",
      "cloud",
      "infrastructure",
      "tool",
    ];
    for (const category of categoryOrder) {
      const techs = byCategory.get(category);
      if (techs && techs.length > 0) {
        const label = category.charAt(0).toUpperCase() + category.slice(1) + "s";
        lines.push(`**${label}:** ${techs.join(", ")}`);
      }
    }

    lines.push("");

    return lines.join("\n");
  }

  /**
   * Estimate token count for content
   */
  private estimateTokens(content: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(content.length / 4);
  }
}
