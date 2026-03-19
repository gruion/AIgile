"use client";

import { useState, useEffect } from "react";
import { fetchInsightsSummaries, fetchBoardSummary } from "../../lib/api";
import JqlBar from "../../components/JqlBar";

const RISK_COLORS = {
  high: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", badge: "bg-red-100 text-red-800" },
  medium: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", badge: "bg-amber-100 text-amber-800" },
  low: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200", badge: "bg-green-100 text-green-800" },
};

function RiskBadge({ level }) {
  const colors = RISK_COLORS[level] || RISK_COLORS.low;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors.badge}`}>
      {level}
    </span>
  );
}

function TicketSummaryCard({ summary }) {
  const colors = RISK_COLORS[summary.risk_level] || RISK_COLORS.low;
  return (
    <div className={`rounded-lg border ${colors.border} ${colors.bg} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-gray-900">{summary.issue_key}</span>
        <RiskBadge level={summary.risk_level} />
      </div>
      <p className="text-sm text-gray-800 mb-2">{summary.tldr}</p>
      <p className="text-xs text-gray-600 mb-1">{summary.status_insight}</p>
      <p className={`text-xs font-medium ${colors.text}`}>{summary.action_needed}</p>
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-200/50">
        <span className="text-[10px] text-gray-400">{summary.risk_reason}</span>
        {summary.staleness_days > 0 && (
          <span className="text-[10px] text-gray-400">{summary.staleness_days}d since update</span>
        )}
      </div>
    </div>
  );
}

function BoardSummaryPanel({ board }) {
  if (!board) return null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Executive Summary</h2>
        <p className="text-sm text-gray-700">{board.executive_summary}</p>
        <p className="text-xs text-gray-400 mt-1">{board.total_issues} issues analyzed</p>
      </div>

      {/* Recommendations */}
      {board.recommendations?.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Recommendations</h3>
          <ul className="space-y-1.5">
            {board.recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="text-blue-500 mt-0.5 shrink-0">&#x2022;</span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Blocked tickets */}
      {board.blocked_tickets?.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-2">
            Blocked ({board.blocked_tickets.length})
          </h3>
          <div className="space-y-1">
            {board.blocked_tickets.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-sm bg-red-50 rounded px-3 py-1.5">
                <span className="font-medium text-red-800">{t.key}</span>
                <span className="text-red-600 text-xs">{t.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stale tickets */}
      {board.stale_tickets?.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-2">
            Stale ({board.stale_tickets.length})
          </h3>
          <div className="space-y-1">
            {board.stale_tickets.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-sm bg-amber-50 rounded px-3 py-1.5">
                <span className="font-medium text-amber-800">{t.key}</span>
                <span className="text-amber-600 text-xs">{t.days_stale}d stale</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team workload */}
      {board.team_workload && Object.keys(board.team_workload).length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Team Workload</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(board.team_workload).map(([name, w]) => (
              <div key={name} className="bg-gray-50 rounded-lg p-3">
                <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                  <span>{w.count} total</span>
                  {w.in_progress > 0 && <span className="text-blue-600">{w.in_progress} active</span>}
                  {w.todo > 0 && <span className="text-gray-400">{w.todo} todo</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-gray-400 text-right">
        Generated {new Date(board.generated_at).toLocaleString()}
      </p>
    </div>
  );
}

export default function InsightsPage() {
  const [summaries, setSummaries] = useState([]);
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [riskFilter, setRiskFilter] = useState("all");
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [sums, boardData] = await Promise.all([
          fetchInsightsSummaries(),
          fetchBoardSummary(),
        ]);
        setSummaries(sums);
        setBoard(boardData);
      } catch (err) {
        setError(err.message);
      }
      setLoading(false);
    }
    load();
  }, []);

  const filtered = riskFilter === "all"
    ? summaries
    : summaries.filter((s) => s.risk_level === riskFilter);

  const riskCounts = {
    high: summaries.filter((s) => s.risk_level === "high").length,
    medium: summaries.filter((s) => s.risk_level === "medium").length,
    low: summaries.filter((s) => s.risk_level === "low").length,
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-900">AI Insights</h1>
            <button
              onClick={() => window.location.reload()}
              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-md"
            >
              Refresh
            </button>
          </div>

          {/* Risk filters */}
          <div className="flex gap-1 mt-3">
            {[
              { key: "all", label: `All (${summaries.length})` },
              { key: "high", label: `High (${riskCounts.high})` },
              { key: "medium", label: `Medium (${riskCounts.medium})` },
              { key: "low", label: `Low (${riskCounts.low})` },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setRiskFilter(f.key)}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  riskFilter === f.key
                    ? f.key === "high" ? "bg-red-600 text-white"
                    : f.key === "medium" ? "bg-amber-500 text-white"
                    : f.key === "low" ? "bg-green-600 text-white"
                    : "bg-blue-600 text-white"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            <strong>Error:</strong> {error}
            <p className="text-xs text-red-500 mt-1">
              Make sure the API is running and n8n has generated summaries.
            </p>
          </div>
        )}

        <JqlBar value={inputJql} onChange={setInputJql} onSubmit={(q) => setJql(q)} />

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-blue-200 border-t-blue-600 rounded-full" />
          </div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Board summary */}
            <div className="lg:col-span-1">
              {board ? (
                <BoardSummaryPanel board={board} />
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400">
                  <p className="text-sm mb-1">No board summary yet</p>
                  <p className="text-xs">Summaries are generated by n8n every 15 minutes.</p>
                </div>
              )}
            </div>

            {/* Right: Ticket summaries */}
            <div className="lg:col-span-2">
              {filtered.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filtered.map((s) => (
                    <TicketSummaryCard key={s.issue_key} summary={s} />
                  ))}
                </div>
              ) : summaries.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
                  <p className="text-lg mb-2">No AI summaries yet</p>
                  <p className="text-sm">
                    Import the n8n workflow and trigger it, or wait for the 15-minute cron.
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
                  <p className="text-sm">No tickets match the "{riskFilter}" filter.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
