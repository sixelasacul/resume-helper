import { readFile } from "fs/promises";
import { existsSync } from "fs";

export interface TemplateAnalysis {
  content: string;
  sections: string[];
  style: {
    usesEmoji: boolean;
    bulletStyle: "dash" | "asterisk" | "mixed";
    headingStyle: "hash" | "underline" | "mixed";
    hasQuantifiedAchievements: boolean;
    averageBulletLength: number;
  };
  keywords: string[];
}

/**
 * Load and analyze a resume template for style matching
 */
export async function loadTemplate(templatePath: string): Promise<TemplateAnalysis | null> {
  if (!existsSync(templatePath)) {
    return null;
  }

  try {
    const content = await readFile(templatePath, "utf-8");
    return analyzeTemplate(content);
  } catch {
    return null;
  }
}

/**
 * Analyze template content for style patterns
 */
function analyzeTemplate(content: string): TemplateAnalysis {
  const lines = content.split("\n");

  // Detect sections (headings)
  const sections = lines
    .filter((line) => /^#{1,3}\s/.test(line) || /^[A-Z][A-Z\s]+$/.test(line.trim()))
    .map((line) => line.replace(/^#+\s*/, "").trim());

  // Analyze style
  const style = analyzeStyle(content, lines);

  // Extract keywords
  const keywords = extractKeywords(content);

  return {
    content,
    sections,
    style,
    keywords,
  };
}

/**
 * Analyze writing style in the template
 */
function analyzeStyle(content: string, lines: string[]): TemplateAnalysis["style"] {
  // Check for emoji usage
  const emojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
  const usesEmoji = emojiPattern.test(content);

  // Detect bullet style
  const dashBullets = (content.match(/^-\s/gm) || []).length;
  const asteriskBullets = (content.match(/^\*\s/gm) || []).length;
  let bulletStyle: "dash" | "asterisk" | "mixed" = "dash";
  if (dashBullets > 0 && asteriskBullets > 0) {
    bulletStyle = "mixed";
  } else if (asteriskBullets > dashBullets) {
    bulletStyle = "asterisk";
  }

  // Detect heading style
  const hashHeadings = (content.match(/^#{1,3}\s/gm) || []).length;
  const underlineHeadings = (content.match(/^[=-]+$/gm) || []).length;
  let headingStyle: "hash" | "underline" | "mixed" = "hash";
  if (hashHeadings > 0 && underlineHeadings > 0) {
    headingStyle = "mixed";
  } else if (underlineHeadings > hashHeadings) {
    headingStyle = "underline";
  }

  // Check for quantified achievements (numbers, percentages)
  const quantifiedPattern = /\d+%|\d+x|increased|decreased|reduced|improved|saved|\$\d+/gi;
  const hasQuantifiedAchievements = quantifiedPattern.test(content);

  // Calculate average bullet point length
  const bulletLines = lines.filter((line) => /^[-*]\s/.test(line));
  const averageBulletLength =
    bulletLines.length > 0
      ? bulletLines.reduce((sum, line) => sum + line.length, 0) / bulletLines.length
      : 0;

  return {
    usesEmoji,
    bulletStyle,
    headingStyle,
    hasQuantifiedAchievements,
    averageBulletLength: Math.round(averageBulletLength),
  };
}

/**
 * Extract action verbs and common resume keywords
 */
function extractKeywords(content: string): string[] {
  const keywords = new Set<string>();

  // Action verbs commonly used in resumes
  const actionVerbPatterns = [
    /\b(led|managed|developed|implemented|designed|created|built|architected)\b/gi,
    /\b(optimized|improved|increased|decreased|reduced|enhanced|streamlined)\b/gi,
    /\b(delivered|launched|deployed|released|shipped|completed)\b/gi,
    /\b(collaborated|mentored|coached|trained|coordinated|facilitated)\b/gi,
    /\b(analyzed|researched|investigated|evaluated|assessed|identified)\b/gi,
    /\b(automated|integrated|migrated|refactored|modernized|upgraded)\b/gi,
  ];

  for (const pattern of actionVerbPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach((match) => keywords.add(match.toLowerCase()));
    }
  }

  return Array.from(keywords);
}

/**
 * Generate style guide from template analysis
 */
export function generateStyleGuide(analysis: TemplateAnalysis): string {
  const lines: string[] = [];

  lines.push("## Writing Style Guide (based on your template)\n");

  // Formatting preferences
  lines.push("### Formatting");
  lines.push(
    `- Bullet style: ${analysis.style.bulletStyle === "dash" ? "Use dashes (-)" : analysis.style.bulletStyle === "asterisk" ? "Use asterisks (*)" : "Mixed bullet styles are acceptable"}`,
  );
  lines.push(`- Average bullet point length: ~${analysis.style.averageBulletLength} characters`);

  if (analysis.style.usesEmoji) {
    lines.push("- Emojis are used in headings/content");
  }

  // Content style
  lines.push("\n### Content Style");
  if (analysis.style.hasQuantifiedAchievements) {
    lines.push("- Include quantified achievements (percentages, numbers, metrics)");
  }

  // Action verbs found
  if (analysis.keywords.length > 0) {
    lines.push(`- Preferred action verbs: ${analysis.keywords.slice(0, 10).join(", ")}`);
  }

  // Sections to include
  if (analysis.sections.length > 0) {
    lines.push("\n### Sections Found");
    for (const section of analysis.sections) {
      lines.push(`- ${section}`);
    }
  }

  return lines.join("\n");
}

/**
 * Suggest improvements based on template analysis
 */
export function suggestImprovements(analysis: TemplateAnalysis): string[] {
  const suggestions: string[] = [];

  if (!analysis.style.hasQuantifiedAchievements) {
    suggestions.push(
      "Consider adding quantified achievements (e.g., 'Improved performance by 40%')",
    );
  }

  if (analysis.style.averageBulletLength > 200) {
    suggestions.push(
      "Bullet points may be too long - aim for concise statements under 150 characters",
    );
  }

  if (analysis.style.averageBulletLength < 50 && analysis.style.averageBulletLength > 0) {
    suggestions.push(
      "Bullet points may be too short - include more detail about impact and outcomes",
    );
  }

  if (analysis.keywords.length < 5) {
    suggestions.push("Consider using more action verbs to describe accomplishments");
  }

  return suggestions;
}
