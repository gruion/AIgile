"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import AiCoachPanel from "../../components/AiCoachPanel";
import JqlBar from "../../components/JqlBar";
import {
  fetchRetroSessions,
  createRetroSession,
  fetchRetroSession,
  addRetroEntry,
  voteRetroEntry,
  deleteRetroSession,
  fetchAnalytics,
  fetchSettings,
  fetchIssues,
  fetchStandup,
} from "../../lib/api";
import { selectTicketsForPrompt, formatTicketForPrompt, trimPrompt } from "../../lib/prompt-utils";
import { useAppConfig } from "../../context/AppConfigContext";

const CATEGORIES = [
  { key: "went_well", label: "Went Well", color: "bg-green-50 border-green-200", badge: "bg-green-100 text-green-700", icon: "\u2705" },
  { key: "to_improve", label: "To Improve", color: "bg-orange-50 border-orange-200", badge: "bg-orange-100 text-orange-700", icon: "\u26A0\uFE0F" },
  { key: "action_item", label: "Action Items", color: "bg-blue-50 border-blue-200", badge: "bg-blue-100 text-blue-700", icon: "\uD83D\uDE80" },
  { key: "question", label: "Questions", color: "bg-purple-50 border-purple-200", badge: "bg-purple-100 text-purple-700", icon: "\u2753" },
  { key: "shoutout", label: "Shoutouts", color: "bg-pink-50 border-pink-200", badge: "bg-pink-100 text-pink-700", icon: "\uD83C\uDF1F" },
];

const COACH_TIPS = [
  { title: "Psychological Safety First", detail: "Ensure everyone feels safe to speak openly. Use 'I noticed...' instead of 'You did...'. Focus on processes, not people." },
  { title: "Data Over Opinions", detail: "Ground discussions in metrics (cycle time, WIP, stale tickets) rather than gut feelings. Use the Analytics tab for evidence." },
  { title: "Action Items Need Owners", detail: "Every action item must have a single owner and a due date. Unowned actions never get done." },
  { title: "Limit to 3 Actions", detail: "Don't try to fix everything at once. Pick the 2-3 highest-impact improvements and commit to them fully." },
  { title: "Review Last Retro's Actions", detail: "Always start by reviewing whether previous action items were completed. Accountability drives improvement." },
  { title: "Timebox Strictly", detail: "Keep retros to 60 minutes max. Use a timer: 10min review, 15min went-well, 15min to-improve, 15min actions, 5min wrap." },
];

function buildRetroPrompt(analyticsData, entries, ticketData, promptSettings) {
  const today = new Date().toISOString().split("T")[0];
  const lines = [];

  lines.push("You are a senior Agile Coach facilitating a sprint retrospective. Analyze the team's board data, ticket-level details, AND their own retrospective feedback to produce deep, actionable insights.");
  lines.push("IMPORTANT: Return ONLY valid JSON, no markdown, no explanation, no code fences.");
  lines.push("");
  lines.push(`# Sprint Retrospective Analysis — ${today}`);
  lines.push("");

  // Board metrics
  if (analyticsData) {
    lines.push("## Board Metrics");
    lines.push(`- Total tickets: ${analyticsData.total}`);
    lines.push(`- In Progress (WIP): ${analyticsData.wipCount}`);
    lines.push(`- Average quality: ${analyticsData.avgQuality}%`);
    lines.push(`- Average cycle time: ${analyticsData.cycleTime?.avg}d (median: ${analyticsData.cycleTime?.median}d)`);
    lines.push(`- Stale tickets: ${analyticsData.staleIssues?.length || 0}`);
    lines.push(`- Overdue: ${analyticsData.dueDateCompliance?.overdueActive || 0}`);
    lines.push(`- Priority inflation: ${analyticsData.priorityInflation}%`);
    lines.push(`- Sprint health: ${analyticsData.sprintHealth?.score || "N/A"}/100 (${analyticsData.sprintHealth?.status || "unknown"})`);
    if (analyticsData.bottlenecks?.length > 0) {
      lines.push(`- Bottlenecks: ${analyticsData.bottlenecks.map((b) => `${b.status} (${b.count} items)`).join(", ")}`);
    }
    if (analyticsData.wipLimits?.violations?.length > 0) {
      lines.push(`- WIP violations: ${analyticsData.wipLimits.violations.map((v) => `${v.name}: ${v.current}/${v.limit}`).join(", ")}`);
    }
    lines.push("");
  }

  // Ticket-level analysis data
  if (ticketData) {
    const epics = ticketData.epics || [];
    const noEpic = ticketData.noEpic || [];
    const allIssues = [...epics.flatMap((e) => e.issues || []), ...noEpic];

    if (allIssues.length > 0) {
      lines.push("## Ticket-Level Data (for evidence-based retro)");
      lines.push("");

      // Completed work
      const done = allIssues.filter((i) => i.statusCategory === "done");
      if (done.length > 0) {
        lines.push("### Completed This Sprint");
        done.forEach((i) => {
          lines.push(`- ${i.key}: ${i.summary} (${i.assigneeName || "unassigned"}) — ${i.issueType || "Task"}${i.dueDate ? `, due: ${i.dueDate}` : ""}`);
        });
        lines.push("");
      }

      // In progress (still open)
      const inProgress = allIssues.filter((i) => i.statusCategory === "indeterminate");
      if (inProgress.length > 0) {
        lines.push("### Still In Progress (not completed)");
        inProgress.forEach((i) => {
          lines.push(`- ${i.key}: ${i.summary} (${i.assigneeName || "unassigned"}) — status: ${i.status}${i.dueDate ? `, due: ${i.dueDate}` : ""}`);
        });
        lines.push("");
      }

      // Overdue items
      const overdue = allIssues.filter((i) => i.urgencyFlags?.some((f) => f.type === "overdue"));
      if (overdue.length > 0) {
        lines.push("### Overdue Items");
        overdue.forEach((i) => {
          lines.push(`- ${i.key}: ${i.summary} (${i.assigneeName || "unassigned"}) — due: ${i.dueDate}, status: ${i.status}`);
        });
        lines.push("");
      }

      // Stale items
      const stale = allIssues.filter((i) => i.urgencyFlags?.some((f) => f.type === "stale"));
      if (stale.length > 0) {
        lines.push("### Stale Items (no update in 7+ days)");
        stale.forEach((i) => {
          lines.push(`- ${i.key}: ${i.summary} (${i.assigneeName || "unassigned"}) — last updated: ${i.updated ? new Date(i.updated).toISOString().split("T")[0] : "unknown"}`);
        });
        lines.push("");
      }

      // Unassigned
      const unassigned = allIssues.filter((i) => !i.assigneeName && i.statusCategory !== "done");
      if (unassigned.length > 0) {
        lines.push("### Unassigned Open Items");
        unassigned.forEach((i) => {
          lines.push(`- ${i.key}: ${i.summary} — status: ${i.status}, priority: ${i.priority || "Medium"}`);
        });
        lines.push("");
      }

      // Blockers
      const blocked = allIssues.filter((i) => i.urgencyFlags?.some((f) => f.type === "blocked" || f.type === "blocker"));
      if (blocked.length > 0) {
        lines.push("### Blocked / Blocker Items");
        blocked.forEach((i) => {
          const flags = i.urgencyFlags.filter((f) => f.type === "blocked" || f.type === "blocker").map((f) => f.label).join(", ");
          lines.push(`- ${i.key}: ${i.summary} — ${flags}`);
        });
        lines.push("");
      }

      // Recent comments (last comment per issue, for communication analysis)
      const withComments = allIssues.filter((i) => i.lastComment);
      if (withComments.length > 0) {
        lines.push("### Recent Comments (communication signals)");
        withComments.slice(0, 15).forEach((i) => {
          const body = i.lastComment.body?.substring(0, 120) || "";
          lines.push(`- ${i.key} [${i.lastComment.author}]: ${body}`);
        });
        lines.push("");
      }

      // Summary stats
      lines.push("### Sprint Stats from Tickets");
      lines.push(`- Total: ${allIssues.length} | Done: ${done.length} | In Progress: ${inProgress.length} | To Do: ${allIssues.filter((i) => i.statusCategory === "new").length}`);
      lines.push(`- Overdue: ${overdue.length} | Stale: ${stale.length} | Blocked: ${blocked.length} | Unassigned: ${unassigned.length}`);

      // Workload distribution
      const workload = {};
      allIssues.filter((i) => i.assigneeName).forEach((i) => {
        workload[i.assigneeName] = (workload[i.assigneeName] || 0) + 1;
      });
      if (Object.keys(workload).length > 0) {
        lines.push(`- Workload: ${Object.entries(workload).map(([name, count]) => `${name}: ${count}`).join(", ")}`);
      }

      // Epic progress
      if (epics.length > 0) {
        lines.push("");
        lines.push("### Epic Progress");
        epics.forEach((e) => {
          lines.push(`- ${e.key}: ${e.name} — ${e.progress}% done (${e.stats?.done || 0}/${e.issues?.length || 0}), ${e.stats?.criticalCount || 0} critical, ${e.stats?.warningCount || 0} warnings`);
        });
      }
      lines.push("");
    }
  }

  // Team feedback
  if (entries.length > 0) {
    lines.push("## Team Feedback");
    for (const cat of CATEGORIES) {
      const catEntries = entries.filter((e) => e.category === cat.key);
      if (catEntries.length > 0) {
        lines.push(`\n### ${cat.label}`);
        catEntries.forEach((e) => {
          lines.push(`- [${e.author}] ${e.text}${e.votes > 0 ? ` (${e.votes} votes)` : ""}`);
        });
      }
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("Based on the board metrics, ticket-level data, AND team feedback, return this JSON:");
  lines.push(`{
  "sprint_summary": "2-3 sentence summary of how the sprint went, referencing specific ticket keys and metrics",
  "health_assessment": {
    "score": 0-100,
    "status": "healthy | needs_attention | critical",
    "key_metrics": ["list of 3-5 key observations from the data"]
  },
  "what_went_well": [
    {
      "title": "Specific thing that went well",
      "evidence": "Which tickets/metrics prove this",
      "team_alignment": "What team members said that confirms this (if any)"
    }
  ],
  "what_went_wrong": [
    {
      "title": "Specific problem or failure",
      "evidence": "Which tickets/metrics prove this (reference keys)",
      "root_cause": "Why this happened (process, communication, technical, planning)",
      "impact": "high | medium | low"
    }
  ],
  "themes": [
    {
      "title": "Theme name (e.g., 'WIP overload', 'Communication gaps')",
      "description": "What the data and feedback tell us",
      "evidence_from_data": "Specific metrics and ticket keys that support this theme",
      "evidence_from_team": "What team members said about this",
      "impact": "high | medium | low",
      "category": "process | technical | communication | planning | culture"
    }
  ],
  "coaching_questions": [
    "Powerful question to ask the team to drive deeper reflection (e.g., 'What made us decide to take on X when Y was already in progress?')",
    "Another coaching question based on the specific data patterns observed"
  ],
  "improvement_suggestions": [
    {
      "title": "Specific, actionable improvement",
      "description": "How to implement this change, step by step",
      "addresses": "Which 'what went wrong' item or theme this fixes",
      "expected_impact": "What improvement we expect to see",
      "measurable_outcome": "How we'll know it worked (specific metric)",
      "priority": 1,
      "effort": "low | medium | high"
    }
  ],
  "action_items": [
    {
      "title": "Concrete next step with a clear owner suggestion",
      "description": "How to implement this change",
      "expected_impact": "What improvement we expect to see",
      "priority": 1,
      "category": "process | technical | communication | planning",
      "measurable_outcome": "How we'll know it worked (specific metric)"
    }
  ],
  "celebrations": ["List 2-3 things to celebrate, referencing specific ticket keys and people"],
  "warning_signs": ["List potential risks or anti-patterns the coach spotted from the data"],
  "team_dynamics_observations": ["Observations about workload balance, communication patterns, collaboration based on the ticket data"],
  "next_sprint_focus": "One sentence describing the team's top priority for next sprint based on what this retro reveals"
}`);

  return lines.join("\n");
}

function buildTicketSummaryForCoach(ticketData) {
  const epics = ticketData.epics || [];
  const noEpic = ticketData.noEpic || [];
  const allIssues = [...epics.flatMap((e) => e.issues || []), ...noEpic];
  const done = allIssues.filter((i) => i.statusCategory === "done");
  const inProgress = allIssues.filter((i) => i.statusCategory === "indeterminate");
  const toDo = allIssues.filter((i) => i.statusCategory === "new");
  const overdue = allIssues.filter((i) => i.urgencyFlags?.some((f) => f.type === "overdue"));
  const stale = allIssues.filter((i) => i.urgencyFlags?.some((f) => f.type === "stale"));
  const blocked = allIssues.filter((i) => i.urgencyFlags?.some((f) => f.type === "blocked" || f.type === "blocker"));
  const unassigned = allIssues.filter((i) => !i.assigneeName && i.statusCategory !== "done");

  const ticketDetail = (i) => ({
    key: i.key,
    summary: i.summary,
    status: i.status,
    assignee: i.assigneeName || "Unassigned",
    type: i.issueType || "Task",
    priority: i.priority || "—",
    ...(i.dueDate && { dueDate: i.dueDate }),
    ...(i.storyPoints && { points: i.storyPoints }),
  });

  return {
    total: allIssues.length,
    completionRate: allIssues.length > 0 ? Math.round((done.length / allIssues.length) * 100) : 0,
    epicCount: epics.length,
    counts: { done: done.length, inProgress: inProgress.length, toDo: toDo.length, overdue: overdue.length, stale: stale.length, blocked: blocked.length, unassigned: unassigned.length },
    completed: done.map(ticketDetail),
    stillInProgress: inProgress.map(ticketDetail),
    overdue: overdue.map(ticketDetail),
    stale: stale.map(ticketDetail),
    blocked: blocked.map(ticketDetail),
    unassigned: unassigned.map(ticketDetail),
    workloadByAssignee: Object.entries(
      allIssues.reduce((acc, i) => {
        const name = i.assigneeName || "Unassigned";
        acc[name] = (acc[name] || 0) + 1;
        return acc;
      }, {})
    ).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

function TicketAnalysisPanel({ ticketData, jiraBaseUrl }) {
  const epics = ticketData.epics || [];
  const noEpic = ticketData.noEpic || [];
  const allIssues = [...epics.flatMap((e) => e.issues || []), ...noEpic];
  const done = allIssues.filter((i) => i.statusCategory === "done");
  const inProgress = allIssues.filter((i) => i.statusCategory === "indeterminate");
  const overdue = allIssues.filter((i) => i.urgencyFlags?.some((f) => f.type === "overdue"));
  const stale = allIssues.filter((i) => i.urgencyFlags?.some((f) => f.type === "stale"));
  const blocked = allIssues.filter((i) => i.urgencyFlags?.some((f) => f.type === "blocked" || f.type === "blocker"));
  const unassigned = allIssues.filter((i) => !i.assigneeName && i.statusCategory !== "done");

  if (allIssues.length === 0) return null;

  const completionRate = Math.round((done.length / allIssues.length) * 100);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-4">Sprint Ticket Analysis (for retro context)</h3>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
        <StatCard label="Total" value={allIssues.length} color="text-gray-700" />
        <StatCard label="Done" value={done.length} color="text-green-700" bg="bg-green-50" />
        <StatCard label="In Progress" value={inProgress.length} color="text-blue-700" bg="bg-blue-50" />
        <StatCard label="Overdue" value={overdue.length} color="text-red-700" bg="bg-red-50" alert={overdue.length > 0} />
        <StatCard label="Stale" value={stale.length} color="text-orange-700" bg="bg-orange-50" alert={stale.length > 0} />
        <StatCard label="Blocked" value={blocked.length} color="text-red-700" bg="bg-red-50" alert={blocked.length > 0} />
        <StatCard label="Unassigned" value={unassigned.length} color="text-purple-700" bg="bg-purple-50" alert={unassigned.length > 0} />
      </div>

      {/* Completion bar */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs text-gray-500">Completion:</span>
        <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${completionRate >= 80 ? "bg-green-500" : completionRate >= 50 ? "bg-blue-500" : "bg-amber-500"}`}
            style={{ width: `${completionRate}%` }}
          />
        </div>
        <span className="text-sm font-semibold text-gray-700">{completionRate}%</span>
      </div>

      {/* Quick insights */}
      {(overdue.length > 0 || stale.length > 0 || blocked.length > 0) && (
        <div className="space-y-2">
          {overdue.length > 0 && (
            <div className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <strong>Overdue:</strong> {overdue.map((i) => (
                <a key={i.key} href={`${jiraBaseUrl}/browse/${i.key}`} target="_blank" rel="noopener noreferrer" className="font-mono hover:underline ml-1">{i.key}</a>
              ))}
            </div>
          )}
          {stale.length > 0 && (
            <div className="text-xs text-orange-700 bg-orange-50 rounded-lg px-3 py-2">
              <strong>Stale (7+ days):</strong> {stale.map((i) => (
                <a key={i.key} href={`${jiraBaseUrl}/browse/${i.key}`} target="_blank" rel="noopener noreferrer" className="font-mono hover:underline ml-1">{i.key}</a>
              ))}
            </div>
          )}
          {blocked.length > 0 && (
            <div className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <strong>Blocked:</strong> {blocked.map((i) => (
                <a key={i.key} href={`${jiraBaseUrl}/browse/${i.key}`} target="_blank" rel="noopener noreferrer" className="font-mono hover:underline ml-1">{i.key}</a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PROMPT_CAT_COLORS = {
  process: { bg: "bg-purple-50", border: "border-purple-200", badge: "bg-purple-100 text-purple-700" },
  workflow: { bg: "bg-blue-50", border: "border-blue-200", badge: "bg-blue-100 text-blue-700" },
  workload: { bg: "bg-orange-50", border: "border-orange-200", badge: "bg-orange-100 text-orange-700" },
  planning: { bg: "bg-indigo-50", border: "border-indigo-200", badge: "bg-indigo-100 text-indigo-700" },
  prioritization: { bg: "bg-amber-50", border: "border-amber-200", badge: "bg-amber-100 text-amber-700" },
  ownership: { bg: "bg-red-50", border: "border-red-200", badge: "bg-red-100 text-red-700" },
  quality: { bg: "bg-pink-50", border: "border-pink-200", badge: "bg-pink-100 text-pink-700" },
  positive: { bg: "bg-green-50", border: "border-green-200", badge: "bg-green-100 text-green-700" },
  improvement: { bg: "bg-teal-50", border: "border-teal-200", badge: "bg-teal-100 text-teal-700" },
};

function SprintInsightsPanel({ analyticsData }) {
  if (!analyticsData) return null;

  const retroPrompts = analyticsData.retroPrompts || [];
  const health = analyticsData.sprintHealth;
  const bottlenecks = analyticsData.bottlenecks || [];
  const wipViolations = analyticsData.wipLimits?.violations || [];

  // Workload from analytics backend (already computed per-person)
  const workload = analyticsData.teamWorkload || [];

  const maxWorkload = Math.max(...workload.map((w) => w.total), 1);

  const healthColor = health?.score >= 75 ? "text-green-600" : health?.score >= 50 ? "text-amber-600" : "text-red-600";
  const healthBg = health?.score >= 75 ? "bg-green-50" : health?.score >= 50 ? "bg-amber-50" : "bg-red-50";

  return (
    <div className="space-y-4">
      {/* Sprint Metrics Row */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Sprint Metrics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {health && (
            <div className={`rounded-lg p-3 text-center ${healthBg}`}>
              <div className={`text-xl font-bold ${healthColor}`}>{health.score}/100</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Sprint Health</div>
            </div>
          )}
          <div className="rounded-lg p-3 text-center bg-gray-50">
            <div className="text-xl font-bold text-gray-700">{analyticsData.total}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Total Tickets</div>
          </div>
          <div className="rounded-lg p-3 text-center bg-blue-50">
            <div className="text-xl font-bold text-blue-700">{analyticsData.wipCount}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">WIP</div>
          </div>
          <div className="rounded-lg p-3 text-center bg-gray-50">
            <div className="text-xl font-bold text-gray-700">{analyticsData.cycleTime?.avg || "—"}d</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Avg Cycle Time</div>
          </div>
          <div className="rounded-lg p-3 text-center bg-gray-50">
            <div className={`text-xl font-bold ${analyticsData.avgQuality >= 60 ? "text-green-700" : analyticsData.avgQuality >= 40 ? "text-amber-700" : "text-red-700"}`}>
              {analyticsData.avgQuality}%
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Avg Quality</div>
          </div>
          <div className="rounded-lg p-3 text-center bg-gray-50">
            <div className={`text-xl font-bold ${analyticsData.priorityInflation > 30 ? "text-amber-700" : "text-gray-700"}`}>
              {analyticsData.priorityInflation}%
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Priority Inflation</div>
          </div>
        </div>

        {/* Bottlenecks */}
        {bottlenecks.length > 0 && (
          <div className="mt-4">
            <p className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider mb-2">Bottlenecks</p>
            <div className="flex flex-wrap gap-2">
              {bottlenecks.map((b, i) => (
                <span key={i} className="text-xs bg-red-50 text-red-700 px-2.5 py-1 rounded-lg border border-red-200">
                  {b.status}: {b.count} items ({b.ratio}x avg)
                </span>
              ))}
            </div>
          </div>
        )}

        {/* WIP Violations */}
        {wipViolations.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider mb-2">WIP Limit Violations</p>
            <div className="flex flex-wrap gap-2">
              {wipViolations.map((v, i) => (
                <span key={i} className="text-xs bg-orange-50 text-orange-700 px-2.5 py-1 rounded-lg border border-orange-200">
                  {v.name}: {v.current}/{v.limit}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Workload Distribution */}
      {workload.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Workload Distribution</h3>
          <div className="space-y-2">
            {workload.map((w) => (
              <div key={w.name} className="flex items-center gap-3">
                <span className="text-xs text-gray-600 w-28 shrink-0 truncate" title={w.name}>{w.name}</span>
                <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-green-400 transition-all"
                    style={{ width: `${(w.done / maxWorkload) * 100}%` }}
                    title={`Done: ${w.done}`}
                  />
                  <div
                    className="h-full bg-blue-400 transition-all"
                    style={{ width: `${(w.inProgress / maxWorkload) * 100}%` }}
                    title={`In Progress: ${w.inProgress}`}
                  />
                  <div
                    className="h-full bg-gray-300 transition-all"
                    style={{ width: `${((w.todo || (w.total - w.done - w.inProgress)) / maxWorkload) * 100}%` }}
                    title={`To Do: ${w.todo || (w.total - w.done - w.inProgress)}`}
                  />
                </div>
                <span className="text-xs text-gray-500 w-8 text-right shrink-0">{w.total}</span>
                {w.overdue > 0 && (
                  <span className="text-[10px] text-red-600 font-medium">{w.overdue} overdue</span>
                )}
              </div>
            ))}
            <div className="flex items-center gap-4 mt-2 pt-2 border-t border-gray-100">
              <span className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block" /> Done</span>
              <span className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2.5 h-2.5 rounded-full bg-blue-400 inline-block" /> In Progress</span>
              <span className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2.5 h-2.5 rounded-full bg-gray-300 inline-block" /> To Do</span>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Generated Discussion Prompts */}
      {retroPrompts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-gray-800">Discussion Prompts</h3>
            <span className="text-[10px] text-gray-400">Auto-generated from board patterns</span>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Data-driven questions to guide your retrospective — based on actual ticket patterns detected in your board.
          </p>
          <div className="space-y-2.5">
            {retroPrompts.map((prompt, i) => {
              const colors = PROMPT_CAT_COLORS[prompt.category] || PROMPT_CAT_COLORS.process;
              return (
                <div key={i} className={`${colors.bg} border ${colors.border} rounded-xl p-4`}>
                  <div className="flex items-start gap-3">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${colors.badge} uppercase shrink-0 mt-0.5`}>
                      {prompt.category}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm text-gray-800 font-medium leading-relaxed">{prompt.question}</p>
                      {prompt.context && (
                        <p className="text-xs text-gray-500 mt-1.5">{prompt.context}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, bg = "bg-gray-50", alert = false }) {
  return (
    <div className={`rounded-lg p-3 text-center ${bg} ${alert ? "ring-1 ring-red-200" : ""}`}>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}

export default function RetroPage() {
  const { defaultJql, jiraBaseUrl } = useAppConfig();
  const [view, setView] = useState("sessions"); // "sessions" | "session" | "prompt" | "paste" | "report"
  const [sessions, setSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [newTitle, setNewTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [entryText, setEntryText] = useState("");
  const [entryCategory, setEntryCategory] = useState("went_well");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [copied, setCopied] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [report, setReport] = useState(null);
  const [showCoachTips, setShowCoachTips] = useState(true);
  const [pollInterval, setPollInterval] = useState(null);

  // Ticket analysis state
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");
  const [ticketData, setTicketData] = useState(null);
  const [ticketLoading, setTicketLoading] = useState(false);

  // Load author from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("retro-author");
    if (saved) setAuthor(saved);
  }, []);

  useEffect(() => {
    if (author) localStorage.setItem("retro-author", author);
  }, [author]);

  // Load sessions
  const loadSessions = useCallback(async () => {
    try {
      const data = await fetchRetroSessions();
      setSessions(data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => {
    if (defaultJql) {
      setJql((prev) => prev || defaultJql);
      setInputJql((prev) => prev || defaultJql);
    }
  }, [defaultJql]);

  // Load analytics and ticket data for prompt building
  useEffect(() => {
    if (jql) fetchAnalytics(jql).then(setAnalyticsData).catch(() => {});
  }, [jql]);

  // Load ticket data when JQL changes
  const loadTickets = useCallback(async (query) => {
    setTicketLoading(true);
    try {
      const result = await fetchIssues(query);
      setTicketData(result);
    } catch (err) {
      console.error("Failed to load ticket data:", err);
    }
    setTicketLoading(false);
  }, []);

  useEffect(() => {
    if (jql) loadTickets(jql);
  }, [jql, loadTickets]);

  // Auto-refresh current session every 5 seconds (collaborative)
  useEffect(() => {
    if (!currentSession?.id) return;
    const interval = setInterval(async () => {
      try {
        const updated = await fetchRetroSession(currentSession.id);
        setCurrentSession(updated);
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [currentSession?.id]);

  const handleCreateSession = async () => {
    if (!newTitle.trim()) return;
    setLoading(true);
    try {
      const session = await createRetroSession(newTitle.trim());
      setCurrentSession(session);
      setView("session");
      setNewTitle("");
      loadSessions();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleOpenSession = async (id) => {
    setLoading(true);
    try {
      const session = await fetchRetroSession(id);
      setCurrentSession(session);
      setView("session");
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleAddEntry = async () => {
    if (!entryText.trim() || !currentSession) return;
    try {
      await addRetroEntry(currentSession.id, {
        author: author || "Anonymous",
        category: entryCategory,
        text: entryText.trim(),
      });
      setEntryText("");
      const updated = await fetchRetroSession(currentSession.id);
      setCurrentSession(updated);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleVote = async (entryId) => {
    if (!currentSession) return;
    try {
      await voteRetroEntry(currentSession.id, entryId);
      const updated = await fetchRetroSession(currentSession.id);
      setCurrentSession(updated);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleParseJson = () => {
    try {
      let cleaned = jsonInput.trim();
      if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      const parsed = JSON.parse(cleaned);
      setReport(parsed);
      localStorage.setItem(`retro-report-${currentSession?.id}`, JSON.stringify(parsed));
      setView("report");
    } catch {
      setError("Invalid JSON. Make sure you copied the complete AI response.");
    }
  };

  // Load saved report if exists
  useEffect(() => {
    if (currentSession?.id) {
      const saved = localStorage.getItem(`retro-report-${currentSession.id}`);
      if (saved) {
        try { setReport(JSON.parse(saved)); } catch {}
      }
    }
  }, [currentSession?.id]);

  const prompt = useMemo(() => {
    if (!currentSession) return "";
    return buildRetroPrompt(analyticsData, currentSession.entries || [], ticketData, {});
  }, [analyticsData, currentSession, ticketData]);

  const entriesByCategory = useMemo(() => {
    if (!currentSession?.entries) return {};
    const grouped = {};
    for (const cat of CATEGORIES) {
      grouped[cat.key] = (currentSession.entries || [])
        .filter((e) => e.category === cat.key)
        .sort((a, b) => b.votes - a.votes);
    }
    return grouped;
  }, [currentSession?.entries]);

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">Retrospective</h1>
            <div className="flex items-center gap-2">
              {ticketData && (
                <span className="text-xs text-gray-400">{ticketData.total} tickets loaded</span>
              )}
              {ticketLoading && (
                <span className="text-xs text-blue-500">Loading tickets...</span>
              )}
            </div>
          </div>

          {/* JQL Bar for ticket selection */}
          <JqlBar
            value={inputJql}
            onChange={setInputJql}
            onSubmit={(q) => setJql(q)}
            placeholder="Select sprint/tickets for retrospective analysis..."
          />

          {/* Breadcrumb navigation */}
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={() => { setView("sessions"); setCurrentSession(null); }}
              className={`px-3 py-1 rounded ${view === "sessions" ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100"}`}
            >
              Sessions
            </button>
            {currentSession && (
              <>
                <span className="text-gray-300">/</span>
                <button
                  onClick={() => setView("session")}
                  className={`px-3 py-1 rounded ${view === "session" ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100"}`}
                >
                  {currentSession.title}
                </button>
                <span className="text-gray-300">/</span>
                <button
                  onClick={() => setView("prompt")}
                  className={`px-3 py-1 rounded ${view === "prompt" ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100"}`}
                >
                  AI Prompt
                </button>
                <button
                  onClick={() => setView("paste")}
                  className={`px-3 py-1 rounded ${view === "paste" ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100"}`}
                >
                  Paste Response
                </button>
                {report && (
                  <button
                    onClick={() => setView("report")}
                    className={`px-3 py-1 rounded ${view === "report" ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100"}`}
                  >
                    AI Report
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-center justify-between">
            <span><strong>Error:</strong> {error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-xs">Dismiss</button>
          </div>
        )}

        {/* AI Coach — ticket-data-driven insights */}
        {currentSession && (
          <div className="mb-4">
            <AiCoachPanel
              context="Sprint Retrospective"
              data={{
                entries: currentSession.entries?.map(e => ({ category: e.category, text: e.text, votes: e.votes })),
                entryCount: currentSession.entries?.length,
                ticketSummary: ticketData ? buildTicketSummaryForCoach(ticketData) : null,
                analytics: analyticsData ? {
                  total: analyticsData.total,
                  wipCount: analyticsData.wipCount,
                  avgQuality: analyticsData.avgQuality,
                  cycleTime: analyticsData.cycleTime,
                  staleCount: analyticsData.staleIssues?.length || 0,
                  staleTickets: analyticsData.staleIssues?.slice(0, 10).map((i) => ({ key: i.key, summary: i.summary, daysSinceUpdate: i.daysSinceUpdate })),
                  overdueCount: analyticsData.dueDateCompliance?.overdueActive || 0,
                  priorityInflation: analyticsData.priorityInflation,
                  sprintHealth: analyticsData.sprintHealth,
                  bottlenecks: analyticsData.bottlenecks,
                  wipViolations: analyticsData.wipLimits?.violations,
                  retroPrompts: analyticsData.retroPrompts,
                } : null,
              }}
              prompts={[
                {
                  label: "Full Retro Analysis",
                  primary: true,
                  question: `As a senior Agile Coach, analyze this sprint's ticket data AND team feedback together. For each area below, reference SPECIFIC ticket keys and assignees:

1. **What Went Well**: Identify completed work, good practices, and wins — cite the tickets that demonstrate this
2. **What Went Wrong**: Overdue items, stale tickets, blockers, scope creep — cite specific tickets
3. **Root Causes**: For each problem, analyze WHY it happened (process? planning? communication? technical?)
4. **Coaching Questions**: Suggest 5 powerful questions to ask the team that will drive deeper reflection (based on the specific patterns you see in the data)
5. **Improvement Plan**: 3 concrete improvements ranked by impact, with measurable success criteria
6. **Team Dynamics**: Observations on workload balance, communication patterns, and collaboration
7. **Next Sprint Recommendations**: What should change immediately based on this retro`,
                },
                {
                  label: "What went well vs wrong",
                  question: "Analyze the ticket data to identify what went well (completed on time, good velocity, unblocked quickly) vs what went wrong (overdue, stale, blocked, unassigned). For each, cite the specific ticket keys as evidence.",
                },
                {
                  label: "Coaching questions",
                  question: `Based on the ticket data patterns (overdue items, stale tickets, workload distribution, blockers), suggest 8-10 powerful retrospective coaching questions. These should be:
- Evidence-based (reference specific patterns from the data)
- Open-ended (start with "What...", "How...", "Why...")
- Action-oriented (lead toward concrete improvements)
- Non-blaming (focus on process, not people)
Examples: "What caused [TICKET-KEY] to become stale for 14 days — was it a dependency, unclear requirements, or competing priorities?"`,
                },
                {
                  label: "Improvement suggestions",
                  question: "Based on the sprint data, suggest 5 specific process improvements. For each, explain: what problem it solves (cite ticket keys), how to implement it, what metric will prove it worked, and the estimated effort (low/medium/high).",
                },
                {
                  label: "Team workload analysis",
                  question: "Analyze the workload distribution across team members. Who is overloaded? Who has capacity? Are there bottlenecks in specific people? Suggest rebalancing strategies for next sprint.",
                },
                {
                  label: "Pattern analysis",
                  question: "Look at the ticket data for recurring anti-patterns: Do we consistently miss deadlines? Are certain types of work always blocked? Do specific team members always end up with stale tickets? Identify 3-5 systemic patterns and suggest how to break each cycle.",
                },
              ]}
            />
          </div>
        )}

        {/* AI Coach — available even without session, for ticket-only analysis */}
        {!currentSession && ticketData && ticketData.total > 0 && (
          <div className="mb-4">
            <AiCoachPanel
              context="Retrospective Ticket Analysis"
              data={{
                ticketSummary: buildTicketSummaryForCoach(ticketData),
                analytics: analyticsData ? {
                  total: analyticsData.total,
                  wipCount: analyticsData.wipCount,
                  avgQuality: analyticsData.avgQuality,
                  cycleTime: analyticsData.cycleTime,
                  staleCount: analyticsData.staleIssues?.length || 0,
                  staleTickets: analyticsData.staleIssues?.slice(0, 10).map((i) => ({ key: i.key, summary: i.summary, daysSinceUpdate: i.daysSinceUpdate })),
                  overdueCount: analyticsData.dueDateCompliance?.overdueActive || 0,
                  priorityInflation: analyticsData.priorityInflation,
                  sprintHealth: analyticsData.sprintHealth,
                  bottlenecks: analyticsData.bottlenecks,
                  wipViolations: analyticsData.wipLimits?.violations,
                  retroPrompts: analyticsData.retroPrompts,
                } : null,
              }}
              prompts={[
                {
                  label: "Pre-Retro Analysis",
                  primary: true,
                  question: `Analyze the ticket data to prepare for a retrospective. Identify:
1. Key wins and completed work worth celebrating
2. Problems: overdue, stale, blocked, or unassigned items (cite ticket keys)
3. Root cause hypotheses for each problem
4. 8 coaching questions to drive the retro discussion
5. Suggested retro agenda based on the data patterns`,
                },
                {
                  label: "Retro discussion topics",
                  question: "Based on the ticket data, suggest the top 5 discussion topics for our retrospective, ordered by impact. For each, provide the evidence from tickets and a coaching question to start the conversation.",
                },
                {
                  label: "Sprint health assessment",
                  question: "Give a health assessment of this sprint based purely on the ticket data. Score it 0-100 and explain the key factors. What's the single biggest risk going into next sprint?",
                },
              ]}
            />
          </div>
        )}

        {/* ═══ AGILE COACH TIPS ═══ */}
        {showCoachTips && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-indigo-800">Agile Coach Tips for Better Retrospectives</h3>
              <button onClick={() => setShowCoachTips(false)} className="text-xs text-indigo-500 hover:text-indigo-700">Hide</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {COACH_TIPS.map((tip, i) => (
                <div key={i} className="bg-white/70 rounded-lg p-3 border border-indigo-100">
                  <p className="text-xs font-semibold text-indigo-700">{tip.title}</p>
                  <p className="text-[11px] text-indigo-600 mt-1">{tip.detail}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {!showCoachTips && (
          <button onClick={() => setShowCoachTips(true)} className="text-xs text-indigo-500 hover:text-indigo-700">
            Show Agile Coach Tips
          </button>
        )}

        {/* ═══ TICKET ANALYSIS PANEL ═══ */}
        {ticketData && !ticketLoading && (
          <TicketAnalysisPanel ticketData={ticketData} jiraBaseUrl={jiraBaseUrl} />
        )}

        {/* ═══ SPRINT INSIGHTS (metrics + workload + discussion prompts) ═══ */}
        {analyticsData && !ticketLoading && (
          <SprintInsightsPanel analyticsData={analyticsData} />
        )}

        {/* ═══ SESSIONS LIST ═══ */}
        {view === "sessions" && (
          <div className="space-y-6">
            {/* Create new session */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Start a New Retrospective</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={`Sprint Retro — ${new Date().toISOString().split("T")[0]}`}
                  className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  onKeyDown={(e) => e.key === "Enter" && handleCreateSession()}
                />
                <button
                  onClick={handleCreateSession}
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50"
                >
                  Create Session
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Share the session URL with your team so everyone can add their feedback simultaneously.
              </p>
            </div>

            {/* Existing sessions */}
            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Previous Sessions</h3>
              {sessions.length > 0 ? (
                <div className="space-y-2">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleOpenSession(s.id)}
                    >
                      <div>
                        <h4 className="text-sm font-medium text-gray-800">{s.title}</h4>
                        <p className="text-xs text-gray-500">{new Date(s.createdAt).toLocaleString()} — {s.entryCount} entries</p>
                      </div>
                      <span className="text-xs text-blue-600">Open &rarr;</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400 text-sm">No retrospective sessions yet. Create one to get started.</div>
              )}
            </div>
          </div>
        )}

        {/* ═══ ACTIVE SESSION (Collaborative Board) ═══ */}
        {view === "session" && currentSession && (
          <div className="space-y-6">
            {/* Author name */}
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500">Your name:</label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Enter your name..."
                className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <span className="text-[10px] text-green-600 ml-auto">Auto-refreshing every 5s</span>
              <button
                onClick={() => setView("prompt")}
                className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg"
              >
                Generate AI Prompt &rarr;
              </button>
            </div>

            {/* Entry input */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex gap-2 mb-3">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    onClick={() => setEntryCategory(cat.key)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      entryCategory === cat.key
                        ? `${cat.badge} border-current font-medium`
                        : "text-gray-500 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {cat.icon} {cat.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={entryText}
                  onChange={(e) => setEntryText(e.target.value)}
                  placeholder={`Add a "${CATEGORIES.find((c) => c.key === entryCategory)?.label}" item...`}
                  className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  onKeyDown={(e) => e.key === "Enter" && handleAddEntry()}
                />
                <button
                  onClick={handleAddEntry}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Category columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {CATEGORIES.map((cat) => {
                const items = entriesByCategory[cat.key] || [];
                return (
                  <div key={cat.key} className={`rounded-xl border p-4 ${cat.color} min-h-[200px]`}>
                    <h4 className="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <span>{cat.icon}</span>
                      <span>{cat.label}</span>
                      <span className={`ml-auto px-1.5 py-0.5 rounded-full text-[10px] ${cat.badge}`}>
                        {items.length}
                      </span>
                    </h4>
                    <div className="space-y-2">
                      {items.map((entry) => (
                        <div key={entry.id} className="bg-white rounded-lg p-3 shadow-sm border border-white/50">
                          <p className="text-sm text-gray-800">{entry.text}</p>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-[10px] text-gray-400">{entry.author}</span>
                            <button
                              onClick={() => handleVote(entry.id)}
                              className="text-[10px] px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                            >
                              {"\uD83D\uDC4D"} {entry.votes}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ AI PROMPT ═══ */}
        {view === "prompt" && currentSession && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
              <strong>Step 1:</strong> This prompt combines your board metrics with your team&apos;s retro feedback.
              Copy it and paste into your corporate AI chatbot.
            </div>

            <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-300">Retro Analysis Prompt</span>
                  <span className="text-[10px] text-gray-500">{prompt.length.toLocaleString()} chars</span>
                  <span className="text-[10px] text-gray-500">~{Math.ceil(prompt.length / 4).toLocaleString()} tokens</span>
                </div>
                <button
                  onClick={() => handleCopy(prompt)}
                  className={`text-xs px-3 py-1 rounded transition-all ${
                    copied ? "bg-green-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-gray-200"
                  }`}
                >
                  {copied ? "Copied!" : "Copy to clipboard"}
                </button>
              </div>
              <pre className="p-4 text-xs text-gray-300 font-mono overflow-auto max-h-[500px] whitespace-pre-wrap leading-relaxed">
                {prompt}
              </pre>
            </div>

            <button
              onClick={() => { handleCopy(prompt); setTimeout(() => setView("paste"), 500); }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-lg"
            >
              Copy & Continue to Paste Response &rarr;
            </button>
          </div>
        )}

        {/* ═══ PASTE AI RESPONSE ═══ */}
        {view === "paste" && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
              <strong>Step 2:</strong> Paste the AI&apos;s JSON response below. The dashboard will visualize the insights.
            </div>

            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder="Paste the JSON response from your AI chatbot here..."
              className="w-full h-[400px] text-sm bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />

            <button
              onClick={handleParseJson}
              disabled={!jsonInput.trim()}
              className="w-full bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-2.5 rounded-lg disabled:opacity-50"
            >
              Parse & View Report
            </button>
          </div>
        )}

        {/* ═══ AI REPORT ═══ */}
        {view === "report" && report && (
          <div className="space-y-6">
            {/* Sprint summary */}
            <div className={`rounded-xl border-2 p-6 ${
              report.health_assessment?.status === "healthy" ? "bg-green-50 border-green-300"
                : report.health_assessment?.status === "needs_attention" ? "bg-amber-50 border-amber-300"
                : "bg-red-50 border-red-300"
            }`}>
              <div className="flex items-center gap-4 mb-3">
                <div className="text-3xl font-bold">
                  {report.health_assessment?.score || "—"}
                </div>
                <div>
                  <div className="text-lg font-semibold capitalize">
                    {(report.health_assessment?.status || "unknown").replace("_", " ")}
                  </div>
                  <p className="text-sm text-gray-700 mt-1">{report.sprint_summary}</p>
                </div>
              </div>
              {report.health_assessment?.key_metrics && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {report.health_assessment.key_metrics.map((m, i) => (
                    <span key={i} className="text-xs bg-white/60 rounded-full px-3 py-1 text-gray-700">{m}</span>
                  ))}
                </div>
              )}
            </div>

            {/* What Went Well */}
            {report.what_went_well?.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-green-800 mb-3">What Went Well</h3>
                <div className="space-y-3">
                  {report.what_went_well.map((item, i) => (
                    <div key={i} className="bg-white/60 rounded-lg p-3">
                      <h4 className="text-sm font-medium text-green-800">{item.title}</h4>
                      <p className="text-xs text-green-700 mt-1"><strong>Evidence:</strong> {item.evidence}</p>
                      {item.team_alignment && (
                        <p className="text-xs text-green-600 mt-1"><strong>Team says:</strong> {item.team_alignment}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* What Went Wrong */}
            {report.what_went_wrong?.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-red-800 mb-3">What Went Wrong</h3>
                <div className="space-y-3">
                  {report.what_went_wrong.map((item, i) => {
                    const impactColor = item.impact === "high" ? "bg-red-200 text-red-800"
                      : item.impact === "medium" ? "bg-amber-200 text-amber-800"
                      : "bg-gray-200 text-gray-700";
                    return (
                      <div key={i} className="bg-white/60 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-sm font-medium text-red-800">{item.title}</h4>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${impactColor}`}>{item.impact}</span>
                        </div>
                        <p className="text-xs text-red-700"><strong>Evidence:</strong> {item.evidence}</p>
                        <p className="text-xs text-red-600 mt-1"><strong>Root cause:</strong> {item.root_cause}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Celebrations */}
            {report.celebrations?.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-green-800 mb-3">Celebrations</h3>
                <div className="space-y-2">
                  {report.celebrations.map((c, i) => (
                    <p key={i} className="text-sm text-green-700">{c}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Coaching Questions */}
            {report.coaching_questions?.length > 0 && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-indigo-800 mb-3">Coaching Questions for the Team</h3>
                <div className="space-y-2">
                  {report.coaching_questions.map((q, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-indigo-400 text-sm mt-0.5 shrink-0">{i + 1}.</span>
                      <p className="text-sm text-indigo-700 italic">{q}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warning Signs (Coach) */}
            {report.warning_signs?.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-red-800 mb-3">Agile Coach Warning Signs</h3>
                <div className="space-y-2">
                  {report.warning_signs.map((w, i) => (
                    <p key={i} className="text-sm text-red-700">{w}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Team Dynamics */}
            {report.team_dynamics_observations?.length > 0 && (
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-purple-800 mb-3">Team Dynamics Observations</h3>
                <div className="space-y-2">
                  {report.team_dynamics_observations.map((obs, i) => (
                    <p key={i} className="text-sm text-purple-700">{obs}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Themes */}
            {report.themes?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-3">Identified Themes</h3>
                <div className="space-y-3">
                  {report.themes.map((theme, i) => {
                    const impactColor = theme.impact === "high" ? "bg-red-100 text-red-700"
                      : theme.impact === "medium" ? "bg-amber-100 text-amber-700"
                      : "bg-blue-100 text-blue-700";
                    return (
                      <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${impactColor}`}>
                            {theme.impact} impact
                          </span>
                          <span className="text-[10px] text-gray-400 px-2 py-0.5 rounded bg-gray-100">
                            {theme.category}
                          </span>
                          <h4 className="text-sm font-semibold text-gray-800">{theme.title}</h4>
                        </div>
                        <p className="text-sm text-gray-600 mb-3">{theme.description}</p>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="bg-gray-50 rounded-lg p-3">
                            <span className="font-medium text-gray-500">From Data:</span>
                            <p className="text-gray-700 mt-1">{theme.evidence_from_data}</p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-3">
                            <span className="font-medium text-gray-500">From Team:</span>
                            <p className="text-gray-700 mt-1">{theme.evidence_from_team}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Action Items */}
            {report.action_items?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-3">{"\uD83D\uDE80"} Action Items</h3>
                <div className="space-y-2">
                  {report.action_items.map((item, i) => (
                    <div key={i} className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold text-blue-700 bg-blue-200 rounded-full w-6 h-6 flex items-center justify-center">
                          {item.priority || i + 1}
                        </span>
                        <h4 className="text-sm font-semibold text-blue-900">{item.title}</h4>
                        <span className="text-[10px] text-blue-500 ml-auto">{item.category}</span>
                      </div>
                      <p className="text-sm text-blue-800">{item.description}</p>
                      <div className="flex gap-4 mt-2 text-xs text-blue-600">
                        <span><strong>Expected:</strong> {item.expected_impact}</span>
                        <span><strong>Measure:</strong> {item.measurable_outcome}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Improvement Suggestions */}
            {report.improvement_suggestions?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-3">Improvement Suggestions</h3>
                <div className="space-y-2">
                  {report.improvement_suggestions.map((item, i) => {
                    const effortColor = item.effort === "low" ? "bg-green-100 text-green-700"
                      : item.effort === "medium" ? "bg-amber-100 text-amber-700"
                      : "bg-red-100 text-red-700";
                    return (
                      <div key={i} className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-bold text-indigo-700 bg-indigo-200 rounded-full w-6 h-6 flex items-center justify-center">
                            {item.priority || i + 1}
                          </span>
                          <h4 className="text-sm font-semibold text-indigo-900">{item.title}</h4>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${effortColor}`}>{item.effort} effort</span>
                        </div>
                        <p className="text-sm text-indigo-800">{item.description}</p>
                        <div className="flex flex-wrap gap-4 mt-2 text-xs text-indigo-600">
                          <span><strong>Addresses:</strong> {item.addresses}</span>
                          <span><strong>Measure:</strong> {item.measurable_outcome}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Next Sprint Focus */}
            {report.next_sprint_focus && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 text-center">
                <h3 className="text-xs font-semibold text-indigo-500 uppercase tracking-wider mb-2">Next Sprint Focus</h3>
                <p className="text-lg font-medium text-indigo-800">{report.next_sprint_focus}</p>
              </div>
            )}
          </div>
        )}

        {!loading && !ticketData && !ticketLoading && !jql && view === "sessions" && sessions.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <svg className="mx-auto w-12 h-12 mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <p className="text-lg font-medium text-gray-500 mb-2">Enter a JQL query to get started</p>
            <p className="text-sm mb-4">Type a query in the search bar above, for example:</p>
            <code className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-md">project = MYPROJECT ORDER BY status ASC, updated DESC</code>
            <p className="text-xs text-gray-400 mt-4">
              Or set a default JQL in <a href="/settings" className="text-blue-500 hover:underline font-medium">Settings</a> so pages load automatically.
            </p>
          </div>
        )}

      </main>
    </div>
  );
}
