"use client";

import { useState, useCallback, useEffect } from "react";
import StatsBar from "../components/StatsBar";
import EpicCard from "../components/EpicCard";
import IssueRow from "../components/IssueRow";
import FilterBar from "../components/FilterBar";
import JqlBar from "../components/JqlBar";
import AiCoachPanel from "../components/AiCoachPanel";
import { fetchIssues } from "../lib/api";
import { toast } from "../components/Toaster";
import { useAppConfig } from "../context/AppConfigContext";

export default function Home() {
  const { defaultJql, jiraBaseUrl } = useAppConfig();
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [filter, setFilter] = useState("all"); // all | critical | overdue | stale

  const loadData = useCallback(async (query) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchIssues(query);
      setData(result);
      if (result.truncated) {
        toast.warn(`Showing ${result.total} of ${result.totalAvailable} issues. Narrow your query for better results.`);
      } else {
        toast.success(`Loaded ${result.total} issues`);
      }
    } catch (err) {
      setError(err.message);
      toast.error("Failed to load issues: " + err.message);
    }
    setLoading(false);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setJql(inputJql);
  };

  useEffect(() => {
    if (defaultJql) {
      setJql((prev) => prev || defaultJql);
      setInputJql((prev) => prev || defaultJql);
    }
  }, [defaultJql]);

  useEffect(() => {
    if (jql) loadData(jql);
  }, [jql, loadData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => loadData(jql), 60000);
    return () => clearInterval(interval);
  }, [autoRefresh, jql, loadData]);

  // Filter epics based on selected filter
  const filteredEpics = data?.epics?.filter((epic) => {
    if (filter === "all") return true;
    if (filter === "critical") return epic.stats.criticalCount > 0;
    if (filter === "overdue")
      return epic.issues.some((i) => i.urgencyFlags.some((f) => f.type === "overdue"));
    if (filter === "stale")
      return epic.issues.some((i) => i.urgencyFlags.some((f) => f.type === "stale"));
    return true;
  });

  const filteredNoEpic = data?.noEpic?.filter((issue) => {
    if (filter === "all") return true;
    if (filter === "critical")
      return issue.urgencyFlags.some((f) => f.severity === "critical");
    if (filter === "overdue")
      return issue.urgencyFlags.some((f) => f.type === "overdue");
    if (filter === "stale")
      return issue.urgencyFlags.some((f) => f.type === "stale");
    return true;
  });

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">Dashboard</h1>
            <div className="flex items-center gap-2">
              {data && (
                <span className="text-xs text-gray-400">{data.total} issues</span>
              )}
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Auto-refresh
              </label>
              <button
                onClick={() => loadData(jql)}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-md"
              >
                Refresh
              </button>
              <a
                href={jiraBaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md"
              >
                Open Jira
              </a>
            </div>
          </div>

          {/* JQL Search */}
          <JqlBar
            value={inputJql}
            onChange={setInputJql}
            onSubmit={(q) => setJql(q)}
          />

          {/* Jira saved filters / boards */}
          <div className="mt-3">
            <FilterBar
              currentJql={jql}
              onApplyFilter={(newJql) => {
                setJql(newJql);
                setInputJql(newJql);
              }}
            />
          </div>

          {/* Quick filters */}
          <div className="flex gap-1 mt-2">
            {[
              { key: "all", label: "All" },
              { key: "critical", label: "Critical" },
              { key: "overdue", label: "Overdue" },
              { key: "stale", label: "Stale" },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  filter === f.key
                    ? "bg-blue-600 text-white"
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
        {/* Stats bar */}
        {data?.stats && <StatsBar stats={data.stats} />}

        {/* Truncation warning */}
        {data?.truncated && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            <strong>Results truncated:</strong> Showing {data.total} of {data.totalAvailable} matching issues.
            <span className="text-xs text-amber-600 ml-1">
              Add filters to your JQL query or set <code className="bg-amber-100 px-1 rounded">MAX_ISSUES_PER_QUERY</code> env var to increase the limit.
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            <strong>Error:</strong> {error}
            <p className="text-xs text-red-500 mt-1">
              Check your Jira server connection in{" "}
              <a href="/settings" className="text-red-700 underline font-medium">Settings</a>.
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-blue-200 border-t-blue-600 rounded-full" />
          </div>
        )}

        {/* AI Coach Panel */}
        {!loading && data && data.total > 0 && (
          <div className="mb-4">
            <AiCoachPanel
              context="Project Dashboard"
              data={data}
              prompts={[
                {
                  label: "Full Project Summary",
                  primary: true,
                  question: `Generate a comprehensive project summary covering ALL of the following. Be specific — reference ticket keys, assignees, dates, and epics.

1. **PROJECT STATUS OVERVIEW**: Overall health of the project. How many total issues, how many done vs in progress vs to do? What percentage is complete?

2. **EPIC-BY-EPIC BREAKDOWN**: For each epic, summarize:
   - Progress (done/total, % complete)
   - Current status and key in-progress work
   - Blockers or risks
   - Overdue or stale items

3. **WHAT'S BEEN DONE** (recently completed): List recently resolved items grouped by epic, in chronological order (newest first).

4. **WHAT'S IN PROGRESS**: All items currently being worked on, grouped by assignee, with status and due dates.

5. **WHAT'S COMING NEXT**: Upcoming work — items in To Do or backlog, ordered by priority and due date. Highlight anything due soon.

6. **RISKS & BLOCKERS**: Overdue items, stale items (no update in 7+ days), unassigned high-priority items, items with no due date.

7. **TEAM WORKLOAD**: Who is working on what, who is overloaded, who has capacity.

8. **RECOMMENDATIONS**: Top 5 actions to improve project health, with owners and urgency.

Format with clear headers and bullet points. This should serve as a complete project status report.`,
                },
                {
                  label: "Progress report",
                  question: "Summarize overall project progress. What percentage is done? Which epics are on track and which are behind? What are the key milestones achieved recently?",
                },
                {
                  label: "Risks & blockers",
                  question: "Identify all risks and blockers across the project. Which items are overdue, stale, or unassigned? What's the impact and what should be done?",
                },
                {
                  label: "Upcoming work",
                  question: "What work is coming up next? List items by priority and due date. What should the team focus on in the next sprint?",
                },
                {
                  label: "Epic health",
                  question: "Analyze the health of each epic. Which epics are on track, at risk, or behind schedule? Provide a progress percentage and key issues for each.",
                },
              ]}
            />
          </div>
        )}

        {/* Epic cards */}
        {!loading && filteredEpics && (
          <div className="space-y-4">
            {filteredEpics.map((epic) => (
              <EpicCard key={epic.key} epic={epic} jiraBaseUrl={jiraBaseUrl} />
            ))}
          </div>
        )}

        {/* Issues without epic */}
        {!loading && filteredNoEpic && filteredNoEpic.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-600">
                No Epic ({filteredNoEpic.length})
              </h3>
            </div>
            <div className="flex items-center gap-3 px-4 py-1.5 bg-gray-50 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
              <span className="w-20">Key</span>
              <span className="flex-1">Summary</span>
              <span className="max-w-[200px]">Flags</span>
              <span className="w-20 text-center">Status</span>
              <span className="w-16 text-right">Due</span>
              <span className="w-24 text-right">Assignee</span>
              <span className="w-14 text-right">Updated</span>
              <span className="w-8 text-center">Cmt</span>
            </div>
            {filteredNoEpic.map((issue) => (
              <IssueRow key={issue.key} issue={issue} jiraBaseUrl={jiraBaseUrl} />
            ))}
          </div>
        )}

        {!loading && data && data.total === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg mb-2">No issues found</p>
            <p className="text-sm">Try adjusting your JQL query</p>
          </div>
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
    </div>
  );
}
