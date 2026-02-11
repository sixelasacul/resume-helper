import { Octokit } from "@octokit/rest";
import type { GitHubPR } from "../../types/index.js";

export class GitHubService {
  private octokit: Octokit;
  private baseUrl: string;

  constructor(token: string, enterpriseUrl?: string) {
    this.baseUrl = enterpriseUrl || "https://api.github.com";

    this.octokit = new Octokit({
      auth: token,
      baseUrl: this.baseUrl,
    });
  }

  /**
   * Parse GitHub repository information from URL
   */
  parseRepoUrl(githubUrl: string): { owner: string; repo: string; apiUrl: string } | null {
    // Handle various GitHub URL formats
    const patterns = [
      // HTTPS: https://github.com/owner/repo
      /https:\/\/([^\/]+)\/([^\/]+)\/([^\/]+)/,
      // SSH: git@github.com:owner/repo.git
      /git@([^:]+):([^\/]+)\/(.+?)(?:\.git)?$/,
    ];

    for (const pattern of patterns) {
      const match = githubUrl.match(pattern);
      if (match) {
        const host = match[1] || "";
        const owner = match[2] || "";
        const repo = match[3] || "";

        // Determine API URL based on host
        let apiUrl: string;
        if (host === "github.com") {
          apiUrl = "https://api.github.com";
        } else {
          // GitHub Enterprise
          apiUrl = `https://${host}/api/v3`;
        }

        return {
          owner,
          repo: repo.replace(/\.git$/, ""), // Remove .git suffix
          apiUrl,
        };
      }
    }

    return null;
  }

  /**
   * Get pull requests associated with specific commit hashes
   */
  async getPullRequestsForCommits(
    owner: string,
    repo: string,
    commitHashes: string[],
  ): Promise<GitHubPR[]> {
    const pullRequests: GitHubPR[] = [];

    for (const hash of commitHashes) {
      try {
        const prs = await this.getPullRequestsForCommit(owner, repo, hash);
        pullRequests.push(...prs);
      } catch (error) {
        console.warn(`Could not fetch PR for commit ${hash}:`, error);
      }
    }

    // Remove duplicates
    const uniquePRs = pullRequests.filter(
      (pr, index, arr) => index === arr.findIndex((p) => p.number === pr.number),
    );

    return uniquePRs;
  }

  /**
   * Get pull requests for a single commit
   */
  private async getPullRequestsForCommit(
    owner: string,
    repo: string,
    commitHash: string,
  ): Promise<GitHubPR[]> {
    try {
      const response = await this.octokit.rest.repos.listPullRequestsAssociatedWithCommit({
        owner,
        repo,
        commit_sha: commitHash,
      });

      return response.data.map((pr) => ({
        number: pr.number,
        title: pr.title,
        body: pr.body || "",
        state: pr.state,
        createdAt: pr.created_at,
        mergedAt: pr.merged_at || undefined,
        commits: [commitHash], // We know this commit is associated
        labels: pr.labels.map((label) => (typeof label === "string" ? label : label.name || "")),
        author: pr.user?.login || "unknown",
      }));
    } catch {
      // If the API endpoint fails, try to find PRs by merge commit message
      return this.findPRsByMergeCommit(owner, repo, commitHash);
    }
  }

  /**
   * Fallback: Find PRs by analyzing merge commit messages
   */
  private async findPRsByMergeCommit(
    owner: string,
    repo: string,
    commitHash: string,
  ): Promise<GitHubPR[]> {
    try {
      // Get the commit details
      const commitResponse = await this.octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: commitHash,
      });

      const commitMessage = commitResponse.data.commit.message;

      // Look for PR number in commit message (e.g., "Merge pull request #123")
      const prMatch = commitMessage.match(/Merge pull request #(\d+)|\(#(\d+)\)/);
      if (prMatch) {
        const prNumberStr = prMatch[1] || prMatch[2];
        if (prNumberStr) {
          const prNumber = parseInt(prNumberStr, 10);
          const pr = await this.getPullRequest(owner, repo, prNumber);
          return pr ? [pr] : [];
        }
      }
    } catch (error) {
      console.warn(`Could not analyze merge commit ${commitHash}:`, error);
    }

    return [];
  }

  /**
   * Get a specific pull request by number
   */
  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPR | null> {
    try {
      const response = await this.octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      const pr = response.data;

      // Get commits for this PR
      const commitsResponse = await this.octokit.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: prNumber,
      });

      return {
        number: pr.number,
        title: pr.title,
        body: pr.body || "",
        state: pr.state,
        createdAt: pr.created_at,
        mergedAt: pr.merged_at || undefined,
        commits: commitsResponse.data.map((commit) => commit.sha),
        labels: pr.labels.map((label) => label.name || ""),
        author: pr.user?.login || "unknown",
      };
    } catch (error) {
      console.warn(`Could not fetch PR #${prNumber}:`, error);
      return null;
    }
  }

  /**
   * Get repository information
   */
  async getRepositoryInfo(
    owner: string,
    repo: string,
  ): Promise<{
    description: string;
    topics: string[];
    starCount: number;
    language: string;
    readme?: string;
  } | null> {
    try {
      const repoResponse = await this.octokit.rest.repos.get({
        owner,
        repo,
      });

      const repoData = repoResponse.data;

      // Try to get README
      let readme: string | undefined;
      try {
        const readmeResponse = await this.octokit.rest.repos.getReadme({
          owner,
          repo,
        });

        // Decode base64 content
        readme = Buffer.from(readmeResponse.data.content, "base64").toString("utf-8");
      } catch {
        // README not found or not accessible
      }

      return {
        description: repoData.description || "",
        topics: repoData.topics || [],
        starCount: repoData.stargazers_count,
        language: repoData.language || "",
        readme,
      };
    } catch (error) {
      console.warn(`Could not fetch repository info for ${owner}/${repo}:`, error);
      return null;
    }
  }

  /**
   * Search for pull requests by author and date range
   */
  async searchPullRequestsByAuthor(
    owner: string,
    repo: string,
    author: string,
    startDate?: string,
    endDate?: string,
  ): Promise<GitHubPR[]> {
    try {
      let query = `repo:${owner}/${repo} author:${author} is:pr`;

      if (startDate) {
        query += ` created:>=${startDate}`;
      }
      if (endDate) {
        query += ` created:<=${endDate}`;
      }

      const response = await this.octokit.rest.search.issuesAndPullRequests({
        q: query,
        sort: "created",
        order: "desc",
        per_page: 100,
      });

      const pullRequests: GitHubPR[] = [];

      for (const item of response.data.items) {
        if (item.pull_request) {
          // Get full PR details
          const pr = await this.getPullRequest(owner, repo, item.number);
          if (pr) {
            pullRequests.push(pr);
          }
        }
      }

      return pullRequests;
    } catch (error) {
      console.warn(`Could not search PRs for author ${author}:`, error);
      return [];
    }
  }

  /**
   * Test API connection and permissions
   */
  async testConnection(): Promise<{ success: boolean; user?: string; error?: string }> {
    try {
      const response = await this.octokit.rest.users.getAuthenticated();
      return {
        success: true,
        user: response.data.login,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get rate limit information
   */
  async getRateLimit(): Promise<{
    limit: number;
    remaining: number;
    resetTime: Date;
  } | null> {
    try {
      const response = await this.octokit.rest.rateLimit.get();
      const core = response.data.rate;

      return {
        limit: core.limit,
        remaining: core.remaining,
        resetTime: new Date(core.reset * 1000),
      };
    } catch (error) {
      console.warn("Could not fetch rate limit info:", error);
      return null;
    }
  }

  /**
   * Extract PR number from commit message
   */
  static extractPRNumber(commitMessage: string): number | null {
    const patterns = [/Merge pull request #(\d+)/i, /\(#(\d+)\)$/, /#(\d+)/];

    for (const pattern of patterns) {
      const match = commitMessage.match(pattern);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }

    return null;
  }

  /**
   * Create GitHub service from repository URL
   */
  static async fromRepository(githubUrl: string, token: string): Promise<GitHubService | null> {
    // Parse URL to determine if it's enterprise
    const patterns = [
      /https:\/\/([^\/]+)\//, // Extract host from HTTPS URL
      /git@([^:]+):/, // Extract host from SSH URL
    ];

    let host = "github.com";
    for (const pattern of patterns) {
      const match = githubUrl.match(pattern);
      if (match) {
        host = match[1] || "github.com";
        break;
      }
    }

    // Create service with appropriate base URL
    const enterpriseUrl = host === "github.com" ? undefined : `https://${host}/api/v3`;
    return new GitHubService(token, enterpriseUrl);
  }
}
