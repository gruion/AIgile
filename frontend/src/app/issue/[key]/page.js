"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchIssueDetail } from "../../../lib/api";
import IssueHoverCard from "../../../components/IssueHoverCard";
import { useAppConfig } from "../../../context/AppConfigContext";

// ─── Prompt builder ──────────────────────────────────────

function buildPrompt(issue) {
  const today = new Date().toISOString().split("T")[0];
  const lines = [];

  lines.push("You are a project management assistant. Analyze the following Jira issue data and return a structured JSON report.");
  lines.push("IMPORTANT: Return ONLY valid JSON, no markdown, no explanation, no code fences. Just the raw JSON object.");
  lines.push("");
  lines.push(`# Issue: ${issue.key} — ${issue.summary}`);
  lines.push(`Report date: ${today}`);
  lines.push("");

  // Issue details
  lines.push("## Issue Details");
  lines.push(`- Status: ${issue.status} (${issue.statusCategory})`);
  lines.push(`- Type: ${issue.issueType || "Task"}`);
  lines.push(`- Priority: ${issue.priority || "Medium"}`);
  lines.push(`- Assignee: ${issue.assigneeName || "Unassigned"}`);
  if (issue.dueDate) lines.push(`- Due Date: ${issue.dueDate}`);
  if (issue.labels?.length) lines.push(`- Labels: ${issue.labels.join(", ")}`);
  lines.push(`- Created: ${issue.created ? new Date(issue.created).toISOString().split("T")[0] : "—"}`);
  lines.push(`- Last Updated: ${issue.updated ? new Date(issue.updated).toISOString().split("T")[0] : "—"} (${issue.daysSinceUpdate}d ago)`);
  if (issue.parentKey) lines.push(`- Parent Epic: ${issue.parentKey} — ${issue.parentSummary || ""}`);
  lines.push("");

  // Time tracking
  if (issue.originalEstimate || issue.timeSpent) {
    lines.push("## Time Tracking");
    lines.push(`- Estimated: ${issue.originalEstimate || "—"}`);
    lines.push(`- Spent: ${issue.timeSpent || "—"}`);
    lines.push(`- Remaining: ${issue.remainingEstimate || "—"}`);
    lines.push("");
  }

  // Description
  if (issue.description) {
    lines.push("## Description");
    lines.push(issue.description.substring(0, 2000));
    lines.push("");
  }

  // Links & blockers
  if (issue.links?.length) {
    lines.push("## Linked Issues");
    for (const l of issue.links) {
      lines.push(`- ${l.direction} ${l.key} (${l.summary}) — Status: ${l.status}`);
    }
    lines.push("");
  }

  if (issue.blockers?.length) {
    lines.push("## BLOCKERS");
    for (const b of issue.blockers) {
      lines.push(`- ${b.key}: ${b.summary} (Status: ${b.status})`);
    }
    lines.push("");
  }

  // Subtasks
  if (issue.subtasks?.length) {
    lines.push("## Subtasks");
    for (const s of issue.subtasks) {
      lines.push(`- ${s.key}: ${s.summary} — ${s.status}`);
    }
    lines.push("");
  }

  // Changelog (last 20 entries)
  if (issue.changelog?.length) {
    lines.push("## Recent Changes (changelog)");
    for (const c of issue.changelog.slice(-20)) {
      const date = c.date ? new Date(c.date).toISOString().split("T")[0] : "";
      lines.push(`- [${date}] ${c.field}: "${c.from || "—"}" -> "${c.to || "—"}" by ${c.author}`);
    }
    lines.push("");
  }

  // Comments
  if (issue.comments?.length) {
    lines.push(`## Comments (${issue.commentCount} total, showing last ${Math.min(10, issue.comments.length)})`);
    for (const c of issue.comments.slice(-10)) {
      const date = c.date ? new Date(c.date).toISOString().split("T")[0] : "";
      lines.push(`[${date}] ${c.author}: ${c.body?.substring(0, 300) || ""}`);
      lines.push("");
    }
  }

  // Urgency flags
  if (issue.urgencyFlags?.length) {
    lines.push("## Urgency Flags");
    for (const f of issue.urgencyFlags) {
      lines.push(`- [${f.severity}] ${f.label}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("Analyze all the data above and return a single JSON object with this EXACT structure:");
  lines.push("");
  lines.push(`{
  "issue_summary": {
    "key": "${issue.key}",
    "title": "issue title",
    "health": "on_track | at_risk | blocked | done",
    "health_reason": "one sentence explaining the health assessment",
    "progress_pct": 0-100,
    "executive_summary": "2-3 sentence summary of the issue's current state, what has been done, and what remains"
  },
  "timeline": {
    "created": "YYYY-MM-DD",
    "last_activity": "YYYY-MM-DD",
    "days_active": number,
    "days_since_update": number,
    "estimated_completion": "YYYY-MM-DD or null",
    "is_overdue": true/false,
    "velocity_assessment": "ahead | on_track | behind | stalled"
  },
  "work_done": [
    "bullet point describing completed work based on changelog and comments"
  ],
  "work_remaining": [
    "bullet point describing what still needs to be done"
  ],
  "blockers": [
    {
      "description": "what is blocking",
      "severity": "critical | warning",
      "suggested_action": "how to unblock"
    }
  ],
  "risks": [
    {
      "description": "risk description",
      "likelihood": "high | medium | low",
      "impact": "high | medium | low",
      "mitigation": "suggested mitigation"
    }
  ],
  "comment_summary": "2-3 sentence summary of what the comments reveal about progress, decisions, and issues",
  "next_steps": [
    {
      "action": "what needs to happen next",
      "owner": "who should do it",
      "urgency": "immediate | soon | later",
      "reason": "why this action"
    }
  ],
  "recommendations": [
    "actionable recommendation based on the analysis"
  ]
}`);
  lines.push("");
  lines.push("Rules:");
  lines.push("- progress_pct: 0 for To Do, 100 for Done, estimate 10-90 for In Progress based on comments/changelog");
  lines.push("- Infer work done from changelog status transitions, comments mentioning completions");
  lines.push("- Infer work remaining from description, acceptance criteria, comments mentioning pending items");
  lines.push("- health: 'done' if resolved, 'blocked' if has blockers, 'at_risk' if overdue/stale, 'on_track' otherwise");
  lines.push("- Return ONLY the JSON. No markdown fences. No explanation.");

  return lines.join("\n");
}

// ─── JSON parser ─────────────────────────────────────────

function parseAIResponse(text) {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(cleaned.trim());
}

// ─── Report renderer components ──────────────────────────

const HEALTH_STYLES = {
  on_track: { bg: "bg-green-50", border: "border-green-200", text: "text-green-800", badge: "bg-green-100 text-green-800", dot: "bg-green-500" },
  at_risk: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", badge: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  blocked: { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", badge: "bg-red-100 text-red-800", dot: "bg-red-500" },
  critical: { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", badge: "bg-red-100 text-red-800", dot: "bg-red-500" },
  done: { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-600", badge: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
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
      <div className="flex-1 bg-gray-200 rounded-full h-2 w-24">
        <div
          className={`h-2 rounded-full ${pct === 100 ? "bg-green-500" : pct > 50 ? "bg-blue-500" : pct > 0 ? "bg-amber-500" : "bg-gray-300"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
    </div>
  );
}

function ReportRenderer({ report, issueKey }) {
  const summary = report.issue_summary;
  const timeline = report.timeline;
  const s = HEALTH_STYLES[summary?.health] || HEALTH_STYLES.on_track;

  return (
    <div className="space-y-5">
      {/* Health card */}
      {summary && (
        <div className={`rounded-xl border-2 ${s.border} ${s.bg} p-5 space-y-3`}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-bold text-gray-900">{summary.key}</span>
                <HealthBadge health={summary.health} />
              </div>
              <h2 className="text-base font-semibold text-gray-900">{summary.title}</h2>
              <p className="text-xs text-gray-500 mt-0.5">{summary.health_reason}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-3xl font-bold text-gray-900">{summary.progress_pct}%</p>
              <MiniProgress pct={summary.progress_pct || 0} />
            </div>
          </div>
          <p className="text-sm text-gray-800">{summary.executive_summary}</p>
        </div>
      )}

      {/* Timeline */}
      {timeline && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-xs font-semibold uppercase text-gray-500 mb-3">Timeline</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-lg font-bold text-gray-900">{timeline.days_active || 0}d</p>
              <p className="text-[10px] text-gray-400">Active</p>
            </div>
            <div>
              <p className={`text-lg font-bold ${timeline.days_since_update > 7 ? "text-red-600" : "text-gray-900"}`}>{timeline.days_since_update || 0}d</p>
              <p className="text-[10px] text-gray-400">Since Update</p>
            </div>
            <div>
              <p className={`text-lg font-bold ${timeline.velocity_assessment === "stalled" ? "text-red-600" : timeline.velocity_assessment === "behind" ? "text-amber-600" : "text-green-600"}`}>
                {timeline.velocity_assessment || "—"}
              </p>
              <p className="text-[10px] text-gray-400">Velocity</p>
            </div>
            <div>
              <p className={`text-lg font-bold ${timeline.is_overdue ? "text-red-600" : "text-gray-900"}`}>
                {timeline.estimated_completion || "—"}
              </p>
              <p className="text-[10px] text-gray-400">Est. Completion</p>
            </div>
          </div>
        </div>
      )}

      {/* Work done / remaining */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {report.work_done?.length > 0 && (
          <div className="bg-white rounded-xl border border-green-200 p-4">
            <h3 className="text-xs font-semibold uppercase text-green-600 mb-2">Work Done</h3>
            <ul className="space-y-1.5">
              {report.work_done.map((w, i) => (
                <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
                  <span className="text-green-500 mt-0.5 shrink-0">&#x2713;</span>{w}
                </li>
              ))}
            </ul>
          </div>
        )}
        {report.work_remaining?.length > 0 && (
          <div className="bg-white rounded-xl border border-blue-200 p-4">
            <h3 className="text-xs font-semibold uppercase text-blue-600 mb-2">Work Remaining</h3>
            <ul className="space-y-1.5">
              {report.work_remaining.map((w, i) => (
                <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
                  <span className="text-blue-500 mt-0.5 shrink-0">&#x25CB;</span>{w}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Blockers */}
      {report.blockers?.length > 0 && (
        <div className="bg-white rounded-xl border border-red-200 p-4">
          <h3 className="text-xs font-semibold uppercase text-red-600 mb-2">Blockers</h3>
          <div className="space-y-2">
            {report.blockers.map((b, i) => (
              <div key={i} className="bg-red-50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${b.severity === "critical" ? "bg-red-200 text-red-800" : "bg-amber-200 text-amber-800"}`}>{b.severity}</span>
                  <span className="text-xs font-medium text-gray-900">{b.description}</span>
                </div>
                <p className="text-xs text-gray-600 ml-1">Action: {b.suggested_action}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risks */}
      {report.risks?.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 p-4">
          <h3 className="text-xs font-semibold uppercase text-amber-600 mb-2">Risks</h3>
          <div className="space-y-2">
            {report.risks.map((r, i) => (
              <div key={i} className="bg-amber-50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-200 text-amber-800">L:{r.likelihood} I:{r.impact}</span>
                  <span className="text-xs font-medium text-gray-900">{r.description}</span>
                </div>
                <p className="text-xs text-gray-600 ml-1">Mitigation: {r.mitigation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Comment summary */}
      {report.comment_summary && (
        <div className="bg-white rounded-xl border border-indigo-200 p-4">
          <h3 className="text-xs font-semibold uppercase text-indigo-600 mb-2">Comment Summary</h3>
          <p className="text-sm text-gray-700">{report.comment_summary}</p>
        </div>
      )}

      {/* Next steps */}
      {report.next_steps?.length > 0 && (
        <div className="bg-white rounded-xl border border-blue-200 p-4">
          <h3 className="text-xs font-semibold uppercase text-blue-600 mb-2">Next Steps</h3>
          <div className="space-y-2">
            {report.next_steps.map((s, i) => (
              <div key={i} className="flex items-start gap-3 text-xs">
                <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                  s.urgency === "immediate" ? "bg-red-100 text-red-700" : s.urgency === "soon" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
                }`}>{s.urgency}</span>
                <div>
                  <p className="text-gray-900 font-medium">{s.action}</p>
                  <p className="text-gray-500">Owner: {s.owner} — {s.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {report.recommendations?.length > 0 && (
        <div className="bg-white rounded-xl border border-purple-200 p-4">
          <h3 className="text-xs font-semibold uppercase text-purple-600 mb-2">Recommendations</h3>
          <ul className="space-y-1.5">
            {report.recommendations.map((r, i) => (
              <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
                <span className="text-purple-400 mt-0.5 shrink-0">&#x2192;</span>{r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Raw issue detail components ─────────────────────────

const STATUS_COLORS = {
  done: "bg-green-100 text-green-800",
  indeterminate: "bg-blue-100 text-blue-800",
  new: "bg-gray-100 text-gray-700",
};

const SEVERITY_COLORS = {
  critical: "bg-red-100 text-red-800",
  warning: "bg-amber-100 text-amber-800",
  info: "bg-blue-100 text-blue-800",
};

function Badge({ children, color }) {
  return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${color}`}>{children}</span>;
}

function RawIssueDetail({ issue, jiraBaseUrl }) {
  return (
    <div className="space-y-5">
      {/* Key info grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
          <p className="text-[10px] uppercase text-gray-400 font-medium">Status</p>
          <Badge color={STATUS_COLORS[issue.statusCategory] || STATUS_COLORS.new}>{issue.status}</Badge>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
          <p className="text-[10px] uppercase text-gray-400 font-medium">Priority</p>
          <p className="text-sm font-medium text-gray-900">{issue.priority || "—"}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
          <p className="text-[10px] uppercase text-gray-400 font-medium">Assignee</p>
          <p className="text-sm font-medium text-gray-900">{issue.assigneeName || "Unassigned"}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
          <p className="text-[10px] uppercase text-gray-400 font-medium">Due Date</p>
          <p className={`text-sm font-medium ${issue.dueDate && new Date(issue.dueDate) < new Date() ? "text-red-600" : "text-gray-900"}`}>{issue.dueDate || "—"}</p>
        </div>
      </div>

      {/* Flags */}
      {issue.urgencyFlags?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {issue.urgencyFlags.map((f, i) => (
            <Badge key={i} color={SEVERITY_COLORS[f.severity] || SEVERITY_COLORS.info}>{f.label}</Badge>
          ))}
        </div>
      )}

      {/* Time tracking */}
      {(issue.originalEstimate || issue.timeSpent) && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-xs font-semibold text-gray-700 mb-2">Time Tracking</h3>
          <div className="grid grid-cols-3 gap-3 text-center text-xs">
            <div><p className="font-medium text-gray-900">{issue.originalEstimate || "—"}</p><p className="text-[10px] text-gray-400">Estimated</p></div>
            <div><p className="font-medium text-gray-900">{issue.timeSpent || "—"}</p><p className="text-[10px] text-gray-400">Spent</p></div>
            <div><p className="font-medium text-gray-900">{issue.remainingEstimate || "—"}</p><p className="text-[10px] text-gray-400">Remaining</p></div>
          </div>
        </div>
      )}

      {/* Description */}
      {issue.description && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-xs font-semibold text-gray-700 mb-2">Description</h3>
          <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{issue.description.substring(0, 3000)}</p>
        </div>
      )}

      {/* Parent */}
      {issue.parentKey && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-xs font-semibold text-gray-700 mb-2">Parent Epic</h3>
          <div className="flex items-center gap-2">
            <Link href={`/epic/${issue.parentKey}`} className="text-xs font-mono font-bold text-blue-600 hover:underline">{issue.parentKey}</Link>
            <span className="text-sm text-gray-700">{issue.parentSummary}</span>
          </div>
        </div>
      )}

      {/* Links */}
      {issue.links?.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-xs font-semibold text-gray-700 mb-2">Linked Issues ({issue.links.length})</h3>
          <div className="space-y-1.5">
            {issue.links.map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-gray-400 w-24 shrink-0">{l.direction}</span>
                <a href={`${jiraBaseUrl}/browse/${l.key}`} target="_blank" rel="noopener noreferrer" className="font-mono font-bold text-blue-600 hover:underline">{l.key}</a>
                <span className="text-gray-700 flex-1 truncate">{l.summary}</span>
                <Badge color={STATUS_COLORS[l.status === "Done" ? "done" : "new"]}>{l.status}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subtasks */}
      {issue.subtasks?.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-xs font-semibold text-gray-700 mb-2">Subtasks ({issue.subtasks.length})</h3>
          <div className="space-y-1.5">
            {issue.subtasks.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <a href={`${jiraBaseUrl}/browse/${s.key}`} target="_blank" rel="noopener noreferrer" className="font-mono font-bold text-blue-600 hover:underline w-20 shrink-0">{s.key}</a>
                <span className="text-gray-700 flex-1 truncate">{s.summary}</span>
                <Badge color={STATUS_COLORS[s.statusCategory] || STATUS_COLORS.new}>{s.status}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Changelog */}
      {issue.changelog?.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-xs font-semibold text-gray-700 mb-2">Changelog ({issue.changelog.length})</h3>
          <div className="space-y-1 max-h-60 overflow-auto">
            {issue.changelog.slice().reverse().map((c, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] py-0.5">
                <span className="text-gray-400 w-20 shrink-0">{c.date ? new Date(c.date).toLocaleDateString() : ""}</span>
                <span className="text-gray-500 w-16 shrink-0">{c.field}</span>
                <span className="text-gray-600 flex-1 truncate">
                  <span className="text-red-500 line-through">{c.from || "—"}</span>
                  {" → "}
                  <span className="text-green-700 font-medium">{c.to || "—"}</span>
                </span>
                <span className="text-gray-400 shrink-0">{c.author}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Comments */}
      {issue.comments?.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-xs font-semibold text-gray-700 mb-2">Comments ({issue.commentCount})</h3>
          <div className="space-y-2">
            {issue.comments.slice().reverse().map((c, i) => (
              <div key={i} className="bg-gray-50 rounded border border-gray-100 px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-gray-700">{c.author}</span>
                  <span className="text-[10px] text-gray-400">{c.date ? new Date(c.date).toLocaleDateString() : ""}</span>
                </div>
                <p className="text-xs text-gray-700 whitespace-pre-wrap line-clamp-4">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────

export default function IssueDetailPage() {
  const { defaultJql, jiraBaseUrl } = useAppConfig();
  const params = useParams();
  const issueKey = params.key;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("data");
  const [pasteText, setPasteText] = useState("");
  const [report, setReport] = useState(null);
  const [parseError, setParseError] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchIssueDetail(issueKey);
        setData(result);
      } catch (err) {
        setError(err.message);
      }
      setLoading(false);
    }
    load();
  }, [issueKey]);

  // Load saved report
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`issue_report_${issueKey}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        setReport(parsed);
        setPasteText(JSON.stringify(parsed, null, 2));
      }
    } catch {}
  }, [issueKey]);

  const prompt = useMemo(() => {
    if (!data?.issue) return "";
    return buildPrompt(data.issue);
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
      localStorage.setItem(`issue_report_${issueKey}`, JSON.stringify(parsed));
      setTab("report");
    } catch (err) {
      setParseError(`Invalid JSON: ${err.message}`);
    }
  };

  const handleClearReport = () => {
    setReport(null);
    setPasteText("");
    setParseError(null);
    localStorage.removeItem(`issue_report_${issueKey}`);
  };

  const issue = data?.issue;

  return (
    <div className="min-h-screen">
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
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-gray-900">{issue?.key || issueKey}</h1>
                  {issue?.issueType && <Badge color="bg-gray-100 text-gray-600">{issue.issueType}</Badge>}
                  {issue?.status && <Badge color={STATUS_COLORS[issue.statusCategory] || STATUS_COLORS.new}>{issue.status}</Badge>}
                </div>
                {issue?.summary && <p className="text-sm text-gray-500 mt-0.5">{issue.summary}</p>}
              </div>
            </div>
            <a
              href={`${jiraBaseUrl}/browse/${issueKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md"
            >
              Open in Jira
            </a>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 mt-3">
            {[
              { key: "data", label: "Issue Data" },
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

        {!loading && issue && (
          <>
            {tab === "data" && <RawIssueDetail issue={issue} jiraBaseUrl={jiraBaseUrl} />}

            {tab === "prompt" && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                  <strong>Step 1:</strong> Copy this prompt and paste it into your AI chatbot. It will analyze this issue and return a structured JSON report.
                </div>
                <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
                    <span className="text-xs font-medium text-gray-300">AI Prompt for {issueKey}</span>
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

            {tab === "paste" && (
              <div className="space-y-4">
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-sm text-purple-800">
                  <strong>Step 2:</strong> Paste the JSON response from your AI chatbot below, then click "Parse & View Report".
                </div>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="Paste the AI JSON response here..."
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
                  Parse & View Report
                </button>
              </div>
            )}

            {tab === "report" && report && (
              <ReportRenderer report={report} issueKey={issueKey} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
