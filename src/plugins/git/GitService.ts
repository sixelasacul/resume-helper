import { spawn } from "child_process";
import { access, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, basename } from "path";
import type { GitCommit, GitFileChange, GitRepository } from "../../types/index.js";
import * as linguistLanguages from "linguist-languages";

// Build extension-to-language map from linguist-languages
type LinguistLanguage = {
  name: string;
  type: string;
  extensions?: readonly string[];
  filenames?: readonly string[];
};

const extensionToLanguageMap = new Map<string, string>();
const filenameToLanguageMap = new Map<string, string>();

// Only include programming languages (not data, markup, or prose)
for (const [, lang] of Object.entries(linguistLanguages) as [string, LinguistLanguage][]) {
  if (lang && typeof lang === "object" && lang.name && lang.type === "programming") {
    if (lang.extensions) {
      for (const ext of lang.extensions) {
        // Store without the leading dot for easier lookup
        extensionToLanguageMap.set(ext.slice(1).toLowerCase(), lang.name);
      }
    }
    if (lang.filenames) {
      for (const filename of lang.filenames) {
        filenameToLanguageMap.set(filename.toLowerCase(), lang.name);
      }
    }
  }
}

// Technology detection result
export interface TechnologyMention {
  name: string;
  category: "language" | "framework" | "tool" | "database" | "cloud" | "library" | "infrastructure";
  source: "readme" | "file" | "commit" | "dependency";
  confidence: "high" | "medium" | "low";
}

export class GitService {
  /**
   * Analyze a repository for commit data
   */
  async analyzeRepository(
    repoPath: string,
    authorEmails: string[],
    startDate?: string,
    endDate?: string,
  ): Promise<GitRepository> {
    // Validate repository
    await this.validateRepository(repoPath);

    const repoName = basename(repoPath);
    const remote = await this.getRemoteUrl(repoPath);
    const isGitHub = this.isGitHubRepository(remote);

    // Extract commits
    const commits = await this.getCommits(repoPath, authorEmails, startDate, endDate);

    return {
      path: repoPath,
      name: repoName,
      remote,
      isGitHub,
      githubUrl: isGitHub ? this.parseGitHubUrl(remote) : undefined,
      commits,
    };
  }

  /**
   * Get commits for specific authors in date range
   */
  private async getCommits(
    repoPath: string,
    authorEmails: string[],
    startDate?: string,
    endDate?: string,
  ): Promise<GitCommit[]> {
    const commits: GitCommit[] = [];

    for (const email of authorEmails) {
      const authorCommits = await this.getCommitsForAuthor(repoPath, email, startDate, endDate);
      commits.push(...authorCommits);
    }

    // Remove duplicates and sort by date
    const uniqueCommits = commits.filter(
      (commit, index, arr) => index === arr.findIndex((c) => c.hash === commit.hash),
    );

    return uniqueCommits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  /**
   * Get commits for a specific author
   */
  private async getCommitsForAuthor(
    repoPath: string,
    authorEmail: string,
    startDate?: string,
    endDate?: string,
  ): Promise<GitCommit[]> {
    // Build git log command
    const args = [
      "log",
      `--author=${authorEmail}`,
      "--pretty=format:COMMIT|%H|%ad|%an|%ae|%s",
      "--date=iso",
      "--numstat",
    ];

    if (startDate) args.push(`--since=${startDate}`);
    if (endDate) args.push(`--until=${endDate}`);

    const output = await this.execGit(repoPath, args);
    return this.parseGitLogOutput(output);
  }

  /**
   * Parse git log output into structured commits
   */
  private parseGitLogOutput(output: string): GitCommit[] {
    const commits: GitCommit[] = [];
    const lines = output.split("\n").filter((line) => line.trim());

    let currentCommit: Partial<GitCommit> | null = null;

    for (const line of lines) {
      if (line.startsWith("COMMIT|")) {
        // Save previous commit if exists
        if (currentCommit) {
          commits.push(this.finalizeCommit(currentCommit));
        }

        // Parse commit line: COMMIT|hash|date|author|email|message
        const parts = line.split("|");
        if (parts.length < 6) continue; // Skip malformed lines

        const hash = parts[1] || "";
        const date = parts[2] || "";
        const author = parts[3] || "";
        const email = parts[4] || "";
        const message = parts.slice(5).join("|");

        currentCommit = {
          hash,
          date,
          author,
          email,
          message,
          files: [],
          stats: { additions: 0, deletions: 0, total: 0 },
          isMerge: this.isMergeCommit(message),
        };
      } else if (currentCommit && line.includes("\t")) {
        // Parse file change line: additions\tdeletions\tfilepath
        const parts = line.split("\t");
        if (parts.length >= 3) {
          const additions = parts[0] || "";
          const deletions = parts[1] || "";
          const filepath = parts[2] || "";

          const fileChange: GitFileChange = {
            path: filepath,
            additions: additions === "-" ? 0 : parseInt(additions, 10) || 0,
            deletions: deletions === "-" ? 0 : parseInt(deletions, 10) || 0,
            status: this.determineFileStatus(additions, deletions),
          };

          currentCommit.files!.push(fileChange);
          currentCommit.stats!.additions += fileChange.additions;
          currentCommit.stats!.deletions += fileChange.deletions;
        }
      }
    }

    // Don't forget the last commit
    if (currentCommit) {
      commits.push(this.finalizeCommit(currentCommit));
    }

    return commits;
  }

  /**
   * Finalize commit data
   */
  private finalizeCommit(commit: Partial<GitCommit>): GitCommit {
    const stats = commit.stats!;
    stats.total = stats.additions + stats.deletions;

    return commit as GitCommit;
  }

  /**
   * Determine file change status
   */
  private determineFileStatus(additions: string, deletions: string): GitFileChange["status"] {
    if (additions === "-" && deletions === "-") return "renamed";
    if (deletions === "-") return "added";
    if (additions === "-") return "deleted";
    return "modified";
  }

  /**
   * Check if commit is a merge commit
   */
  private isMergeCommit(message: string): boolean {
    return (
      /^Merge (pull request|branch)/i.test(message) ||
      /^Merge.*into/i.test(message) ||
      (message.includes("#") && /merge|pull/i.test(message))
    );
  }

  /**
   * Get repository remote URL
   */
  private async getRemoteUrl(repoPath: string): Promise<string | undefined> {
    try {
      const output = await this.execGit(repoPath, ["remote", "get-url", "origin"]);
      return output.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Check if repository is hosted on GitHub (including Enterprise)
   */
  private isGitHubRepository(remoteUrl?: string): boolean {
    if (!remoteUrl) return false;
    return /github\.(com|[a-zA-Z0-9.-]+)/i.test(remoteUrl);
  }

  /**
   * Parse GitHub URL from git remote
   */
  private parseGitHubUrl(remoteUrl?: string): string | undefined {
    if (!remoteUrl) return undefined;

    // Handle SSH format: git@github.com:owner/repo.git
    const sshMatch = remoteUrl.match(/git@([^:]+):(.+)\.git$/);
    if (sshMatch) {
      const [, host, repoPath] = sshMatch;
      return `https://${host}/${repoPath}`;
    }

    // Handle HTTPS format: https://github.com/owner/repo.git
    const httpsMatch = remoteUrl.match(/https:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (httpsMatch) {
      const [, host, repoPath] = httpsMatch;
      return `https://${host}/${repoPath}`;
    }

    return remoteUrl;
  }

  /**
   * Validate that path is a git repository
   */
  private async validateRepository(repoPath: string): Promise<void> {
    try {
      await access(join(repoPath, ".git"));
    } catch {
      throw new Error(`Not a git repository: ${repoPath}`);
    }
  }

  /**
   * Execute git command in repository
   */
  private async execGit(repoPath: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const git = spawn("git", args, {
        cwd: repoPath,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let output = "";
      let error = "";

      git.stdout.on("data", (data) => {
        output += data.toString();
      });

      git.stderr.on("data", (data) => {
        error += data.toString();
      });

      git.on("close", (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Git command failed: ${error || "Unknown error"}`));
        }
      });

      git.on("error", (err) => {
        reject(new Error(`Failed to spawn git: ${err.message}`));
      });
    });
  }

  /**
   * Get file content diff for a commit (for code analysis)
   */
  async getCommitDiff(repoPath: string, commitHash: string): Promise<string> {
    try {
      return await this.execGit(repoPath, ["show", commitHash, "--format=", "--no-merges"]);
    } catch (error) {
      console.warn(`Could not get diff for commit ${commitHash}:`, error);
      return "";
    }
  }

  /**
   * Read repository README file
   */
  async getRepositoryReadme(repoPath: string): Promise<string | null> {
    const readmeFiles = ["README.md", "readme.md", "README.txt", "readme.txt", "README"];

    for (const filename of readmeFiles) {
      try {
        const content = await readFile(join(repoPath, filename), "utf-8");
        return content;
      } catch {
        // Try next file
      }
    }

    return null;
  }

  /**
   * Comprehensive technology detection from all sources
   * Uses intelligent merging: if file-based techs exist, intersect with README techs
   * to show only what the developer actually worked on
   */
  async detectTechnologies(repoPath: string, commits: GitCommit[]): Promise<TechnologyMention[]> {
    // 1. Analyze README
    const readme = await this.getRepositoryReadme(repoPath);
    const readmeTechs = readme ? this.analyzeReadmeForTechnologies(readme) : [];

    // 2. Detect technologies from file extensions in commits (using linguist)
    const allFiles = commits.flatMap((c) => c.files);
    const fileTechs = this.detectTechnologiesFromFileChanges(allFiles);

    // 3. Get infrastructure techs from file paths (Docker, GitHub Actions, etc.)
    const infrastructureTechs = this.analyzeFilePathsForTechnologies(allFiles).filter(
      (t) => t.category === "infrastructure",
    );

    // 4. Analyze dependency files
    const depTechs = await this.analyzeDependencyFiles(repoPath);

    // 5. Intelligent merging for languages/frameworks
    let baseTechs: TechnologyMention[] = [];

    if (fileTechs.length > 0) {
      // Find intersection of README + files (what project uses AND dev touched)
      const intersection = readmeTechs.filter((rt) => fileTechs.some((ft) => ft.name === rt.name));

      // If intersection exists, use it; otherwise use file-based only
      baseTechs = intersection.length > 0 ? intersection : fileTechs;
    } else {
      // Fallback to README-based if no file techs detected
      baseTechs = readmeTechs;
    }

    // 6. Combine all technologies
    const allTechs = [...baseTechs, ...depTechs, ...infrastructureTechs];

    // Deduplicate by name, keeping highest confidence
    return this.deduplicateTechnologies(allTechs);
  }

  /**
   * Detect technologies from file extensions using linguist-languages
   * This shows what the developer actually worked on
   */
  private detectTechnologiesFromFileChanges(files: GitFileChange[]): TechnologyMention[] {
    const technologies: TechnologyMention[] = [];
    const seenTechs = new Set<string>();

    for (const file of files) {
      const path = file.path.toLowerCase();
      const filename = basename(path);
      const ext = path.split(".").pop() || "";

      // Check filename first (e.g., Dockerfile, Makefile)
      const filenameMatch = filenameToLanguageMap.get(filename);
      if (filenameMatch && !seenTechs.has(filenameMatch)) {
        technologies.push({
          name: filenameMatch,
          category: "language",
          source: "file",
          confidence: "high",
        });
        seenTechs.add(filenameMatch);
        continue;
      }

      // Check extension
      const extMatch = extensionToLanguageMap.get(ext);
      if (extMatch && !seenTechs.has(extMatch)) {
        technologies.push({
          name: extMatch,
          category: "language",
          source: "file",
          confidence: "high",
        });
        seenTechs.add(extMatch);
      }
    }

    return technologies;
  }

  /**
   * Analyze README content for technology mentions
   */
  private analyzeReadmeForTechnologies(readme: string): TechnologyMention[] {
    const technologies: TechnologyMention[] = [];
    const lowerReadme = readme.toLowerCase();

    // Comprehensive technology patterns with categories
    const techPatterns: Array<{
      pattern: RegExp;
      name: string;
      category: TechnologyMention["category"];
    }> = [
      // Languages
      { pattern: /\b(typescript|ts)\b/gi, name: "TypeScript", category: "language" },
      { pattern: /\b(javascript|js)\b/gi, name: "JavaScript", category: "language" },
      { pattern: /\bpython\b/gi, name: "Python", category: "language" },
      { pattern: /\bjava\b(?!script)/gi, name: "Java", category: "language" },
      { pattern: /\bgolang|\bgo\b/gi, name: "Go", category: "language" },
      { pattern: /\brust\b/gi, name: "Rust", category: "language" },
      { pattern: /\bruby\b/gi, name: "Ruby", category: "language" },
      { pattern: /\bkotlin\b/gi, name: "Kotlin", category: "language" },
      { pattern: /\bswift\b/gi, name: "Swift", category: "language" },
      { pattern: /\bc\+\+|cpp\b/gi, name: "C++", category: "language" },
      { pattern: /\bc#|csharp\b/gi, name: "C#", category: "language" },
      { pattern: /\bphp\b/gi, name: "PHP", category: "language" },
      { pattern: /\bscala\b/gi, name: "Scala", category: "language" },

      // Frontend frameworks
      { pattern: /\breact\b/gi, name: "React", category: "framework" },
      { pattern: /\bvue\.?js|vuejs\b/gi, name: "Vue.js", category: "framework" },
      { pattern: /\bangular\b/gi, name: "Angular", category: "framework" },
      { pattern: /\bsvelte\b/gi, name: "Svelte", category: "framework" },
      { pattern: /\bnext\.?js|nextjs\b/gi, name: "Next.js", category: "framework" },
      { pattern: /\bnuxt\.?js|nuxtjs\b/gi, name: "Nuxt.js", category: "framework" },
      { pattern: /\bastro\b/gi, name: "Astro", category: "framework" },
      { pattern: /\bremix\b/gi, name: "Remix", category: "framework" },

      // Backend frameworks
      { pattern: /\bexpress\.?js|expressjs\b/gi, name: "Express.js", category: "framework" },
      { pattern: /\bnestjs|nest\.js\b/gi, name: "NestJS", category: "framework" },
      { pattern: /\bfastify\b/gi, name: "Fastify", category: "framework" },
      { pattern: /\bkoa\b/gi, name: "Koa", category: "framework" },
      { pattern: /\bdjango\b/gi, name: "Django", category: "framework" },
      { pattern: /\bflask\b/gi, name: "Flask", category: "framework" },
      { pattern: /\bfastapi\b/gi, name: "FastAPI", category: "framework" },
      { pattern: /\brails|ruby on rails\b/gi, name: "Ruby on Rails", category: "framework" },
      { pattern: /\bspring boot|springboot\b/gi, name: "Spring Boot", category: "framework" },
      { pattern: /\blaravel\b/gi, name: "Laravel", category: "framework" },

      // Databases
      { pattern: /\bpostgres(?:ql)?\b/gi, name: "PostgreSQL", category: "database" },
      { pattern: /\bmysql\b/gi, name: "MySQL", category: "database" },
      { pattern: /\bmongodb|mongo\b/gi, name: "MongoDB", category: "database" },
      { pattern: /\bredis\b/gi, name: "Redis", category: "database" },
      { pattern: /\belasticsearch\b/gi, name: "Elasticsearch", category: "database" },
      { pattern: /\bdynamodb\b/gi, name: "DynamoDB", category: "database" },
      { pattern: /\bsqlite\b/gi, name: "SQLite", category: "database" },
      { pattern: /\bcassandra\b/gi, name: "Cassandra", category: "database" },

      // Cloud & Infrastructure
      { pattern: /\baws\b|amazon web services/gi, name: "AWS", category: "cloud" },
      { pattern: /\bazure\b|microsoft azure/gi, name: "Azure", category: "cloud" },
      { pattern: /\bgcp\b|google cloud/gi, name: "Google Cloud", category: "cloud" },
      { pattern: /\bvercel\b/gi, name: "Vercel", category: "cloud" },
      { pattern: /\bnetlify\b/gi, name: "Netlify", category: "cloud" },
      { pattern: /\bheroku\b/gi, name: "Heroku", category: "cloud" },
      { pattern: /\bdigitalocean\b/gi, name: "DigitalOcean", category: "cloud" },

      // Infrastructure tools
      { pattern: /\bdocker\b/gi, name: "Docker", category: "infrastructure" },
      { pattern: /\bkubernetes|k8s\b/gi, name: "Kubernetes", category: "infrastructure" },
      { pattern: /\bterraform\b/gi, name: "Terraform", category: "infrastructure" },
      { pattern: /\bansible\b/gi, name: "Ansible", category: "infrastructure" },
      { pattern: /\bpulumi\b/gi, name: "Pulumi", category: "infrastructure" },
      { pattern: /\bhelm\b/gi, name: "Helm", category: "infrastructure" },
      { pattern: /\bnginx\b/gi, name: "Nginx", category: "infrastructure" },
      { pattern: /\bgithub actions\b/gi, name: "GitHub Actions", category: "infrastructure" },
      { pattern: /\bgitlab ci\b/gi, name: "GitLab CI", category: "infrastructure" },
      { pattern: /\bjenkins\b/gi, name: "Jenkins", category: "infrastructure" },
      { pattern: /\bcircleci\b/gi, name: "CircleCI", category: "infrastructure" },

      // Tools & Libraries
      { pattern: /\bgraphql\b/gi, name: "GraphQL", category: "tool" },
      { pattern: /\bgrpc\b/gi, name: "gRPC", category: "tool" },
      { pattern: /\bwebpack\b/gi, name: "Webpack", category: "tool" },
      { pattern: /\bvite\b/gi, name: "Vite", category: "tool" },
      { pattern: /\besbuild\b/gi, name: "esbuild", category: "tool" },
      { pattern: /\bjest\b/gi, name: "Jest", category: "tool" },
      { pattern: /\bcypress\b/gi, name: "Cypress", category: "tool" },
      { pattern: /\bplaywright\b/gi, name: "Playwright", category: "tool" },
      { pattern: /\bstorybook\b/gi, name: "Storybook", category: "tool" },
      { pattern: /\bprisma\b/gi, name: "Prisma", category: "library" },
      { pattern: /\bdrizzle\b/gi, name: "Drizzle", category: "library" },
      { pattern: /\btailwind/gi, name: "Tailwind CSS", category: "library" },
      { pattern: /\bbootstrap\b/gi, name: "Bootstrap", category: "library" },
    ];

    for (const { pattern, name, category } of techPatterns) {
      if (pattern.test(lowerReadme)) {
        technologies.push({
          name,
          category,
          source: "readme",
          confidence: "high",
        });
      }
    }

    return technologies;
  }

  /**
   * Analyze file paths for technology detection
   */
  private analyzeFilePathsForTechnologies(files: GitFileChange[]): TechnologyMention[] {
    const technologies: TechnologyMention[] = [];
    const seenTechs = new Set<string>();

    for (const file of files) {
      const path = file.path.toLowerCase();
      const ext = path.split(".").pop() || "";
      const filename = basename(path);

      // Infrastructure patterns (high value for DevOps work)
      if (path.includes("dockerfile") || filename === "dockerfile") {
        if (!seenTechs.has("Docker")) {
          technologies.push({
            name: "Docker",
            category: "infrastructure",
            source: "file",
            confidence: "high",
          });
          seenTechs.add("Docker");
        }
      }
      if (path.includes(".github/workflows")) {
        if (!seenTechs.has("GitHub Actions")) {
          technologies.push({
            name: "GitHub Actions",
            category: "infrastructure",
            source: "file",
            confidence: "high",
          });
          seenTechs.add("GitHub Actions");
        }
      }
      if (path.includes(".gitlab-ci")) {
        if (!seenTechs.has("GitLab CI")) {
          technologies.push({
            name: "GitLab CI",
            category: "infrastructure",
            source: "file",
            confidence: "high",
          });
          seenTechs.add("GitLab CI");
        }
      }
      if (ext === "tf" || path.includes("terraform")) {
        if (!seenTechs.has("Terraform")) {
          technologies.push({
            name: "Terraform",
            category: "infrastructure",
            source: "file",
            confidence: "high",
          });
          seenTechs.add("Terraform");
        }
      }
      if (
        path.includes("kubernetes") ||
        path.includes("k8s") ||
        (ext === "yaml" && (path.includes("deploy") || path.includes("service")))
      ) {
        if (!seenTechs.has("Kubernetes")) {
          technologies.push({
            name: "Kubernetes",
            category: "infrastructure",
            source: "file",
            confidence: "medium",
          });
          seenTechs.add("Kubernetes");
        }
      }
      if (path.includes("helm") || path.includes("charts")) {
        if (!seenTechs.has("Helm")) {
          technologies.push({
            name: "Helm",
            category: "infrastructure",
            source: "file",
            confidence: "high",
          });
          seenTechs.add("Helm");
        }
      }
      if (filename === "serverless.yml" || filename === "serverless.yaml") {
        if (!seenTechs.has("Serverless Framework")) {
          technologies.push({
            name: "Serverless Framework",
            category: "infrastructure",
            source: "file",
            confidence: "high",
          });
          seenTechs.add("Serverless Framework");
        }
      }
      if (filename === "docker-compose.yml" || filename === "docker-compose.yaml") {
        if (!seenTechs.has("Docker Compose")) {
          technologies.push({
            name: "Docker Compose",
            category: "infrastructure",
            source: "file",
            confidence: "high",
          });
          seenTechs.add("Docker Compose");
        }
      }

      // Language detection from extensions
      const extMapping: Record<string, { name: string; category: TechnologyMention["category"] }> =
        {
          ts: { name: "TypeScript", category: "language" },
          tsx: { name: "TypeScript", category: "language" },
          js: { name: "JavaScript", category: "language" },
          jsx: { name: "JavaScript", category: "language" },
          py: { name: "Python", category: "language" },
          java: { name: "Java", category: "language" },
          go: { name: "Go", category: "language" },
          rs: { name: "Rust", category: "language" },
          rb: { name: "Ruby", category: "language" },
          php: { name: "PHP", category: "language" },
          cs: { name: "C#", category: "language" },
          kt: { name: "Kotlin", category: "language" },
          swift: { name: "Swift", category: "language" },
          cpp: { name: "C++", category: "language" },
          c: { name: "C", category: "language" },
          scala: { name: "Scala", category: "language" },
          vue: { name: "Vue.js", category: "framework" },
          svelte: { name: "Svelte", category: "framework" },
          sql: { name: "SQL", category: "database" },
          graphql: { name: "GraphQL", category: "tool" },
          gql: { name: "GraphQL", category: "tool" },
          prisma: { name: "Prisma", category: "library" },
        };

      if (extMapping[ext] && !seenTechs.has(extMapping[ext].name)) {
        technologies.push({
          ...extMapping[ext],
          source: "file",
          confidence: "high",
        });
        seenTechs.add(extMapping[ext].name);
      }
    }

    return technologies;
  }

  /**
   * Analyze dependency files for specific libraries and tools
   */
  async analyzeDependencyFiles(repoPath: string): Promise<TechnologyMention[]> {
    const technologies: TechnologyMention[] = [];

    // Check package.json for Node.js projects
    const packageJsonPath = join(repoPath, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const content = await readFile(packageJsonPath, "utf-8");
        const pkg = JSON.parse(content);
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
        };

        // Map npm packages to technologies
        const npmMapping: Record<
          string,
          { name: string; category: TechnologyMention["category"] }
        > = {
          react: { name: "React", category: "framework" },
          "react-dom": { name: "React", category: "framework" },
          vue: { name: "Vue.js", category: "framework" },
          "@angular/core": { name: "Angular", category: "framework" },
          svelte: { name: "Svelte", category: "framework" },
          next: { name: "Next.js", category: "framework" },
          nuxt: { name: "Nuxt.js", category: "framework" },
          express: { name: "Express.js", category: "framework" },
          "@nestjs/core": { name: "NestJS", category: "framework" },
          fastify: { name: "Fastify", category: "framework" },
          koa: { name: "Koa", category: "framework" },
          prisma: { name: "Prisma", category: "library" },
          "@prisma/client": { name: "Prisma", category: "library" },
          drizzle: { name: "Drizzle", category: "library" },
          "drizzle-orm": { name: "Drizzle", category: "library" },
          typeorm: { name: "TypeORM", category: "library" },
          sequelize: { name: "Sequelize", category: "library" },
          mongoose: { name: "Mongoose", category: "library" },
          graphql: { name: "GraphQL", category: "tool" },
          "@apollo/server": { name: "Apollo GraphQL", category: "library" },
          "apollo-server": { name: "Apollo GraphQL", category: "library" },
          jest: { name: "Jest", category: "tool" },
          vitest: { name: "Vitest", category: "tool" },
          cypress: { name: "Cypress", category: "tool" },
          playwright: { name: "Playwright", category: "tool" },
          "@playwright/test": { name: "Playwright", category: "tool" },
          webpack: { name: "Webpack", category: "tool" },
          vite: { name: "Vite", category: "tool" },
          esbuild: { name: "esbuild", category: "tool" },
          rollup: { name: "Rollup", category: "tool" },
          tailwindcss: { name: "Tailwind CSS", category: "library" },
          "@tanstack/react-query": { name: "TanStack Query", category: "library" },
          "@trpc/server": { name: "tRPC", category: "library" },
          zod: { name: "Zod", category: "library" },
          redis: { name: "Redis", category: "database" },
          ioredis: { name: "Redis", category: "database" },
          pg: { name: "PostgreSQL", category: "database" },
          mysql2: { name: "MySQL", category: "database" },
          mongodb: { name: "MongoDB", category: "database" },
          "@aws-sdk/client-s3": { name: "AWS S3", category: "cloud" },
          "@aws-sdk/client-dynamodb": { name: "DynamoDB", category: "database" },
          "@google-cloud/storage": { name: "Google Cloud Storage", category: "cloud" },
          "@azure/storage-blob": { name: "Azure Blob Storage", category: "cloud" },
        };

        for (const dep of Object.keys(allDeps)) {
          if (npmMapping[dep]) {
            technologies.push({
              ...npmMapping[dep],
              source: "dependency",
              confidence: "high",
            });
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Check requirements.txt for Python projects
    const requirementsPath = join(repoPath, "requirements.txt");
    if (existsSync(requirementsPath)) {
      try {
        const content = await readFile(requirementsPath, "utf-8");
        const lines = content.split("\n");

        const pyMapping: Record<string, { name: string; category: TechnologyMention["category"] }> =
          {
            django: { name: "Django", category: "framework" },
            flask: { name: "Flask", category: "framework" },
            fastapi: { name: "FastAPI", category: "framework" },
            sqlalchemy: { name: "SQLAlchemy", category: "library" },
            pytest: { name: "pytest", category: "tool" },
            celery: { name: "Celery", category: "library" },
            boto3: { name: "AWS SDK", category: "cloud" },
            pandas: { name: "Pandas", category: "library" },
            numpy: { name: "NumPy", category: "library" },
            tensorflow: { name: "TensorFlow", category: "library" },
            pytorch: { name: "PyTorch", category: "library" },
            torch: { name: "PyTorch", category: "library" },
          };

        for (const line of lines) {
          const pkgPart = line.split("==")[0]?.split(">=")[0]?.split("<=")[0];
          const pkg = pkgPart?.trim().toLowerCase() ?? "";
          if (pyMapping[pkg]) {
            technologies.push({
              ...pyMapping[pkg],
              source: "dependency",
              confidence: "high",
            });
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Check go.mod for Go projects
    const goModPath = join(repoPath, "go.mod");
    if (existsSync(goModPath)) {
      technologies.push({
        name: "Go",
        category: "language",
        source: "dependency",
        confidence: "high",
      });
    }

    // Check Cargo.toml for Rust projects
    const cargoPath = join(repoPath, "Cargo.toml");
    if (existsSync(cargoPath)) {
      technologies.push({
        name: "Rust",
        category: "language",
        source: "dependency",
        confidence: "high",
      });
    }

    return technologies;
  }

  /**
   * Analyze text for technology mentions (commit messages, etc.)
   */
  private analyzeTextForTechnologies(
    text: string,
    source: TechnologyMention["source"],
  ): TechnologyMention[] {
    const technologies: TechnologyMention[] = [];
    const lowerText = text.toLowerCase();

    // Quick patterns for common tech mentions in commit messages
    const quickPatterns: Array<{
      pattern: RegExp;
      name: string;
      category: TechnologyMention["category"];
    }> = [
      { pattern: /\bdocker\b/i, name: "Docker", category: "infrastructure" },
      { pattern: /\bkubernetes|k8s\b/i, name: "Kubernetes", category: "infrastructure" },
      { pattern: /\bterraform\b/i, name: "Terraform", category: "infrastructure" },
      { pattern: /\baws\b/i, name: "AWS", category: "cloud" },
      { pattern: /\bazure\b/i, name: "Azure", category: "cloud" },
      { pattern: /\bgcp\b/i, name: "Google Cloud", category: "cloud" },
      { pattern: /\bgraphql\b/i, name: "GraphQL", category: "tool" },
      { pattern: /\bci\/cd|cicd\b/i, name: "CI/CD", category: "infrastructure" },
    ];

    for (const { pattern, name, category } of quickPatterns) {
      if (pattern.test(lowerText)) {
        technologies.push({
          name,
          category,
          source,
          confidence: "low",
        });
      }
    }

    return technologies;
  }

  /**
   * Deduplicate technologies, keeping highest confidence
   */
  private deduplicateTechnologies(technologies: TechnologyMention[]): TechnologyMention[] {
    const techMap = new Map<string, TechnologyMention>();
    const confidenceOrder = { high: 3, medium: 2, low: 1 };

    for (const tech of technologies) {
      const existing = techMap.get(tech.name);
      if (!existing || confidenceOrder[tech.confidence] > confidenceOrder[existing.confidence]) {
        techMap.set(tech.name, tech);
      }
    }

    return Array.from(techMap.values());
  }

  /**
   * Legacy method for backward compatibility
   */
  extractTechnologies(repositories: GitRepository[]): Set<string> {
    const technologies = new Set<string>();

    for (const repo of repositories) {
      for (const commit of repo.commits) {
        // Extract from file extensions
        for (const file of commit.files) {
          const ext = file.path.split(".").pop()?.toLowerCase();
          if (ext) {
            const tech = this.mapExtensionToTechnology(ext);
            if (tech) technologies.add(tech);
          }
        }

        // Extract from commit messages
        const messageTeches = this.extractTechnologiesFromText(commit.message);
        messageTeches.forEach((tech) => technologies.add(tech));
      }
    }

    return technologies;
  }

  /**
   * Map file extension to technology (legacy helper)
   */
  private mapExtensionToTechnology(ext: string): string | null {
    const mapping: Record<string, string> = {
      js: "JavaScript",
      ts: "TypeScript",
      jsx: "React",
      tsx: "React",
      py: "Python",
      java: "Java",
      cpp: "C++",
      c: "C",
      go: "Go",
      rs: "Rust",
      php: "PHP",
      rb: "Ruby",
      cs: "C#",
      kt: "Kotlin",
      swift: "Swift",
      dockerfile: "Docker",
      yml: "YAML",
      yaml: "YAML",
      json: "JSON",
      toml: "TOML",
      tf: "Terraform",
      sql: "SQL",
      html: "HTML",
      css: "CSS",
      scss: "Sass",
      less: "Less",
      vue: "Vue.js",
      svelte: "Svelte",
    };

    return mapping[ext] || null;
  }

  /**
   * Extract technology names from text (legacy helper)
   */
  private extractTechnologiesFromText(text: string): string[] {
    const technologies: string[] = [];
    const patterns = [
      /\b(react|vue|angular|svelte|next\.?js|nuxt)\b/gi,
      /\b(node\.?js|express|fastify|koa)\b/gi,
      /\b(docker|kubernetes|k8s)\b/gi,
      /\b(aws|azure|gcp|google cloud)\b/gi,
      /\b(redis|mongodb|postgresql|mysql)\b/gi,
      /\b(typescript|javascript|python|java|go|rust)\b/gi,
      /\b(graphql|rest api|grpc)\b/gi,
      /\b(webpack|vite|rollup|parcel)\b/gi,
      /\b(jest|cypress|playwright|testing)\b/gi,
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        technologies.push(...matches.map((m) => m.toLowerCase()));
      }
    }

    return [...new Set(technologies)];
  }
}
