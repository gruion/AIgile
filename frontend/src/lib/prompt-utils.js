/**
 * Smart ticket selection and prompt trimming utilities.
 * Used by Analyze and Architecture pages to keep prompts within budget.
 */

/**
 * Score a ticket for priority in prompt inclusion.
 * Higher score = more important to include.
 */
function ticketPriority(ticket) {
  let score = 50; // base

  // Critical/warning flags boost priority
  const criticalFlags = (ticket.urgencyFlags || []).filter(
    (f) => f.severity === "critical"
  ).length;
  const warningFlags = (ticket.urgencyFlags || []).filter(
    (f) => f.severity === "warning"
  ).length;
  score += criticalFlags * 20 + warningFlags * 10;

  // In-progress tickets are important
  if (ticket.statusCategory === "indeterminate") score += 15;

  // To-do tickets next
  if (ticket.statusCategory === "new") score += 5;

  // Done tickets are least important
  if (ticket.statusCategory === "done") score -= 30;

  // Orphan tickets (no epic) are important for architecture
  if (!ticket.epicKey) score += 10;

  // Overdue boost
  if (ticket.dueDate && new Date(ticket.dueDate).getTime() < Date.now()) {
    score += 15;
  }

  // Stale boost
  if (ticket.daysSinceUpdate >= 14) score += 10;
  else if (ticket.daysSinceUpdate >= 7) score += 5;

  // Unassigned boost
  if (!ticket.assigneeName) score += 5;

  // Higher Jira priority
  if (ticket.priority === "Highest") score += 10;
  else if (ticket.priority === "High") score += 5;

  return score;
}

/**
 * Select and prepare tickets for prompt inclusion.
 * Returns { selected, excluded, stats }
 */
export function selectTicketsForPrompt(allIssues, settings) {
  const {
    maxTickets = 100,
    includeDoneTickets = false,
  } = settings;

  // Filter out done tickets if setting says so
  let candidates = includeDoneTickets
    ? [...allIssues]
    : allIssues.filter((t) => t.statusCategory !== "done");

  // Also keep a few done tickets for cycle time context (max 10)
  const doneTickets = allIssues.filter((t) => t.statusCategory === "done");
  const doneToInclude = includeDoneTickets ? [] : doneTickets.slice(0, 10);

  // Score and sort
  candidates.sort((a, b) => ticketPriority(b) - ticketPriority(a));

  // Trim to max
  const maxForActive = maxTickets - doneToInclude.length;
  const selected = candidates.slice(0, maxForActive);
  const excluded = candidates.slice(maxForActive);

  // Add the done sample back
  if (!includeDoneTickets) {
    selected.push(...doneToInclude);
  }

  return {
    selected,
    excluded: [...excluded, ...doneTickets.slice(10)],
    stats: {
      total: allIssues.length,
      included: selected.length,
      excluded: excluded.length + (includeDoneTickets ? 0 : Math.max(0, doneTickets.length - 10)),
      doneExcluded: includeDoneTickets ? 0 : Math.max(0, doneTickets.length - 10),
    },
  };
}

/**
 * Format a ticket for prompt inclusion, respecting field toggles.
 */
export function formatTicketForPrompt(ticket, settings) {
  const {
    includeDescriptions = true,
    includeComments = true,
    includeEstimates = true,
  } = settings;

  const lines = [];
  lines.push(`### ${ticket.key} — ${ticket.summary}`);
  lines.push(
    `- Status: ${ticket.status} (${ticket.statusCategory}) | Priority: ${ticket.priority || "Medium"} | Type: ${ticket.issueType || "Task"}`
  );
  lines.push(`- Assignee: ${ticket.assigneeName || "UNASSIGNED"}`);
  if (ticket.epicName) lines.push(`- Epic: ${ticket.epicName}`);
  if (ticket.dueDate) lines.push(`- Due: ${ticket.dueDate}`);
  if (ticket.labels?.length) lines.push(`- Labels: ${ticket.labels.join(", ")}`);
  lines.push(
    `- Created: ${ticket.created ? new Date(ticket.created).toISOString().split("T")[0] : "—"}`
  );
  lines.push(
    `- Last updated: ${ticket.updated ? new Date(ticket.updated).toISOString().split("T")[0] : "—"} (${ticket.daysSinceUpdate}d ago)`
  );

  if (includeEstimates && (ticket.originalEstimate || ticket.timeSpent)) {
    lines.push(
      `- Estimate: ${ticket.originalEstimate || "—"} | Spent: ${ticket.timeSpent || "—"} | Remaining: ${ticket.remainingEstimate || "—"}`
    );
  }

  if (includeComments && ticket.lastComment) {
    const body = ticket.lastComment.body?.substring(0, 150) || "";
    lines.push(
      `- Last comment (${ticket.lastComment.author}): ${body}`
    );
  }

  if (ticket.urgencyFlags?.length > 0) {
    lines.push(
      `- Flags: ${ticket.urgencyFlags.map((f) => `${f.label} (${f.severity})`).join(", ")}`
    );
  }

  return lines.join("\n");
}

/**
 * Trim a prompt to maxChars by progressively removing detail.
 * Returns { prompt, trimmed, charCount }
 */
export function trimPrompt(prompt, maxChars) {
  if (prompt.length <= maxChars) {
    return { prompt, trimmed: false, charCount: prompt.length };
  }

  // Strategy: just truncate at the ticket boundary nearest to maxChars
  const cutIndex = prompt.lastIndexOf("\n### ", maxChars);
  if (cutIndex > 0) {
    const trimmedPrompt =
      prompt.substring(0, cutIndex) +
      `\n\n[... ${Math.round((prompt.length - cutIndex) / 1000)}K chars trimmed to stay within budget. Focus analysis on the tickets shown above.]`;
    return {
      prompt: trimmedPrompt,
      trimmed: true,
      charCount: trimmedPrompt.length,
    };
  }

  // Fallback: hard cut
  return {
    prompt: prompt.substring(0, maxChars) + "\n\n[... truncated]",
    trimmed: true,
    charCount: maxChars,
  };
}
