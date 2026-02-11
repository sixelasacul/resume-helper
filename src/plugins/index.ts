// Export types
export type {
  PluginContentSection,
  PluginOutputMap,
  PluginResult,
  PluginPrompt,
  AnyPlugin,
  DepsFor,
  GitPluginOutput,
  GitHubPluginOutput,
  SlackAIPluginOutput,
  TemplatePluginOutput,
  LanguagePluginOutput,
} from "./types.js";

// Export PluginManager
export { PluginManager, pluginManager } from "./PluginManager.js";

// Export individual plugins
export { GitPrompt } from "./git/GitPrompt.js";
export { GitService, type TechnologyMention } from "./git/GitService.js";
export { GitHubPrompt } from "./github/GitHubPrompt.js";
export { GitHubService } from "./github/GitHubService.js";
export { SlackAIPrompt } from "./slack-ai/SlackAIPrompt.js";
export { TemplatePrompt } from "./template/TemplatePrompt.js";
export { LanguagePrompt } from "./language/LanguagePrompt.js";

// Register all plugins
import { pluginManager } from "./PluginManager.js";
import { GitPrompt } from "./git/GitPrompt.js";
import { GitHubPrompt } from "./github/GitHubPrompt.js";
import { SlackAIPrompt } from "./slack-ai/SlackAIPrompt.js";
import { TemplatePrompt } from "./template/TemplatePrompt.js";
import { LanguagePrompt } from "./language/LanguagePrompt.js";

/**
 * Initialize all plugins
 * Call this once at startup
 */
export function initializePlugins(): void {
  // Register plugins in no particular order
  // PluginManager will sort them by dependencies
  pluginManager.register(new LanguagePrompt());
  pluginManager.register(new TemplatePrompt());
  pluginManager.register(new GitPrompt());
  pluginManager.register(new GitHubPrompt());
  pluginManager.register(new SlackAIPrompt());
}
