"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchEpicDetail } from "../../../lib/api";
import ResizableTable from "../../../components/ResizableTable";
import IssueHoverCard from "../../../components/IssueHoverCard";

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || "http://localhost:9080";

// ─── Prompt builder (asks AI to return structured JSON) ──

function buildPrompt(epic, tickets, stats) {
  const today = new Date().toISOString().split("T")[0];
  const lines = [];

  lines.push("You are a project management assistant. Analyze the following Jira epic data and return a structured JSON report.");
  lines.push("IMPORTANT: Return ONLY valid JSON, no markdown, no explanation, no code fences. Just the raw JSON object.");
  lines.push("");
  lines.push(`# Epic: ${epic.key} — ${epic.summary || ""}`);
  lines.push(`Report date: ${today}`);
  lines.push("");

  // Epic overview
  lines.push("## Epic Overview");
  if (epic.status) lines.push(`- Status: ${epic.status}`);
  if (epic.assigneeName) lines.push(`- Owner: ${epic.assigneeName}`);
  if (epic.priority) lines.push(`- Priority: ${epic.priority}`);
  if (epic.dueDate) lines.push(`- Due Date: ${epic.dueDate}`);
  if (epic.labels?.length) lines.push(`- Labels: ${epic.labels.join(", ")}`);
  if (epic.description) lines.push(`- Description: ${epic.description.substring(0, 500)}`);
  lines.push("");

  // Progress
  lines.push("## Progress");
  lines.push(`- Total: ${stats.total}, Done: ${stats.done} (${stats.progress}%), In Progress: ${stats.inProgress}, To Do: ${stats.todo}`);
  lines.push("");

  // All tickets
  lines.push("## Tickets");
  for (const t of tickets) {
    lines.push("");
    lines.push(`### ${t.key} — ${t.summary}`);
    lines.push(`- Status: ${t.status} | Priority: ${t.priority || "Medium"} | Type: ${t.issueType || "Task"}`);
    lines.push(`- Assignee: ${t.assigneeName || "Unassigned"}`);
    if (t.dueDate) lines.push(`- Due: ${t.dueDate}`);
    if (t.labels?.length) lines.push(`- Labels: ${t.labels.join(", ")}`);
    lines.push(`- Created: ${t.created ? new Date(t.created).toISOString().split("T")[0] : "—"}`);
    lines.push(`- Last updated: ${t.updated ? new Date(t.updated).toISOString().split("T")[0] : "—"} (${t.daysSinceUpdate}d ago)`);
    if (t.originalEstimate || t.timeSpent) {
      lines.push(`- Time: estimated ${t.originalEstimate || "—"}, spent ${t.timeSpent || "—"}, remaining ${t.remainingEstimate || "—"}`);
    }
    if (t.urgencyFlags?.length) lines.push(`- Flags: ${t.urgencyFlags.map((f) => f.label).join(", ")}`);
    if (t.description) lines.push(`- Description: ${t.description.substring(0, 300)}`);
    if (t.blockers?.length) {
      lines.push(`- BLOCKERS: ${t.blockers.map((b) => `${b.key} (${b.summary}, status: ${b.status})`).join("; ")}`);
    }
    if (t.links?.length) {
      lines.push(`- Links: ${t.links.map((l) => `${l.direction} ${l.key} (${l.summary})`).join("; ")}`);
    }
    if (t.comments?.length) {
      lines.push(`- Comments (${t.commentCount} total, showing last ${Math.min(3, t.comments.length)}):`);
      for (const c of t.comments.slice(-3)) {
        const date = c.date ? new Date(c.date).toISOString().split("T")[0] : "";
        lines.push(`  [${date}] ${c.author}: ${c.body?.substring(0, 200) || ""}`);
      }
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("Analyze all the data above and return a single JSON object with this EXACT structure:");
  lines.push("");
  lines.push(`{
  "epic_summary": {
    "key": "${epic.key}",
    "title": "epic title",
    "health": "on_track | at_risk | critical",
    "health_reason": "one sentence why",
    "progress_pct": ${stats.progress},
    "total": ${stats.total},
    "done": ${stats.done},
    "in_progress": ${stats.inProgress},
    "todo": ${stats.todo},
    "executive_summary": "2-3 sentence summary of epic status, key achievements, and main concerns",
    "will_meet_deadline": true/false/null,
    "deadline_assessment": "sentence about deadline if applicable",
    "top_risks": ["risk 1", "risk 2", "risk 3"],
    "recommendations": ["action 1", "action 2", "action 3"]
  },
  "tickets": [
    {
      "key": "TICKET-1",
      "summary": "ticket title",
      "status": "To Do | In Progress | Done",
      "assignee": "name or Unassigned",
      "priority": "High/Medium/Low",
      "progress_pct": 0-100,
      "health": "on_track | at_risk | blocked | done",
      "comment_summary": "1-2 sentence summary of what recent comments say about progress",
      "last_comment_date": "YYYY-MM-DD or null",
      "last_comment_author": "name or null",
      "days_since_update": number,
      "days_blocked": number or 0,
      "blockers": ["blocker description"] or [],
      "flags": ["flag description"] or [],
      "next_action": "what should happen next on this ticket"
    }
  ],
  "team_workload": [
    {
      "name": "person name",
      "total": number,
      "done": number,
      "in_progress": number,
      "blocked": number,
      "health": "ok | overloaded | idle",
      "summary": "1 sentence about this person's status"
    }
  ]
}`);
  lines.push("");
  lines.push("Rules:");
  lines.push("- progress_pct for tickets: 0 for To Do, 100 for Done, estimate 10-90 for In Progress based on comments/time");
  lines.push("- days_blocked: estimate from comments/flags how long blocked, 0 if not blocked");
  lines.push("- comment_summary: summarize the KEY information from comments, focus on progress updates and issues");
  lines.push("- health for tickets: 'done' if done, 'blocked' if has blockers, 'at_risk' if overdue/stale, 'on_track' otherwise");
  lines.push("- team workload health: 'overloaded' if 5+ active tickets or 2+ blocked, 'idle' if 0 in progress, 'ok' otherwise");
  lines.push("- Return ONLY the JSON. No markdown fences. No explanation.");

  return lines.join("\n");
}

// ─── JSON parser for AI response ────────────────────────

function parseAIResponse(text) {
  let cleaned = text.trim();
  // Strip markdown code fences if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  cleaned = cleaned.trim();
  return JSON.parse(cleaned);
}

// ─── Report Renderer Components ─────────────────────────

const HEALTH_STYLES = {
  on_track: { bg: "bg-green-50", border: "border-green-200", text: "text-green-800", badge: "bg-green-100 text-green-800", dot: "bg-green-500" },
  at_risk: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", badge: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  critical: { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", badge: "bg-red-100 text-red-800", dot: "bg-red-500" },
  blocked: { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", badge: "bg-red-100 text-red-800", dot: "bg-red-500" },
  done: { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-600", badge: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
  ok: { bg: "bg-green-50", border: "border-green-200", text: "text-green-800", badge: "bg-green-100 text-green-800", dot: "bg-green-500" },
  overloaded: { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", badge: "bg-red-100 text-red-800", dot: "bg-red-500" },
  idle: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", badge: "bg-amber-100 text-amber-700", dot: "bg-amber-400" },
};

function HealthBadge({ health }) {
  const s = HEALTH_STYLES[health] || HEALTH_STYLES.on_track;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${s.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {health?.replace("_", " ")}
    </span>
  );
}

function MiniProgress({ pct }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 rounded-full h-1.5 w-16">
        <div
          className={`h-1.5 rounded-full ${pct === 100 ? "bg-green-500" : pct > 50 ? "bg-blue-500" : pct > 0 ? "bg-amber-500" : "bg-gray-300"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-gray-500 w-7 text-right">{pct}%</span>
    </div>
  );
}

function EpicSummaryCard({ data }) {
  const s = HEALTH_STYLES[data.health] || HEALTH_STYLES.on_track;
  return (
    <div className={`rounded-xl border-2 ${s.border} ${s.bg} p-5 space-y-4`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-gray-900">{data.key}</span>
            <HealthBadge health={data.health} />
          </div>
          <h2 className="text-base font-semibold text-gray-900">{data.title}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{data.health_reason}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-gray-900">{data.progress_pct}%</p>
          <p className="text-[10px] text-gray-500">{data.done}/{data.total} done</p>
        </div>
      </div>

      <div className="w-full bg-white/60 rounded-full h-3">
        <div
          className={`h-3 rounded-full transition-all ${data.progress_pct === 100 ? "bg-green-500" : data.progress_pct > 50 ? "bg-blue-500" : "bg-amber-500"}`}
          style={{ width: `${data.progress_pct}%` }}
        />
      </div>

      <p className="text-sm text-gray-800">{data.executive_summary}</p>

      {data.deadline_assessment && (
        <p className="text-xs text-gray-600">
          <span className="font-medium">Deadline:</span> {data.deadline_assessment}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {data.top_risks?.length > 0 && (
          <div>
            <h4 className="text-[10px] font-semibold uppercase text-red-600 mb-1.5">Top Risks</h4>
            <ul className="space-y-1">
              {data.top_risks.map((r, i) => (
                <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
                  <span className="text-red-400 mt-0.5 shrink-0">!</span>{r}
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.recommendations?.length > 0 && (
          <div>
            <h4 className="text-[10px] font-semibold uppercase text-blue-600 mb-1.5">Recommendations</h4>
            <ul className="space-y-1">
              {data.recommendations.map((r, i) => (
                <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
                  <span className="text-blue-400 mt-0.5 shrink-0">&#x2192;</span>{r}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

const TICKET_SORT_FN = (a, b, key) => {
  if (key === "ticket") return (a.key || "").localeCompare(b.key || "");
  if (key === "assignee") return (a.assignee || "zzz").localeCompare(b.assignee || "zzz");
  if (key === "status") {
    const order = { Done: 2, "In Progress": 1 };
    return (order[a.status] ?? 0) - (order[b.status] ?? 0);
  }
  if (key === "health") {
    const order = { blocked: 0, at_risk: 1, needs_attention: 2, on_track: 3 };
    return (order[a.health] ?? 3) - (order[b.health] ?? 3);
  }
  if (key === "progress") return (a.progress_pct || 0) - (b.progress_pct || 0);
  if (key === "lastUpdate") return (a.days_since_update || 0) - (b.days_since_update || 0);
  if (key === "blocked") return (a.days_blocked || 0) - (b.days_blocked || 0);
  return String(a[key] || "").localeCompare(String(b[key] || ""));
};

const TICKET_TABLE_COLUMNS = [
  {
    key: "ticket", label: "Ticket", sortable: true, defaultWidth: 200, minWidth: 120,
    render: (row) => (
      <div>
        <IssueHoverCard issue={{
          ...row,
          assigneeName: row.assignee,
          statusCategory: row.status === "Done" ? "done" : row.status === "In Progress" ? "indeterminate" : "new",
        }} jiraBaseUrl={JIRA_BASE_URL}>
          <a href={`${JIRA_BASE_URL}/browse/${row.key}`} target="_blank" rel="noopener noreferrer" className="font-bold text-blue-700 hover:underline">{row.key}</a>
        </IssueHoverCard>
        <div className="text-gray-600 truncate">{row.summary}</div>
      </div>
    ),
  },
  {
    key: "assignee", label: "Assignee", sortable: true, defaultWidth: 110, minWidth: 80,
    className: "text-gray-700",
    render: (row) => row.assignee || "—",
  },
  {
    key: "status", label: "Status", sortable: true, defaultWidth: 100, minWidth: 70,
    render: (row) => (
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
        row.status === "Done" ? "bg-green-100 text-green-800"
        : row.status === "In Progress" ? "bg-blue-100 text-blue-800"
        : "bg-gray-100 text-gray-700"
      }`}>{row.status}</span>
    ),
  },
  {
    key: "health", label: "Health", sortable: true, defaultWidth: 90, minWidth: 70,
    render: (row) => <HealthBadge health={row.health} />,
  },
  {
    key: "progress", label: "Progress", sortable: true, defaultWidth: 100, minWidth: 70,
    render: (row) => <MiniProgress pct={row.progress_pct || 0} />,
  },
  {
    key: "lastUpdate", label: "Last Update", sortable: true, defaultWidth: 90, minWidth: 70,
    className: "text-gray-500",
    render: (row) => `${row.days_since_update}d ago`,
  },
  {
    key: "blocked", label: "Blocked", sortable: true, defaultWidth: 70, minWidth: 50,
    render: (row) => row.days_blocked > 0 ? (
      <span className="text-red-700 font-medium">{row.days_blocked}d</span>
    ) : (
      <span className="text-gray-400">—</span>
    ),
  },
  {
    key: "nextAction", label: "Next Action", sortable: false, defaultWidth: 200, minWidth: 100,
    className: "text-gray-700 truncate",
    render: (row) => row.next_action || "—",
  },
];

function TicketTable({ tickets }) {
  return (
    <ResizableTable
      columns={TICKET_TABLE_COLUMNS}
      data={tickets}
      getRowKey={(row, i) => row.key || i}
      rowClassName={(row) => {
        const s = HEALTH_STYLES[row.health] || HEALTH_STYLES.on_track;
        return `${s.bg} hover:brightness-95 transition-all`;
      }}
      defaultSort={{ key: "health", dir: "asc" }}
      sortFn={TICKET_SORT_FN}
      emptyMessage="No tickets"
    />
  );
}

function TicketDetailCards({ tickets }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {tickets.map((t, i) => {
        const s = HEALTH_STYLES[t.health] || HEALTH_STYLES.on_track;
        return (
          <div key={i} className={`rounded-lg border ${s.border} ${s.bg} p-3 space-y-2`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-blue-700">{t.key}</span>
                <HealthBadge health={t.health} />
              </div>
              <MiniProgress pct={t.progress_pct || 0} />
            </div>
            <p className="text-sm font-medium text-gray-900">{t.summary}</p>
            <div className="flex items-center gap-3 text-[10px] text-gray-500">
              <span>{t.assignee || "Unassigned"}</span>
              <span>{t.priority}</span>
              <span>Updated {t.days_since_update}d ago</span>
              {t.days_blocked > 0 && <span className="text-red-600 font-medium">Blocked {t.days_blocked}d</span>}
            </div>
            {t.comment_summary && (
              <div className="bg-white/60 rounded px-2 py-1.5">
                <p className="text-[10px] text-gray-400 font-medium uppercase mb-0.5">
                  Comments {t.last_comment_date && `(latest: ${t.last_comment_date} by ${t.last_comment_author || "—"})`}
                </p>
                <p className="text-xs text-gray-700">{t.comment_summary}</p>
              </div>
            )}
            {t.blockers?.length > 0 && (
              <div className="space-y-0.5">
                {t.blockers.map((b, j) => (
                  <p key={j} className="text-xs text-red-700 flex items-start gap-1">
                    <span className="shrink-0">!</span>{b}
                  </p>
                ))}
              </div>
            )}
            {t.flags?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {t.flags.map((f, j) => (
                  <span key={j} className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">{f}</span>
                ))}
              </div>
            )}
            {t.next_action && (
              <p className="text-xs text-blue-700">
                <span className="font-medium">Next:</span> {t.next_action}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TeamWorkload({ team }) {
  if (!team?.length) return null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <h3 className="text-xs font-semibold text-gray-700 uppercase">Team Workload</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0">
        {team.map((m, i) => {
          const s = HEALTH_STYLES[m.health] || HEALTH_STYLES.ok;
          return (
            <div key={i} className={`p-3 border-b border-r border-gray-100 ${s.bg}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-gray-900">{m.name}</span>
                <HealthBadge health={m.health} />
              </div>
              <div className="flex items-center gap-3 text-[10px] text-gray-500 mb-1.5">
                <span>{m.total} total</span>
                <span className="text-blue-600">{m.in_progress} active</span>
                <span className="text-green-600">{m.done} done</span>
                {m.blocked > 0 && <span className="text-red-600">{m.blocked} blocked</span>}
              </div>
              <p className="text-xs text-gray-700">{m.summary}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReportRenderer({ report }) {
  const [view, setView] = useState("table");
  return (
    <div className="space-y-6">
      {/* Epic summary */}
      {report.epic_summary && <EpicSummaryCard data={report.epic_summary} />}

      {/* Team workload */}
      {report.team_workload && <TeamWorkload team={report.team_workload} />}

      {/* Ticket view toggle */}
      {report.tickets?.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Tickets ({report.tickets.length})</h3>
            <div className="flex gap-1">
              <button
                onClick={() => setView("table")}
                className={`text-[10px] px-2.5 py-1 rounded ${view === "table" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}
              >Table</button>
              <button
                onClick={() => setView("cards")}
                className={`text-[10px] px-2.5 py-1 rounded ${view === "cards" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}
              >Cards</button>
            </div>
          </div>
          {view === "table" ? (
            <TicketTable tickets={report.tickets} />
          ) : (
            <TicketDetailCards tickets={report.tickets} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Raw ticket components (from Jira data) ─────────────

const SEVERITY_COLORS = {
  critical: "bg-red-100 text-red-800",
  warning: "bg-amber-100 text-amber-800",
  info: "bg-blue-100 text-blue-800",
};

const STATUS_COLORS = {
  done: "bg-green-100 text-green-800",
  indeterminate: "bg-blue-100 text-blue-800",
  new: "bg-gray-100 text-gray-700",
};

function Badge({ children, color }) {
  return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${color}`}>{children}</span>;
}

function ProgressBar({ progress }) {
  return (
    <div className="w-full bg-gray-200 rounded-full h-2.5">
      <div
        className={`h-2.5 rounded-full transition-all ${progress === 100 ? "bg-green-500" : progress > 50 ? "bg-blue-500" : "bg-amber-500"}`}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

function RawTicketRow({ ticket }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        <span className="text-xs font-bold text-blue-600 shrink-0 w-20">{ticket.key}</span>
        <span className="text-sm text-gray-900 flex-1 truncate">{ticket.summary}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {ticket.urgencyFlags?.map((f, i) => (
            <Badge key={i} color={SEVERITY_COLORS[f.severity] || SEVERITY_COLORS.info}>{f.label}</Badge>
          ))}
        </div>
        <Badge color={STATUS_COLORS[ticket.statusCategory] || STATUS_COLORS.new}>{ticket.status}</Badge>
        <span className="text-xs text-gray-500 w-20 text-right shrink-0">{ticket.assigneeName || "—"}</span>
        <svg className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-2 text-sm bg-gray-50/50">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div><span className="text-[10px] uppercase text-gray-400 font-medium">Priority</span><p className="text-gray-800">{ticket.priority || "—"}</p></div>
            <div><span className="text-[10px] uppercase text-gray-400 font-medium">Due Date</span><p className="text-gray-800">{ticket.dueDate || "—"}</p></div>
            <div><span className="text-[10px] uppercase text-gray-400 font-medium">Type</span><p className="text-gray-800">{ticket.issueType || "—"}</p></div>
            <div><span className="text-[10px] uppercase text-gray-400 font-medium">Updated</span><p className="text-gray-800">{ticket.daysSinceUpdate}d ago</p></div>
          </div>
          {ticket.description && (
            <div><span className="text-[10px] uppercase text-gray-400 font-medium">Description</span><p className="text-gray-700 text-xs mt-1 whitespace-pre-line line-clamp-4">{ticket.description}</p></div>
          )}
          {ticket.comments?.length > 0 && (
            <div>
              <span className="text-[10px] uppercase text-gray-400 font-medium">Comments ({ticket.commentCount})</span>
              <div className="space-y-1.5 mt-1">
                {ticket.comments.slice(-3).map((c, i) => (
                  <div key={i} className="bg-white rounded border border-gray-100 px-3 py-1.5 text-xs">
                    <span className="font-medium text-gray-600">{c.author}</span>
                    <span className="text-gray-400 ml-2">{c.date ? new Date(c.date).toLocaleDateString() : ""}</span>
                    <p className="text-gray-700 mt-0.5 line-clamp-2">{c.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────

export default function EpicDetailPage() {
  const params = useParams();
  const epicKey = params.key;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("data"); // data | prompt | report
  const [pasteText, setPasteText] = useState("");
  const [report, setReport] = useState(null);
  const [parseError, setParseError] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchEpicDetail(epicKey);
        setData(result);
      } catch (err) {
        setError(err.message);
      }
      setLoading(false);
    }
    load();
  }, [epicKey]);

  // Load saved report from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`report_${epicKey}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        setReport(parsed);
        setPasteText(JSON.stringify(parsed, null, 2));
      }
    } catch {}
  }, [epicKey]);

  const prompt = useMemo(() => {
    if (!data) return "";
    return buildPrompt(data.epic, data.tickets, data.stats);
  }, [data]);

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleParse = () => {
    setParseError(null);
    try {
      const parsed = parseAIResponse(pasteText);
      setReport(parsed);
      localStorage.setItem(`report_${epicKey}`, JSON.stringify(parsed));
      setTab("report");
    } catch (err) {
      setParseError(`Invalid JSON: ${err.message}`);
    }
  };

  const handleClearReport = () => {
    setReport(null);
    setPasteText("");
    setParseError(null);
    localStorage.removeItem(`report_${epicKey}`);
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-lg font-bold text-gray-900">
                  {data?.epic?.key || epicKey}
                  {data?.epic?.summary && <span className="font-normal text-gray-500 ml-2">— {data.epic.summary}</span>}
                </h1>
              </div>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-1 mt-3">
            {[
              { key: "data", label: "Jira Data" },
              { key: "prompt", label: "1. Copy Prompt" },
              { key: "paste", label: "2. Paste Response" },
              { key: "report", label: "3. View Report", disabled: !report },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => !t.disabled && setTab(t.key)}
                disabled={t.disabled}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  tab === t.key
                    ? "bg-blue-600 text-white"
                    : t.disabled
                      ? "text-gray-300 cursor-not-allowed"
                      : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {t.label}
              </button>
            ))}
            {report && (
              <button
                onClick={handleClearReport}
                className="text-[10px] text-red-500 hover:text-red-700 ml-2"
              >
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
            {/* ─── TAB: Raw Jira data ─── */}
            {tab === "data" && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-gray-900">{data.stats.total}</p>
                    <p className="text-[10px] uppercase text-gray-400 font-medium">Total</p>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-green-600">{data.stats.done}</p>
                    <p className="text-[10px] uppercase text-gray-400 font-medium">Done</p>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-blue-600">{data.stats.inProgress}</p>
                    <p className="text-[10px] uppercase text-gray-400 font-medium">In Progress</p>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-gray-500">{data.stats.todo}</p>
                    <p className="text-[10px] uppercase text-gray-400 font-medium">To Do</p>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
                    <p className="text-2xl font-bold text-gray-900 text-center">{data.stats.progress}%</p>
                    <ProgressBar progress={data.stats.progress} />
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-semibold text-gray-900 mb-3">All Tickets ({data.tickets.length})</h2>
                  <div className="space-y-2">
                    {data.tickets.map((ticket) => (
                      <RawTicketRow key={ticket.key} ticket={ticket} />
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ─── TAB: Prompt ─── */}
            {tab === "prompt" && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                  <strong>Step 1:</strong> Copy this prompt and paste it into your corporate AI chatbot.
                  The AI will analyze all ticket data and return structured JSON.
                </div>

                <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
                    <span className="text-xs font-medium text-gray-300">AI Prompt — paste into your chatbot</span>
                    <button
                      onClick={() => handleCopy(prompt)}
                      className={`text-xs px-3 py-1 rounded transition-all ${
                        copied ? "bg-green-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-gray-200"
                      }`}
                    >
                      {copied ? "Copied!" : "Copy to clipboard"}
                    </button>
                  </div>
                  <pre className="p-4 text-xs text-gray-300 font-mono overflow-auto max-h-[600px] whitespace-pre-wrap leading-relaxed">
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

            {/* ─── TAB: Paste response ─── */}
            {tab === "paste" && (
              <div className="space-y-4">
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-sm text-purple-800">
                  <strong>Step 2:</strong> Paste the JSON response from your AI chatbot below, then click "Parse & View Report".
                </div>

                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder='Paste the AI JSON response here...\n\n{\n  "epic_summary": { ... },\n  "tickets": [ ... ],\n  "team_workload": [ ... ]\n}'
                  className="w-full h-80 text-xs font-mono bg-gray-50 border border-gray-200 rounded-xl p-4 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 resize-y"
                />

                {parseError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                    {parseError}
                  </div>
                )}

                <button
                  onClick={handleParse}
                  disabled={!pasteText.trim()}
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  Parse & View Report
                </button>
              </div>
            )}

            {/* ─── TAB: Report ─── */}
            {tab === "report" && report && (
              <ReportRenderer report={report} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
