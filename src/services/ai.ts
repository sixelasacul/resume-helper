import type {
  GitRepository,
  GitHubPR,
  SlackMessage,
  ResumeConfig,
  GeneratedContent,
  ProjectSummary,
  TechnicalSkill,
  Achievement,
} from "../types/index.js";
import type { TechnologyMention } from "../plugins/git/GitService.js";
import { cleanMarkdown } from "../utils/markdown.js";

export interface ResumePromptData {
  companyName: string;
  period: { start: string; end: string };
  repositories: GitRepository[];
  technologies: TechnologyMention[];
  pullRequests: GitHubPR[];
  slackMessages: SlackMessage[];
  templateExample?: string;
  maxCommits?: number; // Default: 100 - also used for max PRs
  minimumCommitChanges?: number; // Default: 3
  language?: string; // Language for resume content (e.g., "French", "Spanish")
  slackAiContext?: string; // Pre-summarized context from Slack AI (via slack-prompt command)
  pluginContent?: string; // Pre-generated content from plugins (new plugin system)
}

export interface PromptExport {
  prompt: string;
  context: string;
  metadata: {
    generatedAt: string;
    dataStats: {
      repositoryCount: number;
      commitCount: number;
      prCount: number;
      slackMessageCount: number;
      technologyCount: number;
    };
  };
}

export class AIService {
  private config: ResumeConfig;

  constructor(config: ResumeConfig) {
    this.config = config;
  }

  /**
   * Build a comprehensive prompt for resume generation
   * This is the default behavior - export prompt for manual AI use
   */
  buildPrompt(data: ResumePromptData): PromptExport {
    const context = this.buildContext(data);
    const prompt = this.buildInstructions(data);

    const commitCount = data.repositories.reduce((sum, r) => sum + r.commits.length, 0);

    return {
      prompt,
      context,
      metadata: {
        generatedAt: new Date().toISOString(),
        dataStats: {
          repositoryCount: data.repositories.length,
          commitCount,
          prCount: data.pullRequests.length,
          slackMessageCount: data.slackMessages.length,
          technologyCount: data.technologies.length,
        },
      },
    };
  }

  /**
   * Build context section with all collected data
   *
   * If `pluginContent` is provided (from the new plugin system), it takes precedence
   * over the legacy fields (repositories, technologies, pullRequests, slackMessages).
   * The plugin content is already formatted and ready to use.
   */
  private buildContext(data: ResumePromptData): string {
    const sections: string[] = [];

    // Company and period info (always included)
    sections.push(`# Context: ${data.companyName} - Work Period`);
    sections.push(`**Period:** ${data.period.start} to ${data.period.end}\n`);

    // If plugin content is provided, use it instead of legacy format
    if (data.pluginContent) {
      sections.push(data.pluginContent);

      // Template example if provided (still relevant with plugins)
      if (data.templateExample) {
        sections.push("\n## Reference Style Template\n");
        sections.push("The following is an example of the desired resume style and format:\n");
        sections.push("```");
        sections.push(data.templateExample);
        sections.push("```");
      }

      return sections.join("\n");
    }

    // Legacy format: build context from individual data fields
    const maxCommits = data.maxCommits ?? 100;
    const minimumCommitChanges = data.minimumCommitChanges ?? 3;

    // Repository contributions
    sections.push("## Git Repositories and Contributions\n");
    for (const repo of data.repositories) {
      sections.push(this.formatRepositoryContext(repo, maxCommits, minimumCommitChanges));
    }

    // Technologies detected
    if (data.technologies.length > 0) {
      sections.push("\n## Technologies Used\n");
      sections.push(this.formatTechnologiesContext(data.technologies));
    }

    // GitHub Pull Requests - use maxCommits as the limit since PRs map to commits
    if (data.pullRequests.length > 0) {
      sections.push("\n## GitHub Pull Requests\n");
      sections.push(this.formatPullRequestsContext(data.pullRequests, maxCommits));
    }

    // Slack messages (collaboration evidence from API)
    if (data.slackMessages.length > 0) {
      sections.push("\n## Team Collaboration (Slack)\n");
      sections.push(this.formatSlackContext(data.slackMessages));
    }

    // Slack AI context (pre-summarized collaboration insights)
    if (data.slackAiContext) {
      sections.push("\n## Collaboration Insights (from Slack AI)\n");
      sections.push("The following is a pre-summarized analysis of Slack conversations:\n");
      sections.push(data.slackAiContext);
    }

    // Template example if provided
    if (data.templateExample) {
      sections.push("\n## Reference Style Template\n");
      sections.push("The following is an example of the desired resume style and format:\n");
      sections.push("```");
      sections.push(data.templateExample);
      sections.push("```");
    }

    return sections.join("\n");
  }

  /**
   * Format repository data for context
   */
  private formatRepositoryContext(
    repo: GitRepository,
    maxCommits: number,
    minimumCommitChanges: number,
  ): string {
    const lines: string[] = [];
    lines.push(`### ${repo.name}`);

    if (repo.githubUrl) {
      lines.push(`- **GitHub:** ${repo.githubUrl}`);
    }

    const totalAdditions = repo.commits.reduce((sum, c) => sum + c.stats.additions, 0);
    const totalDeletions = repo.commits.reduce((sum, c) => sum + c.stats.deletions, 0);

    // Filter commits: exclude merges and those below minimum changes threshold
    const filteredCommits = repo.commits
      .filter((c) => !c.isMerge)
      .filter((c) => c.stats.total >= minimumCommitChanges);

    // Cap at maxCommits
    const displayCommits = filteredCommits.slice(0, maxCommits);
    const wasTruncated = filteredCommits.length > maxCommits;

    // Show commit count with truncation info
    if (wasTruncated) {
      lines.push(
        `- **Commits:** ${repo.commits.length} (showing ${displayCommits.length} of ${filteredCommits.length})`,
      );
    } else {
      lines.push(`- **Commits:** ${repo.commits.length}`);
    }
    lines.push(`- **Lines changed:** +${totalAdditions} / -${totalDeletions}`);

    // List all commits with description extraction
    if (displayCommits.length > 0) {
      lines.push("\n**Commits:**");
      for (const commit of displayCommits) {
        const date = this.formatDateISO(commit.date);
        const description = this.extractCommitDescription(commit.message);
        lines.push(
          `- [${date}] ${description} (+${commit.stats.additions}/-${commit.stats.deletions})`,
        );
      }
    }

    lines.push("");
    return lines.join("\n");
  }

  /**
   * Format date as ISO format (YYYY-MM-DD)
   */
  private formatDateISO(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toISOString().split("T")[0] ?? dateStr;
  }

  /**
   * Extract meaningful description from commit message
   * For conventional commits: extract the description after the type/scope prefix
   * For non-conventional: use full message (truncated to ~100 chars)
   */
  private extractCommitDescription(message: string): string {
    // Trim to handle leading/trailing whitespace
    const trimmedMessage = message.trim();

    // Conventional commit regex: type(scope)?: description
    // Scope can contain: word chars, digits, slashes, underscores, hyphens, dots
    const conventionalRegex = /^(?:\w+)(?:\([\w\d\/_.\-]+\))?:\s*(.+)/;
    const match = trimmedMessage.match(conventionalRegex);

    if (match && match[1]) {
      return match[1].trim();
    }

    // Non-conventional: use full message, truncated
    const maxLength = 100;
    if (trimmedMessage.length > maxLength) {
      return trimmedMessage.slice(0, maxLength - 3).trim() + "...";
    }

    return trimmedMessage;
  }

  /**
   * Format technologies for context
   */
  private formatTechnologiesContext(technologies: TechnologyMention[]): string {
    const byCategory = new Map<string, TechnologyMention[]>();

    for (const tech of technologies) {
      const list = byCategory.get(tech.category) || [];
      list.push(tech);
      byCategory.set(tech.category, list);
    }

    const lines: string[] = [];
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
        const names = techs.map((t) => t.name).join(", ");
        lines.push(`- **${this.capitalizeCategory(category)}:** ${names}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Capitalize category name
   */
  private capitalizeCategory(category: string): string {
    const mapping: Record<string, string> = {
      language: "Languages",
      framework: "Frameworks",
      library: "Libraries",
      database: "Databases",
      cloud: "Cloud Services",
      infrastructure: "Infrastructure",
      tool: "Tools",
    };
    return mapping[category] || category;
  }

  /**
   * Format pull requests for context
   */
  private formatPullRequestsContext(pullRequests: GitHubPR[], maxPRsTotal: number = 20): string {
    const lines: string[] = [];

    // Group PRs by repository
    const prsByRepo = new Map<string, GitHubPR[]>();
    for (const pr of pullRequests) {
      const repoName = pr.repositoryName || "Unknown Repository";
      const list = prsByRepo.get(repoName) || [];
      list.push(pr);
      prsByRepo.set(repoName, list);
    }

    let totalShown = 0;

    for (const [repoName, repoPRs] of prsByRepo) {
      // Sort by date, most recent first
      const sorted = [...repoPRs].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      lines.push(`\n### ${repoName}\n`);

      for (const pr of sorted) {
        if (totalShown >= maxPRsTotal) break;

        const date = new Date(pr.createdAt).toLocaleDateString();
        const status = pr.mergedAt ? "merged" : pr.state;
        lines.push(`- **#${pr.number}** ${pr.title} (${status}, ${date})`);

        if (pr.body && pr.body.length > 0) {
          // Clean up the body: strip comments, images, and convert links to text
          const cleanBody = cleanMarkdown(pr.body);
          if (cleanBody.length > 0) {
            // Indent PR body content
            const indentedBody = cleanBody
              .split("\n")
              .map((line) => `  > ${line}`)
              .join("\n");
            lines.push(indentedBody);
          }
        }
        totalShown++;
      }

      if (totalShown >= maxPRsTotal) break;
    }

    if (pullRequests.length > maxPRsTotal) {
      lines.push(`\n_...and ${pullRequests.length - maxPRsTotal} more pull requests_`);
    }

    return lines.join("\n");
  }

  /**
   * Format Slack messages for context
   */
  private formatSlackContext(messages: SlackMessage[]): string {
    const lines: string[] = [];

    // Group by channel
    const byChannel = new Map<string, SlackMessage[]>();
    for (const msg of messages) {
      const list = byChannel.get(msg.channelName) || [];
      list.push(msg);
      byChannel.set(msg.channelName, list);
    }

    for (const [channel, msgs] of byChannel) {
      lines.push(`\n### #${channel} (${msgs.length} messages)`);

      // Find messages with most engagement (reactions, threads)
      const engaged = msgs
        .filter(
          (m) => (m.reactions && m.reactions.length > 0) || (m.replies && m.replies.length > 0),
        )
        .slice(0, 5);

      if (engaged.length > 0) {
        lines.push("\n**Key Discussions:**");
        for (const msg of engaged) {
          const reactions = msg.reactions?.reduce((sum, r) => sum + r.count, 0) || 0;
          const replyCount = msg.replies?.length || 0;
          const engagement = [];
          if (reactions > 0) engagement.push(`${reactions} reactions`);
          if (replyCount > 0) engagement.push(`${replyCount} replies`);

          const truncatedText = msg.text.slice(0, 150).replace(/\n/g, " ");
          lines.push(
            `- "${truncatedText}${msg.text.length > 150 ? "..." : ""}" (${engagement.join(", ")})`,
          );
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Build the instruction prompt for AI
   */
  private buildInstructions(data: ResumePromptData): string {
    // Add language instruction if not English
    const languageInstruction =
      data.language && data.language.toLowerCase() !== "english"
        ? `\n## Language\n\nThe source content (commits, PRs, messages) is in **${data.language}**. Generate all resume content in **${data.language}**.\n`
        : "";

    return `# Resume Content Generation Instructions

You are a professional resume writer helping to create compelling resume content for a software engineer.
${languageInstruction}
## Your Task

Using the context data provided below, generate professional resume content that:

1. **Highlights technical contributions** through concrete achievements
2. **Demonstrates impact** on projects and team
3. **Uses strong action verbs** (implemented, architected, optimized, led, etc.)
4. **Focuses on outcomes**, not tasks or raw statistics

## Output Format

Generate the following sections:

### Professional Summary
1-2 sentences describing the role and main focus areas at ${data.companyName} during this period.

### Key Achievements
5-7 bullet points highlighting the most significant accomplishments. Each bullet should:
- Start with a strong action verb
- Focus on IMPACT and OUTCOMES, not tasks
- Be concise (1-2 sentences max)
- Group related work across repositories when it makes sense

### Technologies
A simple comma-separated list of the main technologies used during this period. No proficiency ratings.

## Important Guidelines

- Focus on outcomes and impact, not just tasks completed
- Highlight leadership, collaboration, and mentorship where evident
- Avoid generic statements; use concrete examples from the data
- Match the tone and style of any provided template
- If Slack AI insights are provided, use them to enrich achievements with collaboration stories, cross-team work, and soft skills that code doesn't show

## What NOT to Include

- **No commit counts or lines of code** - these are provided for context only, to help you understand the scope of work
- **No proficiency ratings** - do not use stars, percentages, or skill level indicators
- **No per-project statistics** - avoid metrics tables or raw data summaries
- **No emojis** in the output

The commit data and line counts in the context below are meant to help you gauge the **scope and significance** of contributions, but should NOT appear in the final resume content.

---

${this.buildContext(data)}
`;
  }

  /**
   * Export prompt to markdown file format
   * Returns the prompt directly without wrapper sections for easy copy-paste
   */
  exportToMarkdown(promptExport: PromptExport): string {
    // Return the prompt directly - no wrapper needed
    // The prompt already contains instructions + context
    return promptExport.prompt;
  }

  /**
   * Estimate the number of tokens in the prompt
   * Uses a conservative estimate of ~3.5 characters per token
   * This accounts for non-English text which tends to use more tokens per character
   *
   * Note: This is a rough estimate. For more accurate token counting,
   * consider using tiktoken library in the future.
   */
  estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Generate resume content using TanStack AI
   * Only called when --with-ai flag is used
   */
  async generateWithAI(data: ResumePromptData): Promise<GeneratedContent> {
    if (!this.config.aiProvider || !this.config.aiApiKey) {
      throw new Error(
        "AI provider and API key required. Configure with `resume-cli init` or use --export-prompt instead.",
      );
    }

    const promptExport = this.buildPrompt(data);

    let response: string;

    if (this.config.aiProvider === "anthropic") {
      response = await this.generateWithAnthropic(promptExport.prompt);
    } else if (this.config.aiProvider === "openai") {
      response = await this.generateWithOpenAI(promptExport.prompt);
    } else {
      throw new Error(`Unsupported AI provider: ${this.config.aiProvider}`);
    }

    return this.parseAIResponse(response);
  }

  /**
   * Generate with Anthropic Claude using TanStack AI chat
   */
  private async generateWithAnthropic(prompt: string): Promise<string> {
    // Using direct API call for simplicity - TanStack AI requires adapter setup
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.aiApiKey || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${error}`);
    }

    const data = (await response.json()) as { content: Array<{ text: string }> };
    return data.content[0]?.text || "";
  }

  /**
   * Generate with OpenAI using TanStack AI chat
   */
  private async generateWithOpenAI(prompt: string): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.aiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content || "";
  }

  /**
   * Parse AI response into structured content
   */
  private parseAIResponse(response: string): GeneratedContent {
    // Extract sections from AI response
    const projects = this.extractProjects(response);
    const skills = this.extractSkills(response);
    const achievements = this.extractAchievements(response);
    const summary = this.extractSummary(response);

    return {
      projects,
      skills,
      achievements,
      summary,
    };
  }

  /**
   * Extract projects section from AI response
   */
  private extractProjects(response: string): ProjectSummary[] {
    const projects: ProjectSummary[] = [];

    // Look for project sections
    const projectMatch = response.match(/##?\s*Projects?\s*\n([\s\S]*?)(?=##|\n---|\Z)/i);
    if (projectMatch && projectMatch[1]) {
      const projectsText = projectMatch[1];
      // Parse individual projects (basic parsing, AI response may vary)
      const projectBlocks = projectsText.split(/###?\s+/).filter((b) => b.trim());

      for (const block of projectBlocks) {
        const lines = block.split("\n").filter((l) => l.trim());
        const firstLine = lines[0];
        if (lines.length > 0 && firstLine) {
          projects.push({
            name: firstLine.replace(/[*_]/g, "").trim(),
            description: lines.slice(1, 3).join(" ").trim(),
            technologies: this.extractListItems(block, /technologies?|tech stack/i),
            contributions: this.extractBulletPoints(block),
            impact: this.extractAfterKeyword(block, /impact|result/i),
            period: this.extractAfterKeyword(block, /period|timeframe|date/i) || "",
          });
        }
      }
    }

    return projects;
  }

  /**
   * Extract skills from AI response
   */
  private extractSkills(response: string): TechnicalSkill[] {
    const skills: TechnicalSkill[] = [];

    const skillsMatch = response.match(
      /##?\s*(?:Technical\s+)?Skills?\s*\n([\s\S]*?)(?=##|\n---|\Z)/i,
    );
    if (skillsMatch && skillsMatch[1]) {
      const skillsText = skillsMatch[1];
      const lines = skillsText.split("\n").filter((l) => l.trim());

      for (const line of lines) {
        const cleanLine = line.replace(/^[-*]\s*/, "").trim();
        if (cleanLine && !cleanLine.startsWith("#")) {
          // Try to extract skill and category
          const match = cleanLine.match(/\*\*([^*]+)\*\*:?\s*(.*)/);
          if (match && match[1] && match[2]) {
            const category = match[1];
            const skillList = match[2];
            const skillNames = skillList
              .split(/[,;]/)
              .map((s) => s.trim())
              .filter(Boolean);

            for (const name of skillNames) {
              skills.push({
                name,
                category: this.mapSkillCategory(category),
                proficiency: "intermediate",
                usage: 1,
              });
            }
          }
        }
      }
    }

    return skills;
  }

  /**
   * Map category string to skill category
   */
  private mapSkillCategory(category: string): TechnicalSkill["category"] {
    const lower = category.toLowerCase();
    if (lower.includes("language")) return "language";
    if (lower.includes("framework")) return "framework";
    if (lower.includes("database")) return "database";
    if (lower.includes("cloud")) return "cloud";
    if (lower.includes("tool")) return "tool";
    return "other";
  }

  /**
   * Extract achievements from AI response
   */
  private extractAchievements(response: string): Achievement[] {
    const achievements: Achievement[] = [];

    const achievementsMatch = response.match(
      /##?\s*(?:Key\s+)?Achievements?\s*\n([\s\S]*?)(?=##|\n---|\Z)/i,
    );
    if (achievementsMatch && achievementsMatch[1]) {
      const achievementsText = achievementsMatch[1];
      const bullets = achievementsText.match(/^[-*]\s+.+$/gm) || [];

      for (const bullet of bullets) {
        const text = bullet.replace(/^[-*]\s+/, "").trim();
        achievements.push({
          description: text,
          impact: "",
          evidence: [],
          timeframe: "",
        });
      }
    }

    return achievements;
  }

  /**
   * Extract summary from AI response
   */
  private extractSummary(response: string): string {
    const summaryMatch = response.match(
      /##?\s*(?:Professional\s+)?Summary\s*\n([\s\S]*?)(?=##|\n---)/i,
    );
    if (summaryMatch && summaryMatch[1]) {
      return summaryMatch[1].trim();
    }
    return "";
  }

  /**
   * Helper to extract bullet points
   */
  private extractBulletPoints(text: string): string[] {
    const bullets = text.match(/^[-*]\s+.+$/gm) || [];
    return bullets.map((b) => b.replace(/^[-*]\s+/, "").trim());
  }

  /**
   * Helper to extract list items after a keyword
   */
  private extractListItems(text: string, pattern: RegExp): string[] {
    const lines = text.split("\n");
    const startIdx = lines.findIndex((l) => pattern.test(l));

    if (startIdx >= 0) {
      const nextLine = lines[startIdx + 1];
      if (nextLine) {
        // Check if comma-separated list
        if (nextLine.includes(",")) {
          return nextLine
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
      }
    }

    return [];
  }

  /**
   * Helper to extract text after a keyword
   */
  private extractAfterKeyword(text: string, pattern: RegExp): string {
    const lines = text.split("\n");
    const line = lines.find((l) => pattern.test(l));

    if (line) {
      const match = line.match(/:\s*(.+)/);
      if (match && match[1]) return match[1].trim();
    }

    return "";
  }
}
