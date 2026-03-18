"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { fetchAnalytics } from "../../lib/api";

const DEFAULT_JQL = process.env.NEXT_PUBLIC_DEFAULT_JQL || "project = TEAM ORDER BY status ASC, updated DESC";
const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || "http://localhost:9080";

const STATUS_CAT_COLORS = {
  new: "bg-gray-200",
  indeterminate: "bg-blue-400",
  done: "bg-green-400",
};

const QUALITY_COLORS = {
  excellent: { bg: "bg-green-100", text: "text-green-700", bar: "bg-green-500" },
  good: { bg: "bg-blue-100", text: "text-blue-700", bar: "bg-blue-500" },
  fair: { bg: "bg-amber-100", text: "text-amber-700", bar: "bg-amber-500" },
  poor: { bg: "bg-red-100", text: "text-red-700", bar: "bg-red-500" },
};

function qualityGrade(score) {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  return "poor";
}

function BarChart({ data, maxVal, colorFn }) {
  const max = maxVal || Math.max(...Object.values(data), 1);
  return (
    <div className="space-y-1.5">
      {Object.entries(data).map(([label, value]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-12 text-right shrink-0">{label}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${colorFn ? colorFn(label) : "bg-blue-500"}`}
              style={{ width: `${Math.max((value / max) * 100, value > 0 ? 2 : 0)}%` }}
            />
          </div>
          <span className="text-xs font-medium text-gray-700 w-8">{value}</span>
        </div>
      ))}
    </div>
  );
}

function HorizontalBar({ value, max, color = "bg-blue-500" }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${Math.max(pct, value > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}

function ScoreRing({ score, size = 80 }) {
  const grade = qualityGrade(score);
  const circumference = 2 * Math.PI * 34;
  const offset = circumference - (score / 100) * circumference;
  const colors = {
    excellent: "#22c55e",
    good: "#3b82f6",
    fair: "#f59e0b",
    poor: "#ef4444",
  };

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size/2} cy={size/2} r="34" fill="none" stroke="#e5e7eb" strokeWidth="6" />
        <circle
          cx={size/2} cy={size/2} r="34" fill="none"
          stroke={colors[grade]}
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold text-gray-800">{score}</span>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [jql, setJql] = useState(DEFAULT_JQL);
  const [inputJql, setInputJql] = useState(DEFAULT_JQL);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [qualityExpanded, setQualityExpanded] = useState(null);

  const loadData = async (query) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAnalytics(query);
      setData(result);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData(jql);
  }, [jql]);

  const handleSearch = (e) => {
    e.preventDefault();
    setJql(inputJql);
  };

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "quality", label: "Quality Scores" },
    { key: "wip", label: "Aging WIP" },
    { key: "cycle", label: "Cycle Time" },
    { key: "team", label: "Team Workload" },
    { key: "stale", label: "Stale Tickets" },
  ];

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <h1 className="text-lg font-bold text-gray-900">Jira Dashboard</h1>
              <nav className="flex items-center gap-1 text-sm">
                <Link href="/" className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors">
                  Dashboard
                </Link>
                <Link href="/insights" className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors">
                  Insights
                </Link>
                <Link href="/gantt" className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors">
                  Gantt
                </Link>
                <Link href="/analyze" className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors">
                  Analyze
                </Link>
                <span className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm">
                  Analytics
                </span>
                <Link href="/settings" className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors">
                  Settings
                </Link>
              </nav>
            </div>
            <button
              onClick={() => loadData(jql)}
              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-md"
            >
              Refresh
            </button>
          </div>

          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={inputJql}
              onChange={(e) => setInputJql(e.target.value)}
              placeholder="Enter JQL query..."
              className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 font-mono"
            />
            <button type="submit" className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg">
              Analyze
            </button>
          </form>

          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  activeTab === t.key
                    ? "bg-blue-600 text-white"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {t.label}
              </button>
            ))}
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
            {/* ═══ OVERVIEW TAB ═══ */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                {/* KPI Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                  {[
                    { label: "Total", value: data.total, bg: "bg-gray-50" },
                    { label: "In Progress", value: data.wipCount, bg: "bg-blue-50", color: "text-blue-700" },
                    { label: "Avg Quality", value: `${data.avgQuality}%`, bg: "bg-purple-50", color: "text-purple-700" },
                    { label: "Avg Cycle", value: `${data.cycleTime.avg}d`, bg: "bg-indigo-50", color: "text-indigo-700" },
                    { label: "Overdue", value: data.dueDateCompliance.overdueActive, bg: "bg-red-50", color: "text-red-700" },
                    { label: "Stale", value: data.staleIssues.length, bg: "bg-amber-50", color: "text-amber-700" },
                    { label: "Unassigned", value: data.unassignedActive, bg: "bg-purple-50", color: "text-purple-700" },
                  ].map((kpi) => (
                    <div key={kpi.label} className={`${kpi.bg} rounded-xl border border-gray-200/50 px-4 py-3`}>
                      <div className={`text-xl font-bold ${kpi.color || "text-gray-800"}`}>{kpi.value}</div>
                      <div className="text-xs text-gray-500">{kpi.label}</div>
                    </div>
                  ))}
                </div>

                {/* Overview grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Quality Distribution */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="text-sm font-semibold text-gray-800 mb-4">Ticket Quality Distribution</h3>
                    <div className="flex items-center gap-6">
                      <ScoreRing score={data.avgQuality} />
                      <div className="flex-1 space-y-2">
                        {Object.entries(data.qualityDistribution).map(([grade, count]) => (
                          <div key={grade} className="flex items-center gap-2">
                            <span className={`text-xs w-16 capitalize ${QUALITY_COLORS[grade].text}`}>{grade}</span>
                            <HorizontalBar value={count} max={data.total} color={QUALITY_COLORS[grade].bar} />
                            <span className="text-xs font-medium text-gray-700 w-8">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Status Distribution */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="text-sm font-semibold text-gray-800 mb-4">Status Distribution</h3>
                    <div className="space-y-2">
                      {data.statusDistribution.map((s) => (
                        <div key={s.name} className="flex items-center gap-2">
                          <span className="text-xs text-gray-600 w-28 truncate">{s.name}</span>
                          <HorizontalBar
                            value={s.count}
                            max={data.total}
                            color={STATUS_CAT_COLORS[s.category] || "bg-gray-400"}
                          />
                          <span className="text-xs font-medium text-gray-700 w-8">{s.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Priority Distribution */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="text-sm font-semibold text-gray-800 mb-3">
                      Priority Distribution
                      {data.priorityInflation > 30 && (
                        <span className="ml-2 text-xs font-normal text-red-500">
                          {data.priorityInflation}% high/highest — priority inflation!
                        </span>
                      )}
                    </h3>
                    <div className="space-y-2">
                      {data.priorityDistribution.map((p) => {
                        const color = p.name === "Highest" ? "bg-red-500"
                          : p.name === "High" ? "bg-orange-400"
                          : p.name === "Medium" ? "bg-yellow-400"
                          : p.name === "Low" ? "bg-blue-400"
                          : "bg-gray-400";
                        return (
                          <div key={p.name} className="flex items-center gap-2">
                            <span className="text-xs text-gray-600 w-20">{p.name}</span>
                            <HorizontalBar value={p.count} max={data.total} color={color} />
                            <span className="text-xs font-medium text-gray-700 w-8">{p.count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Due Date Compliance */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="text-sm font-semibold text-gray-800 mb-3">Due Date Compliance</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center">
                        <div className="text-3xl font-bold text-gray-800">
                          {data.dueDateCompliance.complianceRate !== null
                            ? `${data.dueDateCompliance.complianceRate}%`
                            : "N/A"}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">On-time completion rate</div>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">With due date</span>
                          <span className="font-medium">{data.dueDateCompliance.totalWithDueDate}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Completed on time</span>
                          <span className="font-medium text-green-600">{data.dueDateCompliance.completedOnTime}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Overdue (active)</span>
                          <span className="font-medium text-red-600">{data.dueDateCompliance.overdueActive}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ QUALITY TAB ═══ */}
            {activeTab === "quality" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-gray-800">
                    Ticket Quality Scores
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      Average: {data.avgQuality}%
                    </span>
                  </h2>
                  <div className="flex gap-2 text-xs">
                    {Object.entries(data.qualityDistribution).map(([grade, count]) => (
                      <span key={grade} className={`px-2 py-1 rounded ${QUALITY_COLORS[grade].bg} ${QUALITY_COLORS[grade].text}`}>
                        {grade}: {count}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <span className="w-8 text-center">Score</span>
                    <span className="w-20">Key</span>
                    <span className="flex-1">Summary</span>
                    <span className="w-20 text-center">Status</span>
                    <span className="w-20">Priority</span>
                    <span className="w-24">Assignee</span>
                    <span className="w-40">Missing</span>
                  </div>
                  {data.qualityScores.map((ticket) => {
                    const grade = qualityGrade(ticket.qualityScore);
                    const missing = Object.entries(ticket.breakdown)
                      .filter(([, v]) => v.status !== "ok")
                      .map(([k, v]) => ({ field: k, status: v.status }));

                    return (
                      <div key={ticket.key}>
                        <div
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/50 cursor-pointer border-b border-gray-50"
                          onClick={() => setQualityExpanded(qualityExpanded === ticket.key ? null : ticket.key)}
                        >
                          <div className="w-8 text-center">
                            <span className={`inline-block text-xs font-bold px-1.5 py-0.5 rounded ${QUALITY_COLORS[grade].bg} ${QUALITY_COLORS[grade].text}`}>
                              {ticket.qualityScore}
                            </span>
                          </div>
                          <a
                            href={`${JIRA_BASE_URL}/browse/${ticket.key}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-mono text-blue-600 hover:underline w-20"
                          >
                            {ticket.key}
                          </a>
                          <p className="flex-1 text-sm text-gray-800 truncate">{ticket.summary}</p>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 w-20 text-center truncate">
                            {ticket.status}
                          </span>
                          <span className="text-xs text-gray-500 w-20">{ticket.priority}</span>
                          <span className="text-xs text-gray-500 w-24 truncate">{ticket.assigneeName || "—"}</span>
                          <div className="w-40 flex flex-wrap gap-1">
                            {missing.slice(0, 3).map((m) => (
                              <span key={m.field} className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600">
                                {m.field}
                              </span>
                            ))}
                            {missing.length > 3 && (
                              <span className="text-[10px] text-gray-400">+{missing.length - 3}</span>
                            )}
                          </div>
                        </div>

                        {/* Expanded quality breakdown */}
                        {qualityExpanded === ticket.key && (
                          <div className="px-4 pb-3 bg-gray-50/50">
                            <div className="grid grid-cols-4 gap-2 ml-8">
                              {Object.entries(ticket.breakdown).map(([field, info]) => (
                                <div
                                  key={field}
                                  className={`text-xs px-2 py-1.5 rounded border ${
                                    info.status === "ok"
                                      ? "bg-green-50 border-green-200 text-green-700"
                                      : info.status === "missing"
                                        ? "bg-red-50 border-red-200 text-red-600"
                                        : "bg-amber-50 border-amber-200 text-amber-700"
                                  }`}
                                >
                                  <span className="font-medium capitalize">{field}</span>
                                  <span className="ml-1">({info.score}/{info.max})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ═══ AGING WIP TAB ═══ */}
            {activeTab === "wip" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-gray-800">
                    Aging Work In Progress
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      {data.wipCount} items in progress
                    </span>
                  </h2>
                </div>

                {/* WIP Aging Chart */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-4">Age Distribution</h3>
                  <BarChart
                    data={data.wipBuckets}
                    colorFn={(label) => {
                      if (label === "2m+" || label === "1-2m") return "bg-red-500";
                      if (label === "2-4w") return "bg-orange-400";
                      if (label === "1-2w") return "bg-amber-400";
                      return "bg-blue-500";
                    }}
                  />
                </div>

                {/* WIP Table */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <span className="w-10 text-center">Age</span>
                    <span className="w-20">Key</span>
                    <span className="flex-1">Summary</span>
                    <span className="w-24">Status</span>
                    <span className="w-20">Priority</span>
                    <span className="w-24">Assignee</span>
                    <span className="w-16 text-right">Last Update</span>
                  </div>
                  {data.wipIssues.map((issue) => {
                    const ageColor = issue.ageDays > 60 ? "text-red-600 bg-red-50"
                      : issue.ageDays > 28 ? "text-orange-600 bg-orange-50"
                      : issue.ageDays > 14 ? "text-amber-600 bg-amber-50"
                      : "text-blue-600 bg-blue-50";

                    return (
                      <div key={issue.key} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/50 border-b border-gray-50">
                        <span className={`w-10 text-center text-xs font-bold px-1.5 py-0.5 rounded ${ageColor}`}>
                          {issue.ageDays}d
                        </span>
                        <a
                          href={`${JIRA_BASE_URL}/browse/${issue.key}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono text-blue-600 hover:underline w-20"
                        >
                          {issue.key}
                        </a>
                        <p className="flex-1 text-sm text-gray-800 truncate">{issue.summary}</p>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 w-24 text-center truncate">
                          {issue.status}
                        </span>
                        <span className="text-xs text-gray-500 w-20">{issue.priority}</span>
                        <span className="text-xs text-gray-500 w-24 truncate">{issue.assigneeName || "—"}</span>
                        <span className="text-[10px] text-gray-400 w-16 text-right">
                          {issue.daysSinceUpdate === 0 ? "today" : `${issue.daysSinceUpdate}d ago`}
                        </span>
                      </div>
                    );
                  })}
                  {data.wipIssues.length === 0 && (
                    <div className="text-center py-8 text-gray-400 text-sm">No items currently in progress</div>
                  )}
                </div>
              </div>
            )}

            {/* ═══ CYCLE TIME TAB ═══ */}
            {activeTab === "cycle" && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                    <div className="text-3xl font-bold text-indigo-600">{data.cycleTime.avg}d</div>
                    <div className="text-xs text-gray-500 mt-1">Average Cycle Time</div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                    <div className="text-3xl font-bold text-indigo-600">{data.cycleTime.median}d</div>
                    <div className="text-xs text-gray-500 mt-1">Median Cycle Time</div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                    <div className="text-3xl font-bold text-gray-700">{data.cycleTime.sampleSize}</div>
                    <div className="text-xs text-gray-500 mt-1">Completed Issues</div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-4">Cycle Time Distribution</h3>
                  <BarChart
                    data={data.cycleTime.buckets}
                    colorFn={(label) => {
                      if (label === "1m+") return "bg-red-500";
                      if (label === "2-4w") return "bg-orange-400";
                      if (label === "1-2w") return "bg-amber-400";
                      return "bg-green-500";
                    }}
                  />
                  <p className="text-xs text-gray-400 mt-3">
                    Cycle time = created date to last update (for completed issues). Approximate — Jira doesn&apos;t expose exact completion dates via REST API.
                  </p>
                </div>
              </div>
            )}

            {/* ═══ TEAM WORKLOAD TAB ═══ */}
            {activeTab === "team" && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-gray-800">Team Workload</h2>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <span className="w-36">Person</span>
                    <span className="w-12 text-center">Total</span>
                    <span className="flex-1">Distribution</span>
                    <span className="w-12 text-center">To Do</span>
                    <span className="w-12 text-center">WIP</span>
                    <span className="w-12 text-center">Done</span>
                    <span className="w-16 text-center">Overdue</span>
                  </div>
                  {data.teamWorkload.map((person) => {
                    const maxTotal = data.teamWorkload[0]?.total || 1;
                    return (
                      <div key={person.name} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/50 border-b border-gray-50">
                        <span className="text-sm text-gray-800 w-36 truncate font-medium">{person.name}</span>
                        <span className="text-xs font-bold text-gray-700 w-12 text-center">{person.total}</span>
                        <div className="flex-1 flex h-4 rounded-full overflow-hidden bg-gray-100">
                          {person.done > 0 && (
                            <div className="bg-green-400 h-full" style={{ width: `${(person.done / maxTotal) * 100}%` }} title={`Done: ${person.done}`} />
                          )}
                          {person.inProgress > 0 && (
                            <div className="bg-blue-400 h-full" style={{ width: `${(person.inProgress / maxTotal) * 100}%` }} title={`In Progress: ${person.inProgress}`} />
                          )}
                          {person.todo > 0 && (
                            <div className="bg-gray-300 h-full" style={{ width: `${(person.todo / maxTotal) * 100}%` }} title={`To Do: ${person.todo}`} />
                          )}
                        </div>
                        <span className="text-xs text-gray-500 w-12 text-center">{person.todo}</span>
                        <span className="text-xs text-blue-600 w-12 text-center">{person.inProgress}</span>
                        <span className="text-xs text-green-600 w-12 text-center">{person.done}</span>
                        <span className={`text-xs w-16 text-center font-medium ${person.overdue > 0 ? "text-red-600" : "text-gray-400"}`}>
                          {person.overdue || "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ═══ STALE TICKETS TAB ═══ */}
            {activeTab === "stale" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-gray-800">
                    Stale Tickets
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      {data.staleIssues.length} issues with no update in 7+ days
                    </span>
                  </h2>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <span className="w-16 text-center">Stale</span>
                    <span className="w-20">Key</span>
                    <span className="flex-1">Summary</span>
                    <span className="w-24">Status</span>
                    <span className="w-20">Priority</span>
                    <span className="w-24">Assignee</span>
                  </div>
                  {data.staleIssues.map((issue) => {
                    const staleColor = issue.daysSinceUpdate >= 30 ? "text-red-600 bg-red-50"
                      : issue.daysSinceUpdate >= 14 ? "text-orange-600 bg-orange-50"
                      : "text-amber-600 bg-amber-50";

                    return (
                      <div key={issue.key} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/50 border-b border-gray-50">
                        <span className={`w-16 text-center text-xs font-bold px-1.5 py-0.5 rounded ${staleColor}`}>
                          {issue.daysSinceUpdate}d
                        </span>
                        <a
                          href={`${JIRA_BASE_URL}/browse/${issue.key}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono text-blue-600 hover:underline w-20"
                        >
                          {issue.key}
                        </a>
                        <p className="flex-1 text-sm text-gray-800 truncate">{issue.summary}</p>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 w-24 text-center truncate">
                          {issue.status}
                        </span>
                        <span className="text-xs text-gray-500 w-20">{issue.priority}</span>
                        <span className="text-xs text-gray-500 w-24 truncate">{issue.assigneeName || "—"}</span>
                      </div>
                    );
                  })}
                  {data.staleIssues.length === 0 && (
                    <div className="text-center py-8 text-gray-400 text-sm">No stale tickets found</div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
