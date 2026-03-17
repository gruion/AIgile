/**
 * Shared prompts — used by all providers.
 * Edit these to change what the AI generates, regardless of provider.
 */

export function buildTicketPrompt(ticket) {
  const comments = (ticket.comments || [])
    .slice(-5)
    .map((c) => `[${c.author} - ${c.date}]: ${c.body?.substring(0, 300)}`)
    .join("\n");

  return `You are a project manager assistant. Analyze this Jira ticket and provide a concise summary.

TICKET: ${ticket.key}
Title: ${ticket.summary}
Status: ${ticket.status}
Priority: ${ticket.priority}
Assignee: ${ticket.assignee || "Unassigned"}
Created: ${ticket.created}
Updated: ${ticket.updated}
Due Date: ${ticket.dueDate || "None"}
Labels: ${(ticket.labels || []).join(", ")}

Description:
${ticket.description?.substring(0, 2000) || "No description"}

Recent Comments:
${comments || "No comments"}

Respond with ONLY valid JSON (no markdown, no backticks):
{
  "tldr": "One-sentence summary (max 100 chars)",
  "status_insight": "Current state and blockers (max 150 chars)",
  "action_needed": "Next action required (max 150 chars)",
  "risk_level": "low | medium | high",
  "risk_reason": "Why this risk level (max 100 chars)",
  "staleness_days": <number of days since last meaningful update>
}`;
}

export function buildBoardPrompt(tickets) {
  const lines = tickets
    .map(
      (t) =>
        `- ${t.key} | ${t.summary} | Status: ${t.status} | Assignee: ${t.assignee || "Unassigned"} | Priority: ${t.priority} | Updated: ${t.updated} | Due: ${t.dueDate || "none"}`
    )
    .join("\n");

  return `You are a project manager assistant. Analyze these Jira tickets and provide a board-level executive summary.

TICKETS:
${lines}

Respond with ONLY valid JSON (no markdown, no backticks):
{
  "executive_summary": "2-3 sentence overview (max 300 chars)",
  "blocked_tickets": [{"key": "XX-1", "reason": "why blocked"}],
  "stale_tickets": [{"key": "XX-1", "days_stale": 14}],
  "team_workload": {"Person Name": {"count": 5, "in_progress": 2, "todo": 3}},
  "recommendations": ["actionable recommendation 1", "recommendation 2", "recommendation 3"]
}`;
}

export function parseJSON(text) {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return JSON.parse(cleaned);
}
