"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchEpicDetail } from "../../../lib/api";

// ─── Prompt builder ─────────────────────────────────────

function buildPrompt(epic, tickets, stats) {
  const today = new Date().toISOString().split("T")[0];
  const lines = [];

  lines.push(`# Epic Status Report: ${epic.key} — ${epic.summary || ""}`);
  lines.push(`Generated: ${today}`);
  lines.push("");

  // Epic overview
  lines.push("## Epic Overview");
  if (epic.status) lines.push(`- Status: ${epic.status}`);
  if (epic.assigneeName) lines.push(`- Owner: ${epic.assigneeName}`);
  if (epic.priority) lines.push(`- Priority: ${epic.priority}`);
  if (epic.dueDate) lines.push(`- Due Date: ${epic.dueDate}`);
  if (epic.labels?.length) lines.push(`- Labels: ${epic.labels.join(", ")}`);
  if (epic.description) {
    lines.push(`- Description: ${epic.description.substring(0, 500)}`);
  }
  lines.push("");

  // Progress summary
  lines.push("## Progress Summary");
  lines.push(`- Total tickets: ${stats.total}`);
  lines.push(`- Done: ${stats.done} (${stats.progress}%)`);
  lines.push(`- In Progress: ${stats.inProgress}`);
  lines.push(`- To Do: ${stats.todo}`);
  lines.push("");

  // Blockers & risks
  const blocked = tickets.filter((t) => t.blockers?.length > 0 || t.urgencyFlags?.some((f) => f.type === "blocked"));
  const overdue = tickets.filter((t) => t.urgencyFlags?.some((f) => f.type === "overdue"));
  const stale = tickets.filter((t) => t.urgencyFlags?.some((f) => f.type === "stale"));

  if (blocked.length || overdue.length || stale.length) {
    lines.push("## Risks & Blockers");
    if (blocked.length) {
      lines.push("### Blocked Tickets");
      for (const t of blocked) {
        const reasons = t.blockers?.map((b) => `blocked by ${b.key}`).join(", ") || "labeled blocked";
        lines.push(`- ${t.key} (${t.summary}): ${reasons}`);
      }
    }
    if (overdue.length) {
      lines.push("### Overdue Tickets");
      for (const t of overdue) {
        lines.push(`- ${t.key} (${t.summary}): due ${t.dueDate}, assigned to ${t.assigneeName || "unassigned"}`);
      }
    }
    if (stale.length) {
      lines.push("### Stale Tickets (no update 7+ days)");
      for (const t of stale) {
        lines.push(`- ${t.key} (${t.summary}): last update ${t.daysSinceUpdate}d ago`);
      }
    }
    lines.push("");
  }

  // All tickets detail
  lines.push("## Ticket Details");
  lines.push("");
  for (const t of tickets) {
    lines.push(`### ${t.key} — ${t.summary}`);
    lines.push(`- Type: ${t.issueType || "Task"} | Status: ${t.status} | Priority: ${t.priority || "Medium"}`);
    lines.push(`- Assignee: ${t.assigneeName || "Unassigned"}`);
    if (t.dueDate) lines.push(`- Due: ${t.dueDate}`);
    if (t.labels?.length) lines.push(`- Labels: ${t.labels.join(", ")}`);
    if (t.originalEstimate || t.timeSpent) {
      lines.push(`- Time: estimated ${t.originalEstimate || "—"}, spent ${t.timeSpent || "—"}, remaining ${t.remainingEstimate || "—"}`);
    }
    if (t.urgencyFlags?.length) {
      lines.push(`- Flags: ${t.urgencyFlags.map((f) => f.label).join(", ")}`);
    }
    if (t.description) {
      lines.push(`- Description: ${t.description.substring(0, 300)}`);
    }
    if (t.blockers?.length) {
      lines.push(`- Blockers: ${t.blockers.map((b) => `${b.key} (${b.summary}, ${b.status})`).join("; ")}`);
    }
    if (t.links?.length) {
      const nonBlockers = t.links.filter((l) => !l.direction?.toLowerCase().includes("block"));
      if (nonBlockers.length) {
        lines.push(`- Related: ${nonBlockers.map((l) => `${l.direction} ${l.key}`).join("; ")}`);
      }
    }
    if (t.comments?.length) {
      lines.push(`- Comments (${t.commentCount}):`);
      const recent = t.comments.slice(-3);
      for (const c of recent) {
        const date = c.date ? new Date(c.date).toISOString().split("T")[0] : "";
        lines.push(`  - [${date}] ${c.author}: ${c.body?.substring(0, 200) || ""}`);
      }
      if (t.commentCount > 3) lines.push(`  - ... and ${t.commentCount - 3} more`);
    }
    lines.push(`- Created: ${t.created ? new Date(t.created).toISOString().split("T")[0] : "—"} | Updated: ${t.updated ? new Date(t.updated).toISOString().split("T")[0] : "—"} (${t.daysSinceUpdate}d ago)`);
    lines.push("");
  }

  // Closing instruction for the chatbot
  lines.push("---");
  lines.push("Based on all the information above, provide:");
  lines.push("1. A concise executive summary of this epic's current status and health");
  lines.push("2. The top 3 risks or blockers that need immediate attention");
  lines.push("3. Recommendations for the team to get back on track");
  lines.push("4. An assessment of whether the epic will meet its deadline (if set)");
  lines.push("5. Any team workload imbalances or tickets that should be reassigned");

  return lines.join("\n");
}

// ─── Components ─────────────────────────────────────────

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

function TicketDetail({ ticket }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      {/* Header row */}
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

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3 text-sm bg-gray-50/50">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <span className="text-[10px] uppercase text-gray-400 font-medium">Priority</span>
              <p className="text-gray-800">{ticket.priority || "—"}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase text-gray-400 font-medium">Due Date</span>
              <p className="text-gray-800">{ticket.dueDate || "—"}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase text-gray-400 font-medium">Type</span>
              <p className="text-gray-800">{ticket.issueType || "—"}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase text-gray-400 font-medium">Updated</span>
              <p className="text-gray-800">{ticket.daysSinceUpdate}d ago</p>
            </div>
          </div>

          {ticket.labels?.length > 0 && (
            <div>
              <span className="text-[10px] uppercase text-gray-400 font-medium">Labels</span>
              <div className="flex gap-1 mt-1">
                {ticket.labels.map((l) => (
                  <Badge key={l} color="bg-gray-100 text-gray-600">{l}</Badge>
                ))}
              </div>
            </div>
          )}

          {(ticket.originalEstimate || ticket.timeSpent) && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <span className="text-[10px] uppercase text-gray-400 font-medium">Estimated</span>
                <p className="text-gray-800">{ticket.originalEstimate || "—"}</p>
              </div>
              <div>
                <span className="text-[10px] uppercase text-gray-400 font-medium">Spent</span>
                <p className="text-gray-800">{ticket.timeSpent || "—"}</p>
              </div>
              <div>
                <span className="text-[10px] uppercase text-gray-400 font-medium">Remaining</span>
                <p className="text-gray-800">{ticket.remainingEstimate || "—"}</p>
              </div>
            </div>
          )}

          {ticket.description && (
            <div>
              <span className="text-[10px] uppercase text-gray-400 font-medium">Description</span>
              <p className="text-gray-700 text-xs mt-1 whitespace-pre-line line-clamp-4">{ticket.description}</p>
            </div>
          )}

          {ticket.blockers?.length > 0 && (
            <div>
              <span className="text-[10px] uppercase text-red-500 font-medium">Blockers</span>
              <div className="space-y-1 mt-1">
                {ticket.blockers.map((b, i) => (
                  <div key={i} className="flex items-center gap-2 bg-red-50 rounded px-2 py-1 text-xs">
                    <span className="font-medium text-red-800">{b.key}</span>
                    <span className="text-red-600 truncate">{b.summary}</span>
                    <Badge color="bg-red-100 text-red-700">{b.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ticket.links?.length > 0 && (
            <div>
              <span className="text-[10px] uppercase text-gray-400 font-medium">Links</span>
              <div className="space-y-1 mt-1">
                {ticket.links.map((l, i) => (
                  <div key={i} className="text-xs text-gray-600">
                    <span className="text-gray-400">{l.direction}</span>{" "}
                    <span className="font-medium text-blue-600">{l.key}</span>{" "}
                    <span className="text-gray-500">{l.summary}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ticket.comments?.length > 0 && (
            <div>
              <span className="text-[10px] uppercase text-gray-400 font-medium">
                Comments ({ticket.commentCount})
              </span>
              <div className="space-y-2 mt-1">
                {ticket.comments.slice(-3).map((c, i) => (
                  <div key={i} className="bg-white rounded border border-gray-100 px-3 py-2">
                    <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                      <span className="font-medium text-gray-600">{c.author}</span>
                      <span>{c.date ? new Date(c.date).toLocaleDateString() : ""}</span>
                    </div>
                    <p className="text-xs text-gray-700 whitespace-pre-line line-clamp-3">{c.body}</p>
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
  const [showPrompt, setShowPrompt] = useState(false);

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

  const prompt = useMemo(() => {
    if (!data) return "";
    return buildPrompt(data.epic, data.tickets, data.stats);
  }, [data]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS
      const textarea = document.createElement("textarea");
      textarea.value = prompt;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
              <nav className="flex items-center gap-1 text-sm">
                <Link href="/" className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors">Dashboard</Link>
                <Link href="/insights" className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors">Insights</Link>
                <Link href="/gantt" className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors">Gantt</Link>
              </nav>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPrompt(!showPrompt)}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  showPrompt ? "bg-purple-600 text-white" : "bg-purple-50 text-purple-700 hover:bg-purple-100"
                }`}
              >
                {showPrompt ? "Hide Prompt" : "AI Prompt"}
              </button>
              <button
                onClick={handleCopy}
                disabled={!data}
                className={`text-xs px-3 py-1.5 rounded-md transition-all ${
                  copied
                    ? "bg-green-600 text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40"
                }`}
              >
                {copied ? "Copied!" : "Copy Prompt"}
              </button>
            </div>
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
            {/* Stats row */}
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

            {/* AI Prompt panel */}
            {showPrompt && (
              <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
                  <span className="text-xs font-medium text-gray-300">AI Prompt — paste into your corporate chatbot</span>
                  <button
                    onClick={handleCopy}
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
            )}

            {/* Ticket list */}
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">
                All Tickets ({data.tickets.length})
              </h2>
              <div className="space-y-2">
                {data.tickets.map((ticket) => (
                  <TicketDetail key={ticket.key} ticket={ticket} />
                ))}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
