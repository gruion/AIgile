/**
 * Base provider — defines the interface all providers must implement.
 */
export class BaseProvider {
  constructor(config = {}) {
    this.config = config;
  }

  /** Send a prompt and get a text response */
  async complete(prompt) {
    throw new Error("complete() not implemented");
  }

  /** Summarize a single ticket */
  async summarizeTicket(ticketData) {
    const { buildTicketPrompt, parseJSON } = await import("../prompts.js");
    const prompt = buildTicketPrompt(ticketData);
    const text = await this.complete(prompt);
    try {
      return parseJSON(text);
    } catch {
      return {
        tldr: text.substring(0, 100),
        status_insight: "Could not parse AI response",
        action_needed: "Review manually",
        risk_level: "medium",
        risk_reason: "AI parse error",
        staleness_days: 0,
      };
    }
  }

  /** Summarize an entire board */
  async summarizeBoard(ticketsData) {
    const { buildBoardPrompt, parseJSON } = await import("../prompts.js");
    const prompt = buildBoardPrompt(ticketsData);
    const text = await this.complete(prompt);
    try {
      return parseJSON(text);
    } catch {
      return {
        executive_summary: text.substring(0, 300),
        blocked_tickets: [],
        stale_tickets: [],
        team_workload: {},
        recommendations: ["Could not parse AI response — review manually"],
      };
    }
  }
}
