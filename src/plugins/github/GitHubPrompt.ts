import * as p from "@clack/prompts";
import chalk from "chalk";
import type { ResumeConfig, GitHubPR, GitRepository } from "../../types/index.js";
import type {
  PluginPrompt,
  PluginResult,
  DepsFor,
  GitPluginOutput,
  PromptConfigOptions,
} from "../types.js";
import { GitHubService } from "./GitHubService.js";
import { cleanMarkdown, toBlockquote } from "../../utils/markdown.js";

/**
 * GitHub Plugin
 *
 * Handles:
 * - GitHub token configuration (saved to config)
 * - Pull request fetching for repositories
 *
 * Depends on: git plugin (needs repository list)
 */
export class GitHubPrompt implements PluginPrompt<"github", ["git"]> {
  readonly id = "github" as const;
  readonly name = "GitHub Pull Requests";
  readonly needs: ["git"] = ["git"];
  readonly sensitiveConfigKeys: (keyof ResumeConfig)[] = ["githubToken"];

  /**
   * Prompt for GitHub token
   */
  async promptForConfig(
    config: ResumeConfig,
    options?: PromptConfigOptions,
  ): Promise<ResumeConfig> {
    const currentValue = config.githubToken;
    const hasExistingToken = currentValue !== "$pending" && currentValue !== "$declined";

    // If not resetting, skip if already handled (set or declined)
    if (!options?.reset && currentValue !== "$pending") {
      return config;
    }

    // On reset with existing token, ask if they want to keep it
    if (options?.reset && hasExistingToken) {
      const keepExisting = await p.confirm({
        message: "Keep existing GitHub token?",
        initialValue: true,
      });

      if (p.isCancel(keepExisting)) {
        throw new Error("Configuration cancelled");
      }

      if (keepExisting) {
        return config;
      }
    }

    console.log(chalk.dim("\nGitHub integration (optional - for pull request data):"));

    const token = await p.text({
      message: "GitHub personal access token (leave empty to skip)",
      placeholder: "ghp_xxxxxxxxxxxx",
      defaultValue: "",
    });

    if (p.isCancel(token)) {
      throw new Error("Configuration cancelled");
    }

    if (!token.trim()) {
      return { ...config, githubToken: "$declined" };
    }

    return { ...config, githubToken: token.trim() };
  }

  /**
   * Check if GitHub plugin can run
   */
  canRun(config: ResumeConfig, deps: DepsFor<["git"]>): boolean {
    // Need actual token value (not pending/declined)
    if (config.githubToken === "$pending" || config.githubToken === "$declined") {
      return false;
    }

    const gitOutput = deps.git as GitPluginOutput | undefined;
    if (!gitOutput?.repositories) {
      return false;
    }

    // Check if any repos are GitHub repos
    return gitOutput.repositories.some((r) => r.isGitHub);
  }

  /**
   * Generate GitHub content sections
   */
  async generateContent(
    config: ResumeConfig,
    deps: DepsFor<["git"]>,
  ): Promise<PluginResult<"github"> | null> {
    const gitOutput = deps.git as GitPluginOutput;
    const githubRepos = gitOutput.repositories.filter((r) => r.isGitHub);

    if (githubRepos.length === 0) {
      return null;
    }

    const allPRs: GitHubPR[] = [];
    // Group repos by GitHub host to use correct API URL for each
    const reposByHost = this.groupReposByHost(githubRepos);

    for (const [host, repos] of reposByHost) {
      // Create service with appropriate enterprise URL
      const enterpriseUrl = host === "github.com" ? undefined : `https://${host}/api/v3`;
      const service = new GitHubService(config.githubToken as string, enterpriseUrl);

      for (const repo of repos) {
        try {
          const prs = await this.fetchPRsForRepo(service, repo);
          allPRs.push(...prs);
        } catch (error) {
          console.warn(
            chalk.yellow(
              `  Warning: Could not fetch PRs for ${repo.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
            ),
          );
        }
      }
    }

    if (allPRs.length === 0) {
      return {
        sections: [],
        output: { pullRequests: [] },
      };
    }

    // Deduplicate PRs
    const uniquePRs = allPRs.filter(
      (pr, index, arr) =>
        index ===
        arr.findIndex((p) => p.number === pr.number && p.repositoryName === pr.repositoryName),
    );

    // Limit PRs
    const maxPRs = config.maxCommits ?? 100;
    const limitedPRs = uniquePRs.slice(0, maxPRs);

    // Generate content section
    const content = this.formatPRsSection(limitedPRs);
    const sections = content
      ? [
          {
            title: "Pull Requests",
            content,
            priority: 15,
            tokenEstimate: this.estimateTokens(content),
            sourcePlugin: this.id,
          },
        ]
      : [];

    return {
      sections,
      output: { pullRequests: limitedPRs },
    };
  }

  /**
   * Fetch PRs for a repository
   */
  private async fetchPRsForRepo(service: GitHubService, repo: GitRepository): Promise<GitHubPR[]> {
    if (!repo.githubUrl) {
      return [];
    }

    const repoInfo = service.parseRepoUrl(repo.githubUrl);
    if (!repoInfo) {
      return [];
    }

    // Get commit hashes from the repo
    const commitHashes = repo.commits.map((c) => c.hash);

    // Fetch PRs associated with these commits
    const prs = await service.getPullRequestsForCommits(
      repoInfo.owner,
      repoInfo.repo,
      commitHashes,
    );

    // Add repository name to PRs for context
    return prs.map((pr) => ({
      ...pr,
      repositoryName: repo.name,
    }));
  }

  /**
   * Group repositories by GitHub host (for enterprise vs public)
   */
  private groupReposByHost(repos: GitRepository[]): Map<string, GitRepository[]> {
    const byHost = new Map<string, GitRepository[]>();

    for (const repo of repos) {
      const host = this.extractHost(repo.githubUrl);
      if (!host) continue;

      const list = byHost.get(host) || [];
      list.push(repo);
      byHost.set(host, list);
    }

    return byHost;
  }

  /**
   * Extract host from GitHub URL
   */
  private extractHost(url?: string): string | null {
    if (!url) return null;

    const patterns = [/https:\/\/([^\/]+)\//, /git@([^:]+):/];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1] || null;
      }
    }

    return null;
  }

  /**
   * Format PRs into markdown content
   */
  private formatPRsSection(prs: GitHubPR[]): string {
    if (prs.length === 0) {
      return "";
    }

    const lines: string[] = [];

    lines.push("## Pull Requests");
    lines.push("");
    lines.push(`Total PRs: ${prs.length}`);
    lines.push("");

    // Group by repository
    const byRepo = new Map<string, GitHubPR[]>();
    for (const pr of prs) {
      const repoName = pr.repositoryName || "Unknown";
      const list = byRepo.get(repoName) || [];
      list.push(pr);
      byRepo.set(repoName, list);
    }

    for (const [repoName, repoPRs] of byRepo) {
      lines.push(`### ${repoName}`);
      lines.push("");

      for (const pr of repoPRs) {
        const status = pr.mergedAt ? "merged" : pr.state;
        const labels = pr.labels.length > 0 ? ` [${pr.labels.join(", ")}]` : "";
        lines.push(`- **#${pr.number}**: ${pr.title} (${status})${labels}`);

        if (pr.body && pr.body.trim()) {
          // Clean markdown: remove comments, images, hyperlinks, emojis
          const cleanBody = cleanMarkdown(pr.body);
          if (cleanBody.length > 0) {
            // Wrap in blockquote for nested markdown separation
            lines.push(toBlockquote(cleanBody));
          }
        }
      }
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
