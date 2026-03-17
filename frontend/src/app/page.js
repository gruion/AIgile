"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import StatsBar from "../components/StatsBar";
import EpicCard from "../components/EpicCard";
import IssueRow from "../components/IssueRow";
import { fetchIssues } from "../lib/api";

const DEFAULT_JQL = "project = TEAM ORDER BY status ASC, updated DESC";
const JIRA_BASE_URL = "http://localhost:9080";

export default function Home() {
  const [jql, setJql] = useState(DEFAULT_JQL);
  const [inputJql, setInputJql] = useState(DEFAULT_JQL);
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
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setJql(inputJql);
  };

  useEffect(() => {
    loadData(jql);
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
            <div className="flex items-center gap-4">
              <h1 className="text-lg font-bold text-gray-900">Jira Dashboard</h1>
              <nav className="flex items-center gap-1 text-sm">
                <span className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm">
                  Dashboard
                </span>
                <Link
                  href="/insights"
                  className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  Insights
                </Link>
                <Link
                  href="/gantt"
                  className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  Gantt
                </Link>
              </nav>
              {data && (
                <span className="text-xs text-gray-400">{data.total} issues</span>
              )}
            </div>
            <div className="flex items-center gap-2">
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
                href={JIRA_BASE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md"
              >
                Open Jira
              </a>
            </div>
          </div>

          {/* JQL Search */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={inputJql}
              onChange={(e) => setInputJql(e.target.value)}
              placeholder="Enter JQL query..."
              className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 font-mono"
            />
            <button
              type="submit"
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
            >
              Search
            </button>
          </form>

          {/* Quick filters */}
          <div className="flex gap-1 mt-3">
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

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            <strong>Error:</strong> {error}
            <p className="text-xs text-red-500 mt-1">
              Make sure Jira is running at {JIRA_BASE_URL} and the API credentials
              are configured in .env
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-blue-200 border-t-blue-600 rounded-full" />
          </div>
        )}

        {/* Epic cards */}
        {!loading && filteredEpics && (
          <div className="space-y-4">
            {filteredEpics.map((epic) => (
              <EpicCard key={epic.key} epic={epic} jiraBaseUrl={JIRA_BASE_URL} />
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
              <IssueRow key={issue.key} issue={issue} jiraBaseUrl={JIRA_BASE_URL} />
            ))}
          </div>
        )}

        {!loading && data && data.total === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg mb-2">No issues found</p>
            <p className="text-sm">Try adjusting your JQL query</p>
          </div>
        )}
      </main>
    </div>
  );
}
