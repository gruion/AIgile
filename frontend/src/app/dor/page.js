"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { fetchDoR } from "../../lib/api";
import AiCoachPanel from "../../components/AiCoachPanel";
import TicketDiffModal from "../../components/TicketDiffModal";
import JqlBar from "../../components/JqlBar";
import ResizableTable from "../../components/ResizableTable";
import { toast } from "../../components/Toaster";
import { useAppConfig } from "../../context/AppConfigContext";

const STATUS_COLORS = {
  "To Do": "bg-gray-100 text-gray-700",
  "In Progress": "bg-blue-100 text-blue-700",
  "In Review": "bg-purple-100 text-purple-700",
  Done: "bg-green-100 text-green-700",
};

function ScoreColor(score) {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#3b82f6";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

function ScoreBadge({ score }) {
  const color = ScoreColor(score);
  return (
    <span className="text-3xl font-bold" style={{ color }}>
      {score}%
    </span>
  );
}

function DistributionBadge({ label, count, color }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${color}`}>
      <span className="text-xs font-semibold">{count}</span>
      <span className="text-xs">{label}</span>
    </div>
  );
}

function CheckDots({ checks }) {
  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      {checks.map((check) => (
        <div
          key={check.id}
          title={`${check.label}: ${check.pass ? "Pass" : "Fail"}${check.detail ? ` — ${check.detail}` : ""}`}
          className={`w-2.5 h-2.5 rounded-full shrink-0 cursor-help ${
            check.pass ? "bg-green-500" : "bg-red-500"
          }`}
        />
      ))}
    </div>
  );
}

function MissingCriteriaChart({ topMissing }) {
  if (!topMissing || topMissing.length === 0) return null;
  const maxCount = Math.max(...topMissing.map((m) => m.count), 1);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-4">Top Missing Criteria</h3>
      <div className="space-y-2.5">
        {topMissing.map((item, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-gray-600 w-40 shrink-0 truncate" title={item.label}>
              {item.label}
            </span>
            <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-red-400 rounded-full transition-all duration-500"
                style={{ width: `${(item.count / maxCount) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 w-16 text-right shrink-0">
              {item.count} ({item.pct}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DoRPage() {
  const { defaultJql, jiraBaseUrl } = useAppConfig();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");
  const [diffTicket, setDiffTicket] = useState(null);

  const load = useCallback(async (query) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDoR(query);
      setData(result);
      toast.success("Definition of Ready data loaded");
    } catch (err) {
      setError(err.message);
      toast.error("Failed to load DoR data");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (defaultJql) {
      setJql((prev) => prev || defaultJql);
      setInputJql((prev) => prev || defaultJql);
    }
  }, [defaultJql]);

  useEffect(() => {
    if (jql) load(jql);
  }, [jql, load]);

  const columns = useMemo(
    () => [
      {
        key: "key",
        label: "Key",
        sortable: true,
        defaultWidth: 110,
        minWidth: 80,
        render: (row) => (
          <a
            href={`${jiraBaseUrl}/browse/${row.key}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-blue-600 hover:underline"
          >
            {row.key}
          </a>
        ),
      },
      {
        key: "summary",
        label: "Summary",
        sortable: true,
        defaultWidth: 280,
        minWidth: 150,
        render: (row) => (
          <span className="text-xs text-gray-800 truncate block" title={row.summary}>
            {row.summary}
          </span>
        ),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        defaultWidth: 120,
        minWidth: 90,
        render: (row) => {
          const style = STATUS_COLORS[row.status] || "bg-gray-100 text-gray-600";
          return (
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${style}`}>
              {row.status}
            </span>
          );
        },
      },
      {
        key: "readyScore",
        label: "Ready Score",
        sortable: true,
        defaultWidth: 140,
        minWidth: 100,
        render: (row) => {
          const color = ScoreColor(row.readyScore);
          return (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${row.readyScore}%`, backgroundColor: color }}
                />
              </div>
              <span className="text-xs font-semibold" style={{ color }}>
                {row.readyScore}%
              </span>
            </div>
          );
        },
      },
      {
        key: "checks",
        label: "Checks",
        sortable: false,
        defaultWidth: 160,
        minWidth: 80,
        render: (row) => <CheckDots checks={row.checks} />,
      },
      {
        key: "assignee",
        label: "Assignee",
        sortable: true,
        defaultWidth: 130,
        minWidth: 80,
        render: (row) => (
          <span className="text-xs text-gray-600">{row.assignee || "Unassigned"}</span>
        ),
      },
      {
        key: "priority",
        label: "Priority",
        sortable: true,
        defaultWidth: 100,
        minWidth: 70,
        render: (row) => (
          <span className="text-xs text-gray-600">{row.priority || "—"}</span>
        ),
      },
      {
        key: "_actions",
        label: "",
        sortable: false,
        defaultWidth: 90,
        minWidth: 70,
        render: (row) =>
          !row.isReady ? (
            <button
              onClick={() => setDiffTicket(row)}
              className="text-[10px] font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-md transition-colors whitespace-nowrap"
            >
              Suggest Fix
            </button>
          ) : null,
      },
    ],
    [jiraBaseUrl]
  );

  const sortFn = (a, b, key, dir) => {
    if (key === "readyScore") {
      const diff = a.readyScore - b.readyScore;
      return dir === "asc" ? diff : -diff;
    }
    return 0;
  };

  const aiPrompts = [
    {
      label: "Full Readiness Audit",
      primary: true,
      question: "As an Agile Coach, perform a comprehensive Definition of Ready audit. For each item, assess: Does it have clear acceptance criteria? Is it estimated? Is the description sufficient? Are dependencies identified? Reference specific ticket keys. Then provide: 1) Overall readiness assessment, 2) Top 5 items to fix before sprint planning, 3) Process improvements to prevent readiness gaps, 4) Recommended refinement session agenda.",
    },
    {
      label: "Fix priorities",
      question: "Which items should we fix first to improve overall readiness? Prioritize by impact on sprint planning. For each, specify exactly what's missing and how to fix it.",
    },
    {
      label: "Process improvement",
      question: "Analyze the patterns in our DoR failures. Are we consistently missing the same criteria? What process changes (refinement cadence, story templates, definition of ready checklist) would improve compliance? Suggest 3 concrete process improvements.",
    },
    {
      label: "Sprint planning advice",
      question: "Based on readiness scores, which items are safe to pull into the next sprint? Which need more refinement? Suggest a sprint planning strategy: what to commit to, what to stretch-goal, and what to send back to refinement.",
    },
    {
      label: "Story quality coaching",
      question: "Review the items with the lowest readiness scores. For each, coach the team on how to improve the story: suggest acceptance criteria, identify missing information, recommend how to make the story testable and estimable.",
    },
  ];

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Definition of Ready</h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Gate check: are backlog items ready for sprint planning?
              </p>
            </div>
            <button
              onClick={() => load(jql)}
              disabled={loading}
              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-md disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
          <div className="mt-2">
            <JqlBar
              value={inputJql}
              onChange={setInputJql}
              onSubmit={(q) => setJql(q)}
              placeholder="Select backlog items to check readiness..."
            />
          </div>
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

        {/* AI Coach */}
        {!loading && data && (
          <div className="mb-4">
            <AiCoachPanel
              context="Definition of Ready Gate"
              data={data}
              prompts={aiPrompts}
            />
          </div>
        )}

        {!loading && data && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Average DoR Score */}
              <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col items-center justify-center">
                <p className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider mb-2">
                  Avg DoR Score
                </p>
                <ScoreBadge score={data.avgScore} />
                <p className="text-xs text-gray-500 mt-1">
                  {data.readyCount} of {data.totalCount} ready
                </p>
              </div>

              {/* Distribution */}
              <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col justify-center">
                <p className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider mb-3">
                  Distribution
                </p>
                <div className="flex flex-col gap-2">
                  <DistributionBadge
                    label="Ready"
                    count={data.distribution.ready}
                    color="bg-green-50 text-green-700"
                  />
                  <DistributionBadge
                    label="Almost Ready"
                    count={data.distribution.almostReady}
                    color="bg-amber-50 text-amber-700"
                  />
                  <DistributionBadge
                    label="Not Ready"
                    count={data.distribution.notReady}
                    color="bg-red-50 text-red-700"
                  />
                </div>
              </div>

              {/* Total items */}
              <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col items-center justify-center">
                <p className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider mb-2">
                  Total Items
                </p>
                <span className="text-3xl font-bold text-gray-800">{data.totalCount}</span>
              </div>

              {/* Ready rate */}
              <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col items-center justify-center">
                <p className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider mb-2">
                  Ready Rate
                </p>
                <span className="text-3xl font-bold" style={{ color: ScoreColor(data.totalCount > 0 ? Math.round((data.readyCount / data.totalCount) * 100) : 0) }}>
                  {data.totalCount > 0 ? Math.round((data.readyCount / data.totalCount) * 100) : 0}%
                </span>
              </div>
            </div>

            {/* Top Missing Criteria */}
            <MissingCriteriaChart topMissing={data.topMissing} />

            {/* Issues Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-800">
                  Issues ({data.items.length})
                </h3>
              </div>
              <ResizableTable
                columns={columns}
                data={data.items}
                getRowKey={(row) => row.key}
                defaultSort={{ key: "readyScore", dir: "asc" }}
                sortFn={sortFn}
                emptyMessage="No items found"
                rowClassName={(row) =>
                  row.isReady
                    ? "bg-green-50/30"
                    : row.readyScore >= 50
                    ? ""
                    : "bg-red-50/30"
                }
              />
            </div>

          </>
        )}

        {!loading && !data && !error && !jql && (
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

      {diffTicket && (
        <TicketDiffModal
          ticket={diffTicket}
          onClose={() => setDiffTicket(null)}
          jiraBaseUrl={jiraBaseUrl}
        />
      )}
    </div>
  );
}
