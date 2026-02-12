# Git-Slack Resume CLI

A TypeScript CLI tool that generates professional resume content by analyzing:

- **Git commits** from local repositories
- **GitHub Pull Requests** for enhanced context
- **Slack messages** for collaboration insights
- **AI-powered synthesis** using OpenAI or Anthropic

## Built With

> :warning: Note: This was entirely built with Claude Opus 4.5 as an experiment to work with AI and what I can manage to do with them.

| Category            | Technology                                                        |
| ------------------- | ----------------------------------------------------------------- |
| Runtime             | [Bun](https://bun.sh)                                             |
| Language            | [TypeScript](https://www.typescriptlang.org/)                     |
| CLI Framework       | [Commander.js](https://github.com/tj/commander.js)                |
| Interactive Prompts | [@clack/prompts](https://github.com/bombshell-dev/clack)          |
| Linting             | [oxlint](https://oxc.rs/docs/guide/usage/linter.html)             |
| Formatting          | [oxfmt](https://oxc.rs/docs/guide/usage/formatter.html)           |
| GitHub API          | [@octokit/rest](https://github.com/octokit/rest.js)               |
| Slack API           | [@slack/web-api](https://slack.dev/node-slack-sdk/web-api)        |
| Language Detection  | [linguist-languages](https://github.com/github-linguist/linguist) |

> See [DEV_NOTES.md](./DEV_NOTES.md) for technical decisions and architecture details.

## Features

- **Local Git Analysis**: Extract commits, code changes, and technical contributions
- **GitHub Integration**: Fetch PR descriptions and project context (including Enterprise)
- **Slack Integration**: Analyze communication patterns and collaboration (via Slack AI or API)
- **AI Resume Generation**: Synthesize data into professional resume content
- **Template Support**: Use your existing resume style as a template
- **Interactive Configuration**: Beautiful setup process with @clack/prompts

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd resume-helper

# Install dependencies
bun install

# Build the CLI
bun run build
```

## Setup

1. **Initialize configuration**:

   ```bash
   bun run dev init
   # or after building:
   node dist/index.js init
   ```

2. **Follow the interactive setup**:
   - Add repository paths
   - Configure author emails
   - Set up API tokens (GitHub, Slack, AI)
   - Optionally provide a resume template

## Usage

### Generate Resume

```bash
# Generate resume for a specific period
bun run dev generate --company "Acme Corp" --start-date 2024-01-01 --end-date 2024-12-31 --output resume-acme.md

# Use a custom template
bun run dev generate --template ./my-resume-style.md --output resume.md

# Include Slack AI context (see Slack AI Integration below)
bun run dev generate --slack-context slack-context.txt --output resume.md
```

### Slack AI Integration

Extract collaboration insights from Slack without needing API tokens or admin approval:

```bash
# 1. Generate a prompt template for Slack AI
bun run dev slack-prompt --name "Your Name" --start-date 2024-01-01 --end-date 2024-12-31

# 2. Copy the generated prompt and paste it into a Slack AI conversation
# 3. Save Slack AI's response to a file (e.g., slack-context.txt)

# 4. Include the context when generating your resume
bun run dev generate --slack-context slack-context.txt --output resume.md
```

This approach:

- Requires no Slack API token or app installation
- Leverages Slack AI's access to your conversations
- Extracts project discussions, cross-team collaboration, leadership moments, and impact statements

### Manage Configuration

```bash
# Show current configuration
bun run dev config --show

# Add repository or email
bun run dev config --add-repo /path/to/project
bun run dev config --add-email your.email@company.com

# Update tokens
bun run dev config --set-github-token <token>
bun run dev config --set-slack-token <token>
```

## Configuration

The CLI stores configuration in `.resume-cli.json` in your current directory.

### Advanced Configuration

You can customize limits in your `.resume-cli.json` file:

```json
{
  "maxCommits": 100,
  "minimumCommitChanges": 3
}
```

| Option                 | Default | Description                                                       |
| ---------------------- | ------- | ----------------------------------------------------------------- |
| `maxCommits`           | 100     | Maximum commits to include per repository (also limits PRs shown) |
| `minimumCommitChanges` | 3       | Minimum lines changed to include a commit                         |

## API Integrations

### GitHub API

- **Token**: **Classic Personal Access Token** with `repo` scope
  - ⚠️ **Important**: Fine-grained PATs are NOT supported on GitHub Enterprise Server
  - For GitHub.com public repos only: `public_repo` scope is sufficient
  - For private repos or GitHub Enterprise: `repo` scope is required
- **Enterprise**: Supports GitHub Enterprise Server URLs (auto-detected from repository remote)
- **Rate Limits**: 5,000 requests/hour (authenticated)
- **Data**: Commits, PR descriptions, repository metadata

#### Creating a GitHub Token

1. Go to GitHub → Settings → Developer Settings → Personal Access Tokens → **Tokens (classic)**
2. Click "Generate new token" → "Generate new token (classic)"
3. Select the `repo` scope (or `public_repo` for public repos only)
4. For GitHub Enterprise, create the token on your Enterprise instance (e.g., `https://github.yourcompany.com/settings/tokens`)

### Slack AI Integration

Use Slack's built-in AI to extract and summarize your contributions. No API token or admin approval needed. The CLI will generate a prompt to give to the Slack AI, and the result can be given back to the CLI.

See [Slack AI Integration](#slack-ai-integration) for the full workflow.

### AI Integration

- **TanStack AI**: Unified interface across providers
- **Supported**: OpenAI GPT, Anthropic Claude
- **Usage**: Synthesizes technical data into resume content

## Architecture

```
src/
├── commands/          # CLI command implementations
│   ├── init.ts       # Interactive configuration
│   ├── generate.ts   # Resume generation
│   ├── test.ts       # Service testing
│   └── config.ts     # Configuration management
├── services/          # API and data services
│   ├── git.ts        # Local git analysis
│   ├── github.ts     # GitHub API integration
│   ├── slack.ts      # Slack API integration
│   └── ai.ts         # AI resume generation
├── utils/             # Utility functions
│   └── config.ts     # Configuration management
├── types/             # TypeScript definitions
│   └── index.ts      # Type definitions
└── index.ts          # CLI entry point
```

## Current Status

**Completed**:

- Project setup and CLI framework
- Interactive configuration with @clack/prompts
- TypeScript structure and type definitions
- All commands (init, generate, test, config)
- Git analysis service with technology detection
- GitHub API integration (including Enterprise)
- Slack API integration
- AI prompt generation (export for manual AI use)
- Direct AI generation with OpenAI/Anthropic
- Resume template support
- Multi-language support
- Token estimation and large prompt warnings

## Contributing

This is a proof-of-concept CLI tool. Feel free to:

1. Fork the repository
2. Create feature branches
3. Submit pull requests
4. Report issues

## Release process

The CLI is not automatically released when commits are pushed on the main branch. You have to:

1. Update the `package.json` version, like `vX.Y.Z`;
2. Create a commit with a message: `git commit -am "release vX.Y.Z"`;
3. Create a tag containing the corresponding version: `git tag vX.Y.Z`;
4. Push the commit: `git push origin main --tags`;
5. Then the release workflow will kick off.

## License

MIT License - see LICENSE file for details
