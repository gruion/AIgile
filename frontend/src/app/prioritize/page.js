"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchPrioritization } from "../../lib/api";
import AiCoachPanel from "../../components/AiCoachPanel";
import JqlBar from "../../components/JqlBar";
import { toast } from "../../components/Toaster";
import { useAppConfig } from "../../context/AppConfigContext";

const PRIORITY_COLORS = {
  Blocker: "bg-red-200 text-red-900",
  Highest: "bg-red-100 text-red-800",
  High: "bg-orange-100 text-orange-800",
  Medium: "bg-yellow-100 text-yellow-800",
  Low: "bg-blue-100 text-blue-700",
  Lowest: "bg-gray-100 text-gray-500",
};

const AI_PROMPTS = [
  { label: "Sprint planning advice", primary: true, question: "Based on the prioritized backlog, suggest which tickets to commit to for the next sprint. Consider: dependencies (unblock others first), due dates, story points, team capacity. Group into 'commit', 'stretch goal', and 'send back to refinement'." },
  { label: "Splitting suggestions", question: "Identify the oversized tickets that exceed the story point limit. For each, suggest how to split them into smaller deliverable stories. Use patterns: workflow steps, business rule variations, data variations, interface splits." },
  { label: "Dependency order", question: "Analyze the dependency chains. What is the optimal execution order to minimize blocked time? Which tickets should be started first to unblock the most work downstream?" },
  { label: "Risk assessment", question: "Which tickets are highest risk for the sprint? Consider: overdue items, blocked chains, oversized tickets, unassigned work. What mitigation steps should we take?" },
  { label: "Capacity planning", question: "Based on the ticket story points and assignees, estimate capacity usage. Is anyone overloaded? Are there unassigned high-priority items? Suggest rebalancing." },
];

function ScoreBadge({ score }) {
  const color = score >= 50 ? "bg-red-100 text-red-800" : score >= 30 ? "bg-orange-100 text-orange-800" : score >= 15 ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600";
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${color}`}>{score}</span>;
}

function SPBadge({ sp, maxSP }) {
  if (sp === null || sp === undefined) return <span className="text-[10px] text-gray-300">—</span>;
  const isOver = sp > maxSP;
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isOver ? "bg-red-100 text-red-700 ring-1 ring-red-300" : "bg-blue-50 text-blue-700"}`}>
      {sp} SP {isOver && "⚠"}
    </span>
  );
}

function TicketRow({ ticket, rank, jiraBaseUrl }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`border-b border-gray-100 last:border-b-0 ${ticket.isOversized ? "bg-red-50/30" : ticket.isBlocked ? "bg-amber-50/30" : ""}`}>
      <div className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => setExpanded(!expanded)}>
        {/* Rank */}
        <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-600 shrink-0">
          {rank}
        </span>

        {/* Score */}
        <ScoreBadge score={ticket.score} />

        {/* Key */}
        <a href={`${jiraBaseUrl}/browse/${ticket.key}`} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-blue-600 hover:underline shrink-0" onClick={(e) => e.stopPropagation()}>
          {ticket.key}
        </a>

        {/* Priority */}
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${PRIORITY_COLORS[ticket.priority] || PRIORITY_COLORS.Medium}`}>
          {ticket.priority}
        </span>

        {/* Story Points */}
        <SPBadge sp={ticket.storyPoints} maxSP={ticket.maxStoryPoints} />

        {/* Status */}
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{ticket.status}</span>

        {/* Flags */}
        {ticket.incoherenceCount > 0 && <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">{ticket.incoherenceCount} issue{ticket.incoherenceCount > 1 ? "s" : ""}</span>}
        {ticket.isBlocked && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">blocked</span>}
        {ticket.isOversized && <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">split needed</span>}
        {ticket.downstreamCount > 0 && <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">unblocks {ticket.downstreamCount}</span>}
        {ticket.dueDate && new Date(ticket.dueDate) < new Date() && <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">overdue</span>}

        {/* Summary */}
        <span className="text-xs text-gray-700 truncate flex-1 min-w-0">{ticket.summary}</span>

        {/* Assignee */}
        <span className="text-[10px] text-gray-400 shrink-0">{ticket.assignee || "Unassigned"}</span>

        {/* Due date */}
        {ticket.dueDate && (
          <span className={`text-[10px] shrink-0 ${new Date(ticket.dueDate) < new Date() ? "text-red-600 font-medium" : "text-gray-400"}`}>
            {new Date(ticket.dueDate).toLocaleDateString()}
          </span>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-3 ml-9 space-y-1.5">
          <div className="text-xs text-gray-500 grid grid-cols-2 gap-2">
            <div>Score breakdown: priority({ticket.priority}) + deps(unblocks {ticket.downstreamCount}) + due date{ticket.isBlocked ? " - blocked penalty" : ""}</div>
            <div>Age: {ticket.daysSinceCreated}d | Type: {ticket.issueType} | Epic: {ticket.epicKey || "none"}</div>
          </div>
          {ticket.isBlocked && (
            <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
              Blocked by: {ticket.blockedByKeys.join(", ")}
            </div>
          )}
          {ticket.isOversized && (
            <div className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">
              {ticket.storyPoints} SP exceeds limit of {ticket.maxStoryPoints} SP — consider splitting into smaller tasks (Fibonacci: 1, 2, 3, 5, 8)
            </div>
          )}
          {ticket.isNotFibonacci && !ticket.isOversized && (
            <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
              {ticket.storyPoints} SP is not a Fibonacci number — consider re-estimating (1, 2, 3, 5, 8, 13, 21)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PrioritizePage() {
  const { defaultJql, jiraBaseUrl } = useAppConfig();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");
  const [tab, setTab] = useState("all"); // all | oversized | unblockers | overdue | quickWins | incoherences

  const load = useCallback(async (query) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPrioritization(query);
      setData(result);
      toast.success(`Prioritized ${result.stats.total} tickets`);
    } catch (err) {
      setError(err.message);
      toast.error("Failed to prioritize");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (defaultJql) {
      setJql((prev) => prev || defaultJql);
      setInputJql((prev) => prev || defaultJql);
    }
  }, [defaultJql]);

  useEffect(() => { if (jql) load(jql); }, [jql, load]);

  const displayedTickets = data ? (
    tab === "incoherences" ? [] : // handled separately
    tab === "oversized" ? data.oversized :
    tab === "unblockers" ? data.unblockers :
    tab === "overdue" ? data.overdue :
    tab === "quickWins" ? data.quickWins :
    data.tickets
  ) : [];

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Sprint Prioritization</h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Algorithmic ranking based on dependencies, priority, due dates, and story points
              </p>
            </div>
            <button onClick={() => load(jql)} disabled={loading} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-md disabled:opacity-50">
              Refresh
            </button>
          </div>
          <JqlBar value={inputJql} onChange={setInputJql} onSubmit={(q) => setJql(q)} placeholder="JQL to select tickets for prioritization..." />
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-6 space-y-6">
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
            {/* AI Coach */}
            <AiCoachPanel context="Sprint Prioritization" data={data} prompts={AI_PROMPTS} title="Planning Coach" />

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                <span className="text-xl font-bold text-gray-900">{data.stats.total}</span>
                <p className="text-[9px] text-gray-500 mt-0.5">Total</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                <span className={`text-xl font-bold ${data.stats.oversizedCount > 0 ? "text-red-700" : "text-green-700"}`}>{data.stats.oversizedCount}</span>
                <p className="text-[9px] text-gray-500 mt-0.5">Oversized ({">"}{ data.storyPointSettings?.maxStoryPoints || 8} SP)</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                <span className={`text-xl font-bold ${data.stats.blockedCount > 0 ? "text-amber-700" : "text-green-700"}`}>{data.stats.blockedCount}</span>
                <p className="text-[9px] text-gray-500 mt-0.5">Blocked</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                <span className={`text-xl font-bold ${data.stats.overdueCount > 0 ? "text-red-700" : "text-green-700"}`}>{data.stats.overdueCount}</span>
                <p className="text-[9px] text-gray-500 mt-0.5">Overdue</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                <span className="text-xl font-bold text-green-700">{data.stats.unblockerCount}</span>
                <p className="text-[9px] text-gray-500 mt-0.5">Unblockers</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                <span className={`text-xl font-bold ${(data.stats.incoherenceCount || 0) > 0 ? "text-orange-700" : "text-green-700"}`}>{data.stats.incoherenceCount || 0}</span>
                <p className="text-[9px] text-gray-500 mt-0.5">Incoherences</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                <span className="text-xl font-bold text-blue-700">{data.stats.avgStoryPoints}</span>
                <p className="text-[9px] text-gray-500 mt-0.5">Avg SP</p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { key: "all", label: "All (ranked)", count: data.stats.total },
                { key: "incoherences", label: "Incoherences", count: data.stats.incoherenceCount || 0, color: "text-orange-700" },
                { key: "unblockers", label: "Unblockers first", count: data.stats.unblockerCount, color: "text-green-700" },
                { key: "oversized", label: "Need splitting", count: data.stats.oversizedCount, color: "text-red-700" },
                { key: "overdue", label: "Overdue", count: data.stats.overdueCount, color: "text-red-700" },
                { key: "quickWins", label: "Quick wins", count: data.quickWins?.length || 0, color: "text-blue-700" },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    tab === t.key ? "bg-blue-50 text-blue-700 border-blue-200 font-medium" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {t.label}
                  <span className={`ml-1.5 text-[10px] font-bold ${t.color || ""}`}>{t.count}</span>
                </button>
              ))}
            </div>

            {/* Score legend */}
            {tab !== "incoherences" && (
              <div className="bg-gray-50 rounded-lg border border-gray-200 px-4 py-2 flex items-center gap-4 text-[10px] text-gray-500 flex-wrap">
                <span className="font-semibold text-gray-700">Score:</span>
                <span>Priority (0-40)</span>
                <span>+ Due date (0-30)</span>
                <span>+ Deps impact (0-30)</span>
                <span className="text-orange-600">+ Incoherence (0-15)</span>
                <span>+ Stale blocker (0-10)</span>
                <span>+ Orphan urgent (0-10)</span>
                <span>+ Age (0-10)</span>
                <span>+ Efficiency (0-10)</span>
                <span className="text-amber-600">- Blocked (-20)</span>
              </div>
            )}

            {/* Incoherences view */}
            {tab === "incoherences" && (
              <div className="space-y-2">
                {(data.incoherences || []).length === 0 ? (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
                    <svg className="w-10 h-10 mx-auto text-green-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-green-700 font-medium">No incoherences detected!</p>
                    <p className="text-green-600 text-sm mt-1">All dependencies, priorities, and due dates are consistent.</p>
                  </div>
                ) : (
                  (data.incoherences || []).map((inc, i) => {
                    const sevStyles = {
                      critical: "border-red-300 bg-red-50",
                      high: "border-orange-300 bg-orange-50",
                      medium: "border-amber-200 bg-amber-50",
                      low: "border-gray-200 bg-gray-50",
                    };
                    const sevBadge = {
                      critical: "bg-red-200 text-red-800",
                      high: "bg-orange-200 text-orange-800",
                      medium: "bg-amber-200 text-amber-800",
                      low: "bg-gray-200 text-gray-600",
                    };
                    const typeLabels = {
                      due_date_conflict: "Due Date Conflict",
                      priority_conflict: "Priority Mismatch",
                      status_conflict: "Status Conflict",
                      self_blocking: "Self-Blocking",
                      stale_blocker: "Stale Blocker",
                      unassigned_blocker: "Unassigned Blocker",
                      orphan_urgent: "Orphan Urgent",
                      circular_dependency: "Circular Dependency",
                    };
                    return (
                      <div key={i} className={`rounded-xl border-2 p-4 ${sevStyles[inc.severity] || sevStyles.low}`}>
                        <div className="flex items-start gap-3">
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded shrink-0 ${sevBadge[inc.severity] || sevBadge.low}`}>
                            {inc.severity}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{typeLabels[inc.type] || inc.type}</span>
                              <span className="text-sm font-semibold text-gray-900">{inc.title}</span>
                            </div>
                            <p className="text-xs text-gray-700">{inc.description}</p>
                            <div className="flex items-center gap-3 mt-2">
                              {inc.blocker && (
                                <a href={`${jiraBaseUrl}/browse/${inc.blocker}`} target="_blank" rel="noopener noreferrer"
                                  className="text-[10px] font-mono text-blue-600 hover:underline bg-blue-50 px-1.5 py-0.5 rounded">
                                  {inc.blocker}
                                </a>
                              )}
                              {inc.blocked && (
                                <>
                                  <span className="text-[10px] text-gray-400">→</span>
                                  <span className="text-[10px] font-mono text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                                    {inc.blocked}
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="mt-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                              Fix: {inc.fix}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Ticket list (hidden when incoherences tab is active) */}
            {tab !== "incoherences" && <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700">{displayedTickets.length} tickets</span>
                <span className="text-[10px] text-gray-400">Higher score = do first</span>
              </div>
              {displayedTickets.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">No tickets in this category</div>
              ) : (
                displayedTickets.map((ticket, i) => (
                  <TicketRow key={ticket.key} ticket={ticket} rank={i + 1} jiraBaseUrl={jiraBaseUrl} />
                ))
              )}
            </div>}
          </>
        )}

        {!loading && !data && !error && !jql && (
          <div className="text-center py-20 text-gray-400">
            <svg className="mx-auto w-12 h-12 mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
            </svg>
            <p className="text-lg font-medium text-gray-500 mb-2">Enter a JQL query to prioritize</p>
            <p className="text-sm mb-4">Select active backlog tickets:</p>
            <code className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-md">project = TEAM AND statusCategory != Done ORDER BY priority ASC</code>
          </div>
        )}
      </main>
    </div>
  );
}
