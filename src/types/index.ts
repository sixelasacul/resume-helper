/**
 * Represents a configuration value that can be:
 * - The actual value (T)
 * - "$pending" - not yet asked to the user
 * - "$declined" - user was asked and explicitly declined
 *
 * The "$" prefix avoids collision with actual values
 * (e.g., a file path literally named "declined").
 */
export type ConfigValue<T> = T | "$pending" | "$declined";

export interface GitCommit {
  hash: string;
  date: string;
  author: string;
  email: string;
  message: string;
  files: GitFileChange[];
  stats: {
    additions: number;
    deletions: number;
    total: number;
  };
  isMerge: boolean;
}

export interface GitFileChange {
  path: string;
  additions: number;
  deletions: number;
  status: "added" | "modified" | "deleted" | "renamed";
}

export interface GitRepository {
  path: string;
  name: string;
  remote?: string;
  isGitHub: boolean;
  githubUrl?: string;
  commits: GitCommit[];
}

export interface GitHubPR {
  number: number;
  title: string;
  body: string;
  state: string;
  createdAt: string;
  mergedAt?: string;
  commits: string[]; // commit hashes
  labels: string[];
  author: string;
  repositoryName?: string; // Name of the repository this PR belongs to
}

export interface SlackMessage {
  ts: string;
  text: string;
  user: string;
  channel: string;
  channelName: string;
  thread_ts?: string;
  replies?: SlackMessage[];
  reactions?: Array<{
    name: string;
    count: number;
  }>;
}

export interface ResumeConfig {
  companyName: string;
  startDate: string;
  endDate: string;
  repositories: string[];
  authorEmails: string[];

  // Optional plugin fields with explicit state tracking
  githubToken: ConfigValue<string>;
  templatePath: ConfigValue<string>;
  templateContent: ConfigValue<string>; // Alternative to templatePath - inline pasted content
  slackAiFilePath: ConfigValue<string>;
  slackAiContent: ConfigValue<string>; // Alternative to slackAiFilePath - inline pasted content

  // Settings with defaults (not optional plugins)
  language: string;
  aiProvider?: "openai" | "anthropic";
  aiApiKey?: string;
  maxCommits?: number; // Default: 100 - Maximum commits to include per repository (also limits PRs)
  minimumCommitChanges?: number; // Default: 3 - Minimum lines changed to include a commit
}

export interface GeneratedContent {
  projects: ProjectSummary[];
  skills: TechnicalSkill[];
  achievements: Achievement[];
  summary: string;
}

export interface ProjectSummary {
  name: string;
  description: string;
  technologies: string[];
  contributions: string[];
  impact: string;
  period: string;
  githubUrl?: string;
}

export interface TechnicalSkill {
  name: string;
  category: "language" | "framework" | "tool" | "database" | "cloud" | "other";
  proficiency: "beginner" | "intermediate" | "advanced" | "expert";
  usage: number; // frequency of use in commits
}

export interface Achievement {
  description: string;
  impact: string;
  evidence: string[]; // commit hashes, PR numbers, etc.
  timeframe: string;
}

export interface AnalysisResult {
  repositories: GitRepository[];
  pullRequests: GitHubPR[];
  slackMessages: SlackMessage[];
  generatedContent: GeneratedContent;
}
