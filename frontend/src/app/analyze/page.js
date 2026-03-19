"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import FilterBar from "../../components/FilterBar";
import JqlBar from "../../components/JqlBar";
import ResizableTable from "../../components/ResizableTable";
import { fetchIssues, fetchSettings } from "../../lib/api";
import { selectTicketsForPrompt, formatTicketForPrompt, trimPrompt } from "../../lib/prompt-utils";
import { toast } from "../../components/Toaster";

const DEFAULT_JQL = process.env.NEXT_PUBLIC_DEFAULT_JQL || "project = TEAM ORDER BY status ASC, updated DESC";

// ─── Prompt builder: board-wide scrum/kanban analysis ───

function buildAnalysisPrompt(data, missingInfoCriteria, promptSettings = {}) {
  const today = new Date().toISOString().split("T")[0];
  const lines = [];

  lines.push("You are a senior Agile coach and Scrum Master. Perform a thorough analysis of this Jira board and return a structured JSON report.");
  lines.push("IMPORTANT: Return ONLY valid JSON, no markdown, no explanation, no code fences. Just the raw JSON object.");
  lines.push("");
  lines.push(`# Board Analysis — ${today}`);
  lines.push(`Total issues: ${data.total}`);
  lines.push("");

  // ─── Board-level stats
  const s = data.stats;
  lines.push("## Board Statistics");
  lines.push(`- Total: ${s.total}, Done: ${s.done}, In Progress: ${s.inProgress}, To Do: ${s.todo}`);
  lines.push(`- Overdue: ${s.overdue}, Stale (7d+): ${s.stale}, Unassigned: ${s.unassigned}`);
  lines.push("");

  // ─── Epics summary
  if (data.epics?.length > 0) {
    lines.push("## Epics");
    for (const epic of data.epics) {
      lines.push(`### ${epic.key} — ${epic.name}`);
      lines.push(`- Progress: ${epic.progress}% (${epic.stats.done}/${epic.stats.total})`);
      lines.push(`- In Progress: ${epic.stats.inProgress}, To Do: ${epic.stats.todo}`);
      lines.push(`- Critical flags: ${epic.stats.criticalCount}, Warnings: ${epic.stats.warningCount}`);
      if (epic.stats.nextDeadline) lines.push(`- Next deadline: ${epic.stats.nextDeadline}`);
      lines.push("");
    }
  }

  // ─── All tickets detail (smart selection)
  const allIssues = [
    ...(data.epics || []).flatMap((e) => e.issues.map((i) => ({ ...i, epicKey: e.key, epicName: e.name }))),
    ...(data.noEpic || []).map((i) => ({ ...i, epicKey: null, epicName: "No Epic" })),
  ];

  const { selected, stats: selStats } = selectTicketsForPrompt(allIssues, promptSettings);

  if (selStats.excluded > 0) {
    lines.push(`## Tickets (${selStats.included} of ${selStats.total} — ${selStats.excluded} lower-priority tickets excluded to stay within budget)`);
  } else {
    lines.push("## All Tickets");
  }

  for (const t of selected) {
    lines.push("");
    lines.push(formatTicketForPrompt(t, promptSettings));
    lines.push(`- Comment count: ${t.commentCount}`);
  }

  // ─── Analysis instructions
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("Perform a COMPLETE analysis of this board. Check for ALL of the following Scrum/Kanban anti-patterns and best practices:");
  lines.push("");
  lines.push("## What to analyze:");
  lines.push("1. **WIP Limits**: Too many tickets In Progress per person? Per epic? Board-wide?");
  lines.push("2. **Priority inflation**: Are too many tickets marked as Highest/High priority? (If >30% are High+, flag it)");
  lines.push("3. **Missing information**: Tickets without description, due date, assignee, time estimates, labels, comments");
  lines.push("4. **Stale tickets**: Tickets not updated in 7+ days while not done — who should be contacted?");
  lines.push("5. **Blocked tickets**: Any blockers? How long? What action to unblock?");
  lines.push("6. **Overdue tickets**: What is overdue? By how much? Impact?");
  lines.push("7. **Unbalanced workload**: Some team members overloaded, others idle?");
  lines.push("8. **Epic health**: Which epics are at risk? Will they meet deadlines?");
  lines.push("9. **Communication gaps**: Tickets with no comments, no updates, no progress signal");
  lines.push("10. **Sprint/workflow bottlenecks**: Too many tickets stuck in one column?");
  lines.push("11. **Missing dependencies**: Tickets that should be linked but aren't?");
  lines.push("12. **Definition of Done**: Tickets marked Done without comments or time logged?");
  lines.push("");
  lines.push("Return this EXACT JSON structure:");
  lines.push("");
  lines.push(`{
  "board_health": {
    "overall": "healthy | needs_attention | critical",
    "score": 0-100,
    "summary": "2-3 sentence executive summary of the board state",
    "generated_at": "${today}"
  },
  "critical_actions": [
    {
      "priority": 1,
      "severity": "critical | warning | info",
      "category": "blocked | overdue | stale | wip | priority_inflation | missing_info | communication | workload | process",
      "title": "Short action title",
      "description": "What is the issue",
      "affected_tickets": ["TICKET-1", "TICKET-2"],
      "affected_people": ["person name"],
      "recommended_action": "Specific action to take",
      "message_template": "Draft message to send to the affected person(s) — ready to copy/paste in Slack/Teams/email"
    }
  ],
  "missing_info_audit": [
    {
      "ticket_key": "TICKET-1",
      "ticket_summary": "title",
      "assignee": "name or null",
      "missing": ["description", "due_date", "assignee", "estimate", "labels", "comments"],
      "severity": "critical | warning | info",
      "action": "What needs to be added and by whom"
    }
  ],
  "wip_analysis": {
    "board_wip": { "in_progress": number, "recommended_max": number, "status": "ok | over_limit" },
    "per_person": [
      {
        "name": "person",
        "in_progress": number,
        "recommended_max": number,
        "status": "ok | over_limit | idle",
        "tickets": ["TICKET-1"]
      }
    ],
    "per_epic": [
      {
        "epic_key": "EPIC-1",
        "epic_name": "name",
        "in_progress": number,
        "total": number,
        "status": "ok | bottleneck"
      }
    ]
  },
  "priority_analysis": {
    "distribution": { "highest": number, "high": number, "medium": number, "low": number, "lowest": number },
    "is_inflated": true/false,
    "recommendation": "sentence about priority hygiene"
  },
  "stale_tickets": [
    {
      "ticket_key": "TICKET-1",
      "summary": "title",
      "assignee": "name",
      "days_since_update": number,
      "status": "current status",
      "recommended_action": "what to do",
      "contact_message": "Draft message to send to assignee"
    }
  ],
  "epic_health": [
    {
      "key": "EPIC-1",
      "name": "epic name",
      "health": "on_track | at_risk | critical",
      "progress_pct": number,
      "will_meet_deadline": true/false/null,
      "risks": ["risk 1"],
      "next_actions": ["action 1"]
    }
  ],
  "team_workload": [
    {
      "name": "person name",
      "total": number,
      "done": number,
      "in_progress": number,
      "blocked": number,
      "overdue": number,
      "health": "ok | overloaded | idle | blocked",
      "summary": "1 sentence about this person's status",
      "action_needed": "what should this person do next or what should their manager do"
    }
  ],
  "communication_plan": [
    {
      "to": "person name or 'team'",
      "channel": "standup | slack | 1on1 | email",
      "urgency": "now | today | this_week",
      "subject": "short subject",
      "message": "Ready-to-send message body"
    }
  ],
  "process_recommendations": [
    {
      "category": "wip | estimation | ceremonies | documentation | workflow | communication",
      "title": "Recommendation title",
      "current_state": "What is happening now",
      "recommended": "What should change",
      "impact": "high | medium | low"
    }
  ]
}`);
  lines.push("");
  lines.push("Rules:");
  lines.push("- critical_actions MUST be sorted by priority (1 = most critical). Include ALL issues found, not just top 3.");
  lines.push("- message_template should be professional, specific, and ready to paste — include ticket keys and what you need from them.");
  lines.push("- missing_info_audit: check EVERY ticket against these criteria:");
  if (missingInfoCriteria) {
    lines.push(missingInfoCriteria);
  } else {
    lines.push("  If a ticket has no description, no acceptance criteria, no due date, no estimate — flag it.");
  }
  lines.push("- For WIP: recommended max per person is 2-3. Board-wide recommended max is team_size * 2.");
  lines.push("- stale_tickets: include ALL tickets not updated in 7+ days that are not Done.");
  lines.push("- contact_message should be ready-to-send and empathetic but specific about what you need.");
  lines.push("- Return ONLY the JSON. No markdown fences. No explanation.");

  return lines.join("\n");
}

// ─── JSON parser ────────────────────────────────────────

function parseAIResponse(text) {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  cleaned = cleaned.trim();
  return JSON.parse(cleaned);
}

// ─── Shared UI components ───────────────────────────────

const SEVERITY_STYLES = {
  critical: { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", badge: "bg-red-100 text-red-800", dot: "bg-red-500" },
  warning: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", badge: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  info: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", badge: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
};

const HEALTH_STYLES = {
  healthy: { bg: "bg-green-50", border: "border-green-200", text: "text-green-800", badge: "bg-green-100 text-green-800" },
  needs_attention: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", badge: "bg-amber-100 text-amber-800" },
  critical: { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", badge: "bg-red-100 text-red-800" },
  on_track: { bg: "bg-green-50", border: "border-green-200", text: "text-green-800", badge: "bg-green-100 text-green-800" },
  at_risk: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", badge: "bg-amber-100 text-amber-800" },
  ok: { bg: "bg-green-50", border: "border-green-200", text: "text-green-800", badge: "bg-green-100 text-green-800" },
  overloaded: { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", badge: "bg-red-100 text-red-800" },
  idle: { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-600", badge: "bg-gray-100 text-gray-600" },
  blocked: { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", badge: "bg-red-100 text-red-800" },
  over_limit: { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", badge: "bg-red-100 text-red-800" },
  bottleneck: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", badge: "bg-amber-100 text-amber-800" },
};

function Badge({ health }) {
  const s = HEALTH_STYLES[health] || HEALTH_STYLES.ok;
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${s.badge}`}>{health?.replace(/_/g, " ")}</span>;
}

function SeverityBadge({ severity }) {
  const s = SEVERITY_STYLES[severity] || SEVERITY_STYLES.info;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {severity}
    </span>
  );
}

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
        copied ? "bg-green-100 text-green-700 border-green-300" : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
      }`}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

// ─── Report Renderer ────────────────────────────────────

function AnalysisReport({ report }) {
  const [expandedSection, setExpandedSection] = useState("actions");

  const bh = report.board_health || {};
  const bhStyle = HEALTH_STYLES[bh.overall] || HEALTH_STYLES.ok;

  const sections = [
    { key: "actions", label: "Critical Actions", count: report.critical_actions?.length },
    { key: "missing", label: "Missing Info Audit", count: report.missing_info_audit?.length },
    { key: "wip", label: "WIP Analysis" },
    { key: "priority", label: "Priority Analysis" },
    { key: "stale", label: "Stale Tickets", count: report.stale_tickets?.length },
    { key: "epics", label: "Epic Health", count: report.epic_health?.length },
    { key: "team", label: "Team Workload", count: report.team_workload?.length },
    { key: "comms", label: "Communication Plan", count: report.communication_plan?.length },
    { key: "process", label: "Process Recommendations", count: report.process_recommendations?.length },
  ];

  return (
    <div className="space-y-6">
      {/* Board Health Score */}
      <div className={`rounded-xl border-2 ${bhStyle.border} ${bhStyle.bg} p-6`}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-lg font-bold text-gray-900">Board Health</h2>
              <Badge health={bh.overall} />
            </div>
            <p className="text-sm text-gray-800">{bh.summary}</p>
          </div>
          <div className="text-right">
            <p className="text-4xl font-bold text-gray-900">{bh.score}<span className="text-lg text-gray-400">/100</span></p>
          </div>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex flex-wrap gap-1 sticky top-[88px] z-[5] bg-gray-50 py-2 -mx-4 px-4 rounded-lg">
        {sections.map((sec) => (
          <button
            key={sec.key}
            onClick={() => setExpandedSection(expandedSection === sec.key ? null : sec.key)}
            className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
              expandedSection === sec.key
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {sec.label}
            {sec.count != null && (
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                expandedSection === sec.key ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500"
              }`}>{sec.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Critical Actions */}
      {expandedSection === "actions" && report.critical_actions?.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-gray-900">Critical Actions (sorted by priority)</h3>
          {report.critical_actions.map((action, i) => {
            const sv = SEVERITY_STYLES[action.severity] || SEVERITY_STYLES.info;
            return (
              <div key={i} className={`rounded-lg border ${sv.border} ${sv.bg} p-4 space-y-2`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-gray-400 w-6">#{action.priority}</span>
                    <SeverityBadge severity={action.severity} />
                    <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600">{action.category}</span>
                  </div>
                </div>
                <h4 className="text-sm font-semibold text-gray-900">{action.title}</h4>
                <p className="text-xs text-gray-700">{action.description}</p>
                {action.affected_tickets?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {action.affected_tickets.map((t) => (
                      <span key={t} className="text-[10px] font-mono bg-white border border-gray-200 px-1.5 py-0.5 rounded text-blue-700">{t}</span>
                    ))}
                  </div>
                )}
                {action.affected_people?.length > 0 && (
                  <p className="text-xs text-gray-500">People: {action.affected_people.join(", ")}</p>
                )}
                <div className="bg-white rounded-md border border-gray-200 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold uppercase text-gray-400">Recommended Action</span>
                  </div>
                  <p className="text-xs text-gray-800">{action.recommended_action}</p>
                </div>
                {action.message_template && (
                  <div className="bg-white rounded-md border border-gray-200 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold uppercase text-gray-400">Message Template</span>
                      <CopyButton text={action.message_template} label="Copy message" />
                    </div>
                    <p className="text-xs text-gray-700 whitespace-pre-wrap font-mono">{action.message_template}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Missing Info Audit */}
      {expandedSection === "missing" && report.missing_info_audit?.length > 0 && (
        <ResizableTable
          columns={[
            {
              key: "ticket", label: "Ticket", sortable: true, defaultWidth: 200, minWidth: 120,
              render: (row) => (
                <div>
                  <span className="font-bold text-blue-700">{row.ticket_key}</span>
                  <p className="text-gray-500 truncate">{row.ticket_summary}</p>
                </div>
              ),
            },
            {
              key: "assignee", label: "Assignee", sortable: true, defaultWidth: 110, minWidth: 80,
              className: "text-gray-700",
              render: (row) => row.assignee || "—",
            },
            {
              key: "missing", label: "Missing", sortable: true, defaultWidth: 180, minWidth: 100,
              render: (row) => (
                <div className="flex flex-wrap gap-1">
                  {row.missing?.map((m) => (
                    <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{m}</span>
                  ))}
                </div>
              ),
            },
            {
              key: "severity", label: "Severity", sortable: true, defaultWidth: 100, minWidth: 70,
              render: (row) => <SeverityBadge severity={row.severity} />,
            },
            {
              key: "action", label: "Action", sortable: false, defaultWidth: 200, minWidth: 100,
              className: "text-gray-700",
              render: (row) => row.action,
            },
          ]}
          data={report.missing_info_audit}
          getRowKey={(row, i) => row.ticket_key || i}
          sortFn={(a, b, key) => {
            if (key === "ticket") return (a.ticket_key || "").localeCompare(b.ticket_key || "");
            if (key === "assignee") return (a.assignee || "zzz").localeCompare(b.assignee || "zzz");
            if (key === "missing") return (a.missing?.length || 0) - (b.missing?.length || 0);
            if (key === "severity") {
              const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
              return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
            }
            return 0;
          }}
          defaultSort={{ key: "severity", dir: "asc" }}
          emptyMessage="No missing info found"
        />
      )}

      {/* WIP Analysis */}
      {expandedSection === "wip" && report.wip_analysis && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h4 className="text-xs font-semibold text-gray-900 uppercase mb-3">Board WIP</h4>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-3xl font-bold text-gray-900">{report.wip_analysis.board_wip?.in_progress}</p>
                <p className="text-[10px] text-gray-500">In Progress</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-gray-400">{report.wip_analysis.board_wip?.recommended_max}</p>
                <p className="text-[10px] text-gray-500">Recommended Max</p>
              </div>
              <Badge health={report.wip_analysis.board_wip?.status} />
            </div>
          </div>

          {report.wip_analysis.per_person?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                <h4 className="text-xs font-semibold text-gray-700 uppercase">WIP Per Person</h4>
              </div>
              <div className="divide-y divide-gray-100">
                {report.wip_analysis.per_person.map((p, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm font-medium text-gray-900">{p.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-600">{p.in_progress} / {p.recommended_max} max</span>
                      <Badge health={p.status} />
                      {p.tickets?.length > 0 && (
                        <span className="text-[10px] text-gray-400 font-mono">{p.tickets.join(", ")}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.wip_analysis.per_epic?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                <h4 className="text-xs font-semibold text-gray-700 uppercase">WIP Per Epic</h4>
              </div>
              <div className="divide-y divide-gray-100">
                {report.wip_analysis.per_epic.map((e, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <span className="text-xs font-bold text-blue-700">{e.epic_key}</span>
                      <span className="text-xs text-gray-600 ml-2">{e.epic_name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-600">{e.in_progress} in progress / {e.total} total</span>
                      <Badge health={e.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Priority Analysis */}
      {expandedSection === "priority" && report.priority_analysis && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <h4 className="text-xs font-semibold text-gray-900 uppercase">Priority Distribution</h4>
            {report.priority_analysis.is_inflated && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-800">INFLATED</span>
            )}
          </div>
          <div className="flex gap-2">
            {Object.entries(report.priority_analysis.distribution || {}).map(([k, v]) => (
              <div key={k} className={`flex-1 text-center p-2 rounded-lg border ${
                k === "highest" ? "bg-red-50 border-red-200" :
                k === "high" ? "bg-amber-50 border-amber-200" :
                k === "medium" ? "bg-blue-50 border-blue-200" :
                "bg-gray-50 border-gray-200"
              }`}>
                <p className="text-xl font-bold text-gray-900">{v}</p>
                <p className="text-[10px] uppercase text-gray-500">{k}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-700">{report.priority_analysis.recommendation}</p>
        </div>
      )}

      {/* Stale Tickets */}
      {expandedSection === "stale" && report.stale_tickets?.length > 0 && (
        <div className="space-y-3">
          {report.stale_tickets.map((t, i) => (
            <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-blue-700">{t.ticket_key}</span>
                  <span className="text-xs text-gray-600">{t.summary}</span>
                </div>
                <span className="text-xs font-medium text-amber-800">{t.days_since_update}d stale</span>
              </div>
              <p className="text-xs text-gray-600">Assignee: {t.assignee || "None"} | Status: {t.status}</p>
              <p className="text-xs text-gray-700">{t.recommended_action}</p>
              {t.contact_message && (
                <div className="bg-white rounded border border-amber-200 p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold uppercase text-gray-400">Message</span>
                    <CopyButton text={t.contact_message} />
                  </div>
                  <p className="text-xs text-gray-700 font-mono whitespace-pre-wrap">{t.contact_message}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Epic Health */}
      {expandedSection === "epics" && report.epic_health?.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {report.epic_health.map((e, i) => {
            const es = HEALTH_STYLES[e.health] || HEALTH_STYLES.ok;
            return (
              <div key={i} className={`rounded-lg border ${es.border} ${es.bg} p-4 space-y-2`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-blue-700">{e.key}</span>
                    <Badge health={e.health} />
                  </div>
                  <span className="text-lg font-bold text-gray-900">{e.progress_pct}%</span>
                </div>
                <p className="text-sm font-medium text-gray-900">{e.name}</p>
                {e.will_meet_deadline != null && (
                  <p className={`text-xs font-medium ${e.will_meet_deadline ? "text-green-700" : "text-red-700"}`}>
                    {e.will_meet_deadline ? "On track for deadline" : "Will likely miss deadline"}
                  </p>
                )}
                {e.risks?.length > 0 && (
                  <ul className="space-y-0.5">{e.risks.map((r, j) => (
                    <li key={j} className="text-xs text-gray-700 flex items-start gap-1"><span className="text-red-400 shrink-0">!</span>{r}</li>
                  ))}</ul>
                )}
                {e.next_actions?.length > 0 && (
                  <ul className="space-y-0.5">{e.next_actions.map((a, j) => (
                    <li key={j} className="text-xs text-blue-700 flex items-start gap-1"><span className="shrink-0">&#8594;</span>{a}</li>
                  ))}</ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Team Workload */}
      {expandedSection === "team" && report.team_workload?.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {report.team_workload.map((m, i) => {
            const ms = HEALTH_STYLES[m.health] || HEALTH_STYLES.ok;
            return (
              <div key={i} className={`rounded-lg border ${ms.border} ${ms.bg} p-4 space-y-2`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900">{m.name}</span>
                  <Badge health={m.health} />
                </div>
                <div className="flex gap-3 text-[10px] text-gray-500">
                  <span>{m.total} total</span>
                  <span className="text-blue-600">{m.in_progress} active</span>
                  <span className="text-green-600">{m.done} done</span>
                  {m.blocked > 0 && <span className="text-red-600">{m.blocked} blocked</span>}
                  {m.overdue > 0 && <span className="text-red-600">{m.overdue} overdue</span>}
                </div>
                <p className="text-xs text-gray-700">{m.summary}</p>
                {m.action_needed && (
                  <p className="text-xs text-blue-700"><span className="font-medium">Action:</span> {m.action_needed}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Communication Plan */}
      {expandedSection === "comms" && report.communication_plan?.length > 0 && (
        <div className="space-y-3">
          {report.communication_plan.map((msg, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  msg.urgency === "now" ? "bg-red-100 text-red-800" :
                  msg.urgency === "today" ? "bg-amber-100 text-amber-800" :
                  "bg-blue-100 text-blue-700"
                }`}>{msg.urgency}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600">{msg.channel}</span>
                <span className="text-xs font-medium text-gray-900">To: {msg.to}</span>
              </div>
              <p className="text-xs font-semibold text-gray-800">{msg.subject}</p>
              <div className="bg-gray-50 rounded border border-gray-200 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold uppercase text-gray-400">Message</span>
                  <CopyButton text={msg.message} />
                </div>
                <p className="text-xs text-gray-700 whitespace-pre-wrap font-mono">{msg.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Process Recommendations */}
      {expandedSection === "process" && report.process_recommendations?.length > 0 && (
        <div className="space-y-3">
          {report.process_recommendations.map((rec, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  rec.impact === "high" ? "bg-red-100 text-red-800" :
                  rec.impact === "medium" ? "bg-amber-100 text-amber-800" :
                  "bg-blue-100 text-blue-700"
                }`}>{rec.impact} impact</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600">{rec.category}</span>
              </div>
              <h4 className="text-sm font-semibold text-gray-900">{rec.title}</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase text-red-400 mb-0.5">Current State</p>
                  <p className="text-xs text-gray-700">{rec.current_state}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase text-green-600 mb-0.5">Recommended</p>
                  <p className="text-xs text-gray-700">{rec.recommended}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────

const STORAGE_KEY = "jira-dashboard-analysis-report";

export default function AnalyzePage() {
  const [jql, setJql] = useState(DEFAULT_JQL);
  const [inputJql, setInputJql] = useState(DEFAULT_JQL);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("prompt"); // prompt | paste | report
  const [copied, setCopied] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [report, setReport] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [missingInfoCriteria, setMissingInfoCriteria] = useState("");
  const [promptSettings, setPromptSettings] = useState({
    maxTickets: 100,
    maxPromptChars: 40000,
    includeDescriptions: true,
    includeComments: true,
    includeEstimates: true,
    includeDoneTickets: false,
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setMissingInfoCriteria(s.missingInfoCriteria || "");
        if (s.promptSettings) setPromptSettings((prev) => ({ ...prev, ...s.promptSettings }));
        setSettingsLoaded(true);
      })
      .catch(() => {});
  }, []);

  const loadData = useCallback(async (query) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchIssues(query);
      setData(result);
      toast.success(`Loaded ${result.total} issues for analysis`);
    } catch (err) {
      setError(err.message);
      toast.error("Failed to load issues: " + err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData(jql);
  }, [jql, loadData]);

  // Load saved report
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setReport(parsed);
        setPasteText(JSON.stringify(parsed, null, 2));
      }
    } catch {}
  }, []);

  const { prompt, promptStats } = useMemo(() => {
    if (!data) return { prompt: "", promptStats: null };
    const rawPrompt = buildAnalysisPrompt(data, missingInfoCriteria, promptSettings);
    const { prompt: finalPrompt, trimmed, charCount } = trimPrompt(rawPrompt, promptSettings.maxPromptChars);
    return {
      prompt: finalPrompt,
      promptStats: { charCount, trimmed, approxTokens: Math.round(charCount / 4) },
    };
  }, [data, missingInfoCriteria, promptSettings]);

  const promptWarnings = useMemo(() => {
    if (!data || !promptStats) return [];
    const warnings = [];
    // Compute ticket selection stats
    const allIssues = [
      ...(data.epics || []).flatMap((e) => e.issues.map((i) => ({ ...i, epicKey: e.key }))),
      ...(data.noEpic || []).map((i) => ({ ...i, epicKey: null })),
    ];
    const doneCount = allIssues.filter((t) => t.statusCategory === "done").length;
    const { stats: selStats } = selectTicketsForPrompt(allIssues, promptSettings);

    if (promptStats.trimmed) {
      warnings.push({ level: "critical", msg: `Prompt was trimmed to fit the ${promptSettings.maxPromptChars.toLocaleString()} char limit. Some ticket data was cut off. Increase "Max prompt chars" in Settings.` });
    }
    if (selStats.excluded > 0) {
      warnings.push({ level: "warning", msg: `${selStats.excluded} tickets excluded (limit: ${promptSettings.maxTickets}). The AI won't see these. Increase "Max tickets" in Settings if needed.` });
    }
    if (!promptSettings.includeDoneTickets && doneCount > 10) {
      warnings.push({ level: "info", msg: `${doneCount} done tickets excluded (only 10 sampled). Enable "Done tickets" in Settings for full cycle-time analysis.` });
    }
    if (!promptSettings.includeDescriptions) {
      warnings.push({ level: "warning", msg: `Descriptions are turned off. The AI will lack context about what each ticket is about. Enable in Settings > Prompt Control.` });
    }
    if (!promptSettings.includeComments) {
      warnings.push({ level: "info", msg: `Comments are turned off. The AI won't see discussion context. Enable in Settings > Prompt Control.` });
    }
    if (!settingsLoaded) {
      warnings.push({ level: "info", msg: `Using default prompt settings. Configure them in Settings > Prompt Control for better results.` });
    }
    return warnings;
  }, [data, promptStats, promptSettings, settingsLoaded]);

  const handleSearch = (e) => {
    e.preventDefault();
    setJql(inputJql);
  };

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleParse = () => {
    setParseError(null);
    try {
      const parsed = parseAIResponse(pasteText);
      setReport(parsed);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      setTab("report");
      toast.success("AI analysis complete");
    } catch (err) {
      setParseError(`Invalid JSON: ${err.message}`);
      toast.error("AI analysis failed");
    }
  };

  const handleClearReport = () => {
    setReport(null);
    setPasteText("");
    setParseError(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <h1 className="text-lg font-bold text-gray-900">Deep Analysis</h1>
              {data && <span className="text-xs text-gray-400">{data.total} issues loaded</span>}
            </div>
          </div>

          {/* JQL */}
          <JqlBar
            value={inputJql}
            onChange={setInputJql}
            onSubmit={(q) => setJql(q)}
          />

          {/* Jira saved filters */}
          <div className="mt-2">
            <FilterBar
              currentJql={jql}
              onApplyFilter={(newJql) => { setJql(newJql); setInputJql(newJql); }}
            />
          </div>

          {/* Workflow tabs */}
          <div className="flex items-center gap-1 mt-3">
            {[
              { key: "prompt", label: "1. Copy Prompt" },
              { key: "paste", label: "2. Paste AI Response" },
              { key: "report", label: "3. View Analysis", disabled: !report },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => !t.disabled && setTab(t.key)}
                disabled={t.disabled}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  tab === t.key
                    ? "bg-blue-600 text-white"
                    : t.disabled ? "text-gray-300 cursor-not-allowed" : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {t.label}
              </button>
            ))}
            {report && (
              <button onClick={handleClearReport} className="text-[10px] text-red-500 hover:text-red-700 ml-2">
                Clear report
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            <strong>Error:</strong> {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-blue-200 border-t-blue-600 rounded-full" />
          </div>
        )}

        {!loading && data && (
          <>
            {/* Quick stats bar */}
            <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
              {[
                { label: "Total", value: data.stats.total, color: "text-gray-900" },
                { label: "Done", value: data.stats.done, color: "text-green-600" },
                { label: "In Progress", value: data.stats.inProgress, color: "text-blue-600" },
                { label: "To Do", value: data.stats.todo, color: "text-gray-500" },
                { label: "Overdue", value: data.stats.overdue, color: "text-red-600" },
                { label: "Stale", value: data.stats.stale, color: "text-amber-600" },
                { label: "Unassigned", value: data.stats.unassigned, color: "text-gray-400" },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-lg border border-gray-200 px-3 py-2 text-center">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[9px] uppercase text-gray-400 font-medium">{s.label}</p>
                </div>
              ))}
            </div>

            {/* TAB: Prompt */}
            {tab === "prompt" && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                  <strong>Step 1:</strong> This prompt contains ALL your ticket data + analysis instructions.
                  Copy it and paste into your corporate AI chatbot. The AI will return a comprehensive board analysis as JSON.
                </div>

                {promptWarnings.length > 0 && (
                  <div className="space-y-1.5">
                    {promptWarnings.map((w, i) => (
                      <div key={i} className={`rounded-lg px-4 py-2.5 text-xs flex items-start gap-2 ${
                        w.level === "critical" ? "bg-red-50 border border-red-200 text-red-700" :
                        w.level === "warning" ? "bg-amber-50 border border-amber-200 text-amber-700" :
                        "bg-gray-50 border border-gray-200 text-gray-600"
                      }`}>
                        <span className="shrink-0 mt-0.5">{w.level === "critical" ? "\u26A0" : w.level === "warning" ? "\u26A0" : "\u2139"}</span>
                        <span>{w.msg}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium text-gray-300">Board Analysis Prompt</span>
                      <span className="text-[10px] text-gray-500">{prompt.length.toLocaleString()} chars</span>
                      <span className="text-[10px] text-gray-500">~{Math.ceil(prompt.length / 4).toLocaleString()} tokens</span>
                      {promptStats?.trimmed && (
                        <span className="text-[10px] text-amber-500 font-medium">trimmed</span>
                      )}
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
                  onClick={() => { handleCopy(prompt); setTimeout(() => setTab("paste"), 500); }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                >
                  Copy Prompt & Go to Step 2
                </button>
              </div>
            )}

            {/* TAB: Paste */}
            {tab === "paste" && (
              <div className="space-y-4">
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-sm text-purple-800">
                  <strong>Step 2:</strong> Paste the JSON response from your AI chatbot below. The dashboard will render the analysis.
                </div>

                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder='Paste the AI JSON response here...'
                  className="w-full h-80 text-xs font-mono bg-gray-50 border border-gray-200 rounded-xl p-4 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 resize-y"
                />

                {parseError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{parseError}</div>
                )}

                <button
                  onClick={handleParse}
                  disabled={!pasteText.trim()}
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  Parse & View Analysis
                </button>
              </div>
            )}

            {/* TAB: Report */}
            {tab === "report" && report && <AnalysisReport report={report} />}
          </>
        )}
      </main>
    </div>
  );
}
