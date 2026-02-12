/**
 * Build the Slack AI prompt template for extracting professional contributions.
 */
export function buildSlackAIPrompt(startDate: string, endDate: string, channels: string): string {
  const channelInstruction = channels
    ? `Focus specifically on these channels: ${channels}`
    : "Search across all channels I have access to.";

  return `I need to summarize my professional contributions visible in Slack messages from ${startDate} to ${endDate}.

Focus on messages from me (or mentioning my name/handle).
${channelInstruction}

Please analyze my messages and categorize findings into the following sections. For each category, provide 3-5 concrete examples with brief context. Skip categories where no relevant messages are found.

## 1. Project Discussions & Technical Decisions
Look for:
- Architecture decisions I drove or contributed to
- Technical problems I helped solve
- Design discussions I participated in
- Code review discussions and feedback I provided

## 2. Cross-Team Collaboration
Look for:
- Work coordinated with other teams (name the teams if visible)
- Discussions with stakeholders or product managers
- External partnership or vendor discussions
- Cross-functional project involvement

## 3. Leadership & Mentoring
Look for:
- Helping teammates with questions or blockers
- Onboarding new team members
- Knowledge sharing (documentation, presentations, explanations)
- Code review guidance and teaching moments

## 4. Initiative Ownership
Look for:
- Projects or features I proposed or championed
- Problems I identified and took ownership of
- Process improvements I suggested or implemented
- New tools or practices I introduced to the team

## 5. Impact & Results
Look for:
- Launches, releases, or deployments I was involved in
- Metrics, outcomes, or results discussed
- Recognition received (thank-yous, shout-outs, positive reactions)
- Successful project completions or milestones

## Output Format
For each category with findings, provide:
- A brief summary of the theme
- 3-5 specific examples with enough context to understand the contribution
- Any notable patterns (e.g., "frequently helped with onboarding", "drove multiple architecture decisions")

**Important formatting rules:**
- Do NOT include hyperlinks in your response - use plain text only
- Do NOT use emoji shortcodes (like :dog:) or Unicode emoji characters
- Use plain text for all content to make it easy to copy/paste

Focus on substance over casual conversations. The goal is to identify professional contributions that demonstrate skills, leadership, and impact.`;
}

/**
 * Copy text to clipboard (macOS only)
 * Returns true if successful, false otherwise
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }

  try {
    const proc = Bun.spawn(["pbcopy"], {
      stdin: "pipe",
    });
    proc.stdin.write(text);
    proc.stdin.end();
    await proc.exited;
    return true;
  } catch {
    return false;
  }
}
