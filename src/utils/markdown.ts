/**
 * Shared markdown cleaning utilities
 *
 * Used by plugins to sanitize markdown content (PR bodies, etc.) for
 * inclusion in the AI prompt. This ensures consistent cleaning across
 * all content sources.
 */

/**
 * Remove emoji characters from text
 * Covers most common emoji Unicode ranges
 */
export function stripEmojis(text: string): string {
  return text
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}\u{2712}\u{2714}\u{2716}\u{271D}\u{2721}\u{2728}\u{2733}-\u{2734}\u{2744}\u{2747}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2763}-\u{2764}\u{2795}-\u{2797}\u{27A1}\u{27B0}\u{27BF}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}]/gu,
      "",
    )
    .replace(/\s{2,}/g, " "); // Collapse multiple spaces left by removed emojis
}

/**
 * Clean markdown content for embedding in AI prompts.
 *
 * Uses Bun's built-in markdown parser to:
 * - Remove HTML/Markdown comments
 * - Remove images
 * - Remove horizontal rules
 * - Remove emojis
 * - Convert links to plain text (keep link text, remove URL)
 * - Preserve structure (headings, lists, code blocks, etc.)
 */
export function cleanMarkdown(text: string): string {
  // First, strip HTML comments (Bun's parser doesn't have a callback for these)
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, "");

  const result = Bun.markdown.render(
    withoutComments,
    {
      // Remove images entirely
      image: () => null,
      // Keep link text, discard URL
      link: (children) => children,
      // Remove horizontal rules
      hr: () => null,
      // Remove HTML blocks
      html: () => null,
      // Block elements - preserve structure
      heading: (children, { level }) => `${"#".repeat(level)} ${children}\n\n`,
      paragraph: (children) => `${children}\n\n`,
      blockquote: (children) => {
        const lines = children.trim().split("\n");
        return lines.map((line) => `> ${line}`).join("\n") + "\n\n";
      },
      code: (children, meta) => {
        const lang = meta?.language || "";
        return `\`\`\`${lang}\n${children}\n\`\`\`\n\n`;
      },
      list: (children) => `${children}\n`,
      listItem: (children, meta) => {
        const checkbox = meta?.checked !== undefined ? (meta.checked ? "[x] " : "[ ] ") : "";
        return `- ${checkbox}${children.trim()}\n`;
      },
      // Inline elements
      strong: (children) => `**${children}**`,
      emphasis: (children) => `*${children}*`,
      codespan: (children) => `\`${children}\``,
      strikethrough: (children) => `~~${children}~~`,
      // Text: remove emojis
      text: (children) => stripEmojis(children),
    },
    {
      // Parser options
      tables: true,
      strikethrough: true,
      tasklists: true,
    },
  );

  // Final cleanup: collapse multiple newlines and trim
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Wrap content in blockquote for nested markdown separation.
 * This prevents heading levels from conflicting with outer content.
 */
export function toBlockquote(content: string): string {
  if (!content.trim()) return "";

  return content
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}
