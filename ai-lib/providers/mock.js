import { BaseProvider } from "./base.js";

/**
 * Mock provider — returns deterministic fake data for testing.
 * No API calls, no cost, instant response.
 */
export class MockProvider extends BaseProvider {
  async summarizeTicket(ticketData) {
    const isOverdue = ticketData.dueDate && new Date(ticketData.dueDate) < new Date();
    const isHighPrio = ["High", "Highest"].includes(ticketData.priority);

    return {
      tldr: `${ticketData.summary?.substring(0, 80)}...`,
      status_insight: `Currently ${ticketData.status}. ${ticketData.assignee || "No one"} assigned.`,
      action_needed: isOverdue
        ? "Overdue — needs immediate attention"
        : "Continue current work",
      risk_level: isOverdue ? "high" : isHighPrio ? "medium" : "low",
      risk_reason: isOverdue
        ? "Past due date"
        : isHighPrio
          ? "High priority item"
          : "On track",
      staleness_days: ticketData.daysSinceUpdate || 0,
    };
  }

  async summarizeBoard(ticketsData) {
    const blocked = ticketsData
      .filter((t) => (t.labels || []).some((l) => l.includes("block")))
      .map((t) => ({ key: t.key, reason: "Labeled as blocked" }));

    const workload = {};
    for (const t of ticketsData) {
      const name = t.assignee || "Unassigned";
      if (!workload[name]) workload[name] = { count: 0, in_progress: 0, todo: 0 };
      workload[name].count++;
      if (t.status === "In Progress") workload[name].in_progress++;
      else if (t.status !== "Done") workload[name].todo++;
    }

    return {
      executive_summary: `Board has ${ticketsData.length} tickets. ${blocked.length} blocked. Mock summary for testing.`,
      blocked_tickets: blocked,
      stale_tickets: [],
      team_workload: workload,
      recommendations: [
        "Review blocked tickets",
        "Check overdue items",
        "Balance team workload",
      ],
    };
  }

  async complete(prompt) {
    return '{"tldr":"Mock response","status_insight":"Testing mode","action_needed":"Switch to real provider","risk_level":"low","risk_reason":"Mock data","staleness_days":0}';
  }
}
