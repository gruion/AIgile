"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import JqlBar from "../../components/JqlBar";
import AiCoachPanel from "../../components/AiCoachPanel";
import { fetchIssues, fetchDoR, fetchAnalytics } from "../../lib/api";
import { toast } from "../../components/Toaster";

const DEFAULT_JQL = process.env.NEXT_PUBLIC_DEFAULT_JQL || "project = TEAM ORDER BY status ASC, updated DESC";
const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || "http://localhost:9080";

// ─── Health thresholds ──────────────────────────────────

function healthColor(pct) {
  if (pct <= 10) return "green";
  if (pct <= 30) return "amber";
  return "red";
}

const COLOR_MAP = {
  green: { bg: "bg-green-50", border: "border-green-200", text: "text-green-800", badge: "bg-green-100 text-green-700", dot: "bg-green-500" },
  amber: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", badge: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  red: { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", badge: "bg-red-100 text-red-700", dot: "bg-red-500" },
};

function overallGrade(score) {
  if (score >= 80) return { label: "Healthy", color: "green" };
  if (score >= 50) return { label: "Needs Attention", color: "amber" };
  return { label: "Unhealthy", color: "red" };
}

// ─── Helpers ────────────────────────────────────────────

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function hasAcceptanceCriteria(description) {
  if (!description) return false;
  const lower = description.toLowerCase();
  return (
    lower.includes("ac:") ||
    lower.includes("acceptance criteria") ||
    lower.includes("given ") ||
    lower.includes("[ ]") ||
    lower.includes("[x]") ||
    /\*\s*\[.\]/.test(lower) ||
    lower.includes("checklist") ||
    lower.includes("definition of done")
  );
}

function isDescriptionTooShort(description) {
  if (!description) return true;
  return description.trim().length < 30;
}

function isOversized(issue) {
  const sp = issue.storyPoints || 0;
  if (sp >= 13) return true;
  if (issue.description && issue.description.length > 3000 && sp === 0) return true;
  return false;
}

// ─── Refinement need score ──────────────────────────────

function computeRefinementScore(issue) {
  let score = 0;
  if (isDescriptionTooShort(issue.description)) score += 3;
  if (!issue.assigneeName && !issue.assignee) score += 1;
  if (!issue.dueDate) score += 1;
  if (!issue.originalEstimate && !issue.storyPoints) score += 2;
  if (!hasAcceptanceCriteria(issue.description)) score += 2;
  if (isOversized(issue)) score += 2;
  if (daysSince(issue.created) > 60 && issue.statusCategory === "new") score += 1;
  return score;
}

function getMissingItems(issue) {
  const missing = [];
  if (isDescriptionTooShort(issue.description)) missing.push("Description");
  if (!issue.originalEstimate && !issue.storyPoints) missing.push("Estimate");
  if (!issue.dueDate) missing.push("Due Date");
  if (!issue.assigneeName && !issue.assignee) missing.push("Assignee");
  if (!hasAcceptanceCriteria(issue.description)) missing.push("Acceptance Criteria");
  if (isOversized(issue)) missing.push("Too Large");
  return missing;
}

// ─── Priority distribution analysis ────────────────────

function analyzePriorities(issues) {
  const dist = { Highest: 0, High: 0, Medium: 0, Low: 0, Lowest: 0 };
  for (const issue of issues) {
    const p = issue.priority || "Medium";
    if (dist[p] !== undefined) dist[p]++;
    else dist.Medium++;
  }
  const total = issues.length || 1;
  const highPct = Math.round(((dist.Highest + dist.High) / total) * 100);
  const isInflated = highPct > 30;
  return { dist, highPct, isInflated };
}

// ─── Stat card ──────────────────────────────────────────

function StatCard({ label, value, total, detail, invertColor }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const color = invertColor
    ? healthColor(100 - pct) // higher = worse when inverted
    : healthColor(pct);
  const c = COLOR_MAP[color];

  return (
    <div className={`rounded-xl border p-4 ${c.bg} ${c.border}`}>
      <div className="flex items-baseline justify-between">
        <span className={`text-2xl font-bold ${c.text}`}>{value}</span>
        {total > 0 && (
          <span className="text-xs font-medium text-gray-500">{pct}%</span>
        )}
      </div>
      <p className={`text-sm font-medium mt-1 ${c.text}`}>{label}</p>
      {detail && <p className="text-xs text-gray-500 mt-0.5">{detail}</p>}
    </div>
  );
}

// ─── Missing badge ──────────────────────────────────────

function MissingBadge({ label }) {
  const colors = {
    Description: "bg-red-100 text-red-700",
    Estimate: "bg-amber-100 text-amber-700",
    "Due Date": "bg-yellow-100 text-yellow-700",
    Assignee: "bg-gray-100 text-gray-600",
    "Acceptance Criteria": "bg-purple-100 text-purple-700",
    "Too Large": "bg-orange-100 text-orange-700",
  };
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${colors[label] || "bg-gray-100 text-gray-600"}`}>
      {label}
    </span>
  );
}

// ─── Priority badge ─────────────────────────────────────

function PriorityBadge({ priority }) {
  const colors = {
    Highest: "bg-red-100 text-red-700",
    High: "bg-orange-100 text-orange-700",
    Medium: "bg-yellow-100 text-yellow-700",
    Low: "bg-blue-100 text-blue-700",
    Lowest: "bg-gray-100 text-gray-500",
  };
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${colors[priority] || colors.Medium}`}>
      {priority || "Medium"}
    </span>
  );
}

// ─── AI Prompts ─────────────────────────────────────────

const AI_PROMPTS = [
  {
    label: "Full Backlog Health Audit",
    question:
      "Perform a comprehensive backlog health audit. Analyze the quality of each backlog item, identify what needs to be refined first, suggest story splitting for oversized items, and flag missing information. Prioritize your recommendations by impact on team velocity and sprint predictability.",
  },
  {
    label: "Story Splitting Suggestions",
    question:
      "Identify backlog items that are too large (high story points, vague descriptions, or multiple concerns in one ticket). For each, suggest how to split them into smaller, independently deliverable stories using patterns like workflow steps, business rule variations, data variations, or interface splits.",
  },
  {
    label: "Priority Rebalancing",
    question:
      "Analyze the priority distribution of this backlog. Is there priority inflation (too many High/Highest items)? Suggest which items should be reprioritized and why. Consider business value, dependencies, and risk when making recommendations.",
  },
  {
    label: "Refinement Session Agenda",
    question:
      "Based on the backlog health data, suggest an agenda for the next refinement session. Which items should we discuss first? Estimate how many items we can refine in a 1-hour session. Order by impact: items closest to being sprint-ready but missing one or two things should come first.",
  },
  {
    label: "Missing Requirements Audit",
    question:
      "Audit every backlog item for missing requirements. Check for: missing or vague descriptions, no acceptance criteria, no estimates, no assignee, no due date. Group findings by severity. For each item, suggest what specific information needs to be added and who should provide it.",
  },
  {
    label: "Backlog Grooming Priorities",
    question:
      "What should we groom first? Consider sprint proximity (items likely to be pulled into the next sprint), dependency chains (items blocking others), and readiness level (items almost ready vs. items needing major rework). Provide a prioritized grooming list with rationale.",
  },
];

// ─── Main Page ──────────────────────────────────────────

export default function BacklogRefinementPage() {
  const [jql, setJql] = useState(DEFAULT_JQL);
  const [inputJql, setInputJql] = useState(DEFAULT_JQL);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState("score");
  const [sortDir, setSortDir] = useState("desc");

  // ─── Data fetching ──────────────────────────────────

  const loadData = useCallback(async (query) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchIssues(query);
      // Flatten all issues from epics + noEpic
      const allIssues = [
        ...(result.epics || []).flatMap((e) =>
          (e.issues || []).map((i) => ({ ...i, epicKey: e.key, epicName: e.name }))
        ),
        ...(result.noEpic || []).map((i) => ({ ...i, epicKey: null, epicName: "No Epic" })),
      ];
      setIssues(allIssues);
      toast.success(`Loaded ${allIssues.length} issues for backlog analysis`);
    } catch (err) {
      setError(err.message);
      toast.error("Failed to load backlog: " + err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData(jql);
  }, [jql, loadData]);

  const handleSearch = useCallback((query) => {
    setJql(query);
  }, []);

  // ─── Computed: backlog items only ───────────────────

  const backlogItems = useMemo(() => {
    return issues.filter((i) => (i.statusCategory || "").toLowerCase() === "new");
  }, [issues]);

  // ─── Computed: health metrics ───────────────────────

  const healthStats = useMemo(() => {
    const total = backlogItems.length;
    if (total === 0) {
      return {
        total: 0,
        noDescription: 0,
        noEstimate: 0,
        noDueDate: 0,
        noAssignee: 0,
        noAcceptanceCriteria: 0,
        tooLarge: 0,
        stale: 0,
        priorityAnalysis: { dist: {}, highPct: 0, isInflated: false },
        overallScore: 100,
      };
    }

    let noDescription = 0;
    let noEstimate = 0;
    let noDueDate = 0;
    let noAssignee = 0;
    let noAcceptanceCriteria = 0;
    let tooLarge = 0;
    let stale = 0;

    for (const item of backlogItems) {
      if (isDescriptionTooShort(item.description)) noDescription++;
      if (!item.originalEstimate && !item.storyPoints) noEstimate++;
      if (!item.dueDate) noDueDate++;
      if (!item.assigneeName && !item.assignee) noAssignee++;
      if (!hasAcceptanceCriteria(item.description)) noAcceptanceCriteria++;
      if (isOversized(item)) tooLarge++;
      if (daysSince(item.created) > 60 && daysSince(item.updated) > 30) stale++;
    }

    const priorityAnalysis = analyzePriorities(backlogItems);

    // Overall score: 100 minus penalties for each category
    const penalties = [
      (noDescription / total) * 20,
      (noEstimate / total) * 20,
      (noAcceptanceCriteria / total) * 20,
      (tooLarge / total) * 15,
      (stale / total) * 10,
      (priorityAnalysis.isInflated ? 10 : 0),
      (noDueDate / total) * 5,
      (noAssignee / total) * 5,
    ];
    const totalPenalty = penalties.reduce((a, b) => a + b, 0);
    const overallScore = Math.max(0, Math.round(100 - totalPenalty));

    return {
      total,
      noDescription,
      noEstimate,
      noDueDate,
      noAssignee,
      noAcceptanceCriteria,
      tooLarge,
      stale,
      priorityAnalysis,
      overallScore,
    };
  }, [backlogItems]);

  // ─── Computed: sorted table items ───────────────────

  const sortedItems = useMemo(() => {
    const scored = backlogItems.map((item) => ({
      ...item,
      refinementScore: computeRefinementScore(item),
      missingItems: getMissingItems(item),
      age: daysSince(item.created),
    }));

    return scored.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "score":
          cmp = a.refinementScore - b.refinementScore;
          break;
        case "key":
          cmp = (a.key || "").localeCompare(b.key || "");
          break;
        case "priority": {
          const order = { Highest: 0, High: 1, Medium: 2, Low: 3, Lowest: 4 };
          cmp = (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
          break;
        }
        case "age":
          cmp = a.age - b.age;
          break;
        case "missing":
          cmp = a.missingItems.length - b.missingItems.length;
          break;
        default:
          cmp = a.refinementScore - b.refinementScore;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [backlogItems, sortField, sortDir]);

  // ─── Sort handler ───────────────────────────────────

  const handleSort = useCallback(
    (field) => {
      if (sortField === field) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      } else {
        setSortField(field);
        setSortDir("desc");
      }
    },
    [sortField]
  );

  function SortHeader({ field, children }) {
    const active = sortField === field;
    return (
      <th
        className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2 cursor-pointer hover:text-gray-800 select-none"
        onClick={() => handleSort(field)}
      >
        {children}
        {active && (
          <span className="ml-1">{sortDir === "desc" ? "\u25BC" : "\u25B2"}</span>
        )}
      </th>
    );
  }

  // ─── AI data context ────────────────────────────────

  const aiData = useMemo(() => {
    const topItems = sortedItems.slice(0, 30).map((item) => ({
      key: item.key,
      summary: item.summary,
      priority: item.priority,
      status: item.status,
      assignee: item.assigneeName || item.assignee || null,
      age: item.age,
      storyPoints: item.storyPoints || null,
      hasDescription: !isDescriptionTooShort(item.description),
      hasEstimate: !!(item.originalEstimate || item.storyPoints),
      hasAcceptanceCriteria: hasAcceptanceCriteria(item.description),
      hasDueDate: !!item.dueDate,
      isOversized: isOversized(item),
      refinementScore: item.refinementScore,
      missing: item.missingItems,
    }));

    return {
      backlogHealth: {
        totalBacklogItems: healthStats.total,
        overallScore: healthStats.overallScore,
        noDescription: healthStats.noDescription,
        noEstimate: healthStats.noEstimate,
        noDueDate: healthStats.noDueDate,
        noAssignee: healthStats.noAssignee,
        noAcceptanceCriteria: healthStats.noAcceptanceCriteria,
        tooLarge: healthStats.tooLarge,
        staleItems: healthStats.stale,
        priorityInflated: healthStats.priorityAnalysis.isInflated,
        priorityDistribution: healthStats.priorityAnalysis.dist,
        highPriorityPercentage: healthStats.priorityAnalysis.highPct,
      },
      topItemsNeedingRefinement: topItems,
    };
  }, [sortedItems, healthStats]);

  // ─── Grade ──────────────────────────────────────────

  const grade = overallGrade(healthStats.overallScore);
  const gradeColors = COLOR_MAP[grade.color];

  // ─── Render ─────────────────────────────────────────

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">Backlog Refinement Coach</h1>
            {!loading && healthStats.total > 0 && (
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${gradeColors.badge}`}>
                <span className={`w-2 h-2 rounded-full ${gradeColors.dot}`} />
                {grade.label} ({healthStats.overallScore}/100)
              </div>
            )}
          </div>
          <JqlBar
            value={inputJql}
            onChange={setInputJql}
            onSubmit={handleSearch}
            placeholder="JQL to select which backlog to analyze..."
          />
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-gray-500 text-sm">Analyzing backlog health...</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="bg-white rounded-xl border border-red-200 p-8 text-center">
            <p className="text-red-600 font-medium mb-2">Failed to load backlog data</p>
            <p className="text-gray-500 text-sm">{error}</p>
            <button
              onClick={() => loadData(jql)}
              className="mt-4 text-sm text-blue-600 hover:text-blue-800 underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* AI Coach Panel */}
        {!loading && !error && healthStats.total > 0 && (
          <div className="mb-4">
            <AiCoachPanel
              context="Backlog Refinement Coach — analyzing backlog health, story readiness, and refinement priorities"
              data={aiData}
              prompts={AI_PROMPTS}
              title="Refinement Coach"
            />
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && healthStats.total === 0 && issues.length >= 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-800 mb-2">No Backlog Items Found</h2>
            <p className="text-gray-500 text-sm max-w-md mx-auto">
              No issues with status category &quot;To Do&quot; were found for this query.
              {issues.length > 0 && ` (${issues.length} total issues loaded, but none are in the backlog.)`}
              {" "}Try adjusting your JQL filter above.
            </p>
          </div>
        )}

        {/* ═══ MAIN CONTENT ═══ */}
        {!loading && !error && healthStats.total > 0 && (
          <>
            {/* ─── Overall Health Score ─────────────────── */}
            <div className={`rounded-xl border-2 p-6 text-center ${gradeColors.bg} ${gradeColors.border}`}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1 opacity-70">Backlog Health Score</p>
              <p className={`text-4xl font-bold ${gradeColors.text}`}>{healthStats.overallScore}</p>
              <p className={`text-sm mt-1 ${gradeColors.text}`}>
                {grade.label} &mdash; {healthStats.total} backlog item{healthStats.total !== 1 ? "s" : ""} analyzed
              </p>
              <p className="text-xs mt-2 opacity-60">
                Score reflects description quality, estimation coverage, acceptance criteria, sizing, and staleness
              </p>
            </div>

            {/* ─── Health Stats Grid ───────────────────── */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-4">Health Metrics</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  label="No Description"
                  value={healthStats.noDescription}
                  total={healthStats.total}
                  detail="Missing or very short description"
                  invertColor
                />
                <StatCard
                  label="No Estimate"
                  value={healthStats.noEstimate}
                  total={healthStats.total}
                  detail="No story points or time estimate"
                  invertColor
                />
                <StatCard
                  label="No Acceptance Criteria"
                  value={healthStats.noAcceptanceCriteria}
                  total={healthStats.total}
                  detail="No AC, Given/When/Then, or checklist"
                  invertColor
                />
                <StatCard
                  label="Oversized Items"
                  value={healthStats.tooLarge}
                  total={healthStats.total}
                  detail="13+ story points or epic-sized scope"
                  invertColor
                />
                <StatCard
                  label="Stale Items"
                  value={healthStats.stale}
                  total={healthStats.total}
                  detail="Created 60+ days ago, idle 30+ days"
                  invertColor
                />
                <StatCard
                  label="No Due Date"
                  value={healthStats.noDueDate}
                  total={healthStats.total}
                  detail="No target date set"
                  invertColor
                />
                <StatCard
                  label="No Assignee"
                  value={healthStats.noAssignee}
                  total={healthStats.total}
                  detail="Not assigned to anyone"
                  invertColor
                />
                <div className={`rounded-xl border p-4 ${healthStats.priorityAnalysis.isInflated ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
                  <div className="flex items-baseline justify-between">
                    <span className={`text-2xl font-bold ${healthStats.priorityAnalysis.isInflated ? "text-red-800" : "text-green-800"}`}>
                      {healthStats.priorityAnalysis.highPct}%
                    </span>
                    {healthStats.priorityAnalysis.isInflated && (
                      <span className="text-[10px] font-semibold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">Inflated</span>
                    )}
                  </div>
                  <p className={`text-sm font-medium mt-1 ${healthStats.priorityAnalysis.isInflated ? "text-red-800" : "text-green-800"}`}>
                    High + Highest Priority
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {Object.entries(healthStats.priorityAnalysis.dist)
                      .filter(([, v]) => v > 0)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(", ")}
                  </p>
                </div>
              </div>
            </div>

            {/* ─── Issues Table ─────────────────────────── */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-800">
                  Backlog Items by Refinement Need
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Sorted by refinement urgency score. Items missing more fields rank higher.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <SortHeader field="score">Score</SortHeader>
                      <SortHeader field="key">Key</SortHeader>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2">Summary</th>
                      <SortHeader field="priority">Priority</SortHeader>
                      <SortHeader field="missing">Missing</SortHeader>
                      <SortHeader field="age">Age</SortHeader>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2">Assignee</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sortedItems.map((item) => (
                      <tr key={item.key} className="hover:bg-gray-50 transition-colors">
                        {/* Score */}
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                              item.refinementScore >= 8
                                ? "bg-red-100 text-red-700"
                                : item.refinementScore >= 5
                                ? "bg-amber-100 text-amber-700"
                                : item.refinementScore >= 3
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-green-100 text-green-700"
                            }`}
                          >
                            {item.refinementScore}
                          </span>
                        </td>

                        {/* Key */}
                        <td className="px-3 py-2.5">
                          <a
                            href={`${JIRA_BASE_URL}/browse/${item.key}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-blue-600 hover:underline whitespace-nowrap"
                          >
                            {item.key}
                          </a>
                        </td>

                        {/* Summary */}
                        <td className="px-3 py-2.5">
                          <span className="text-sm text-gray-800 line-clamp-1">{item.summary}</span>
                          {item.epicName && item.epicName !== "No Epic" && (
                            <span className="block text-[10px] text-gray-400 mt-0.5">{item.epicName}</span>
                          )}
                        </td>

                        {/* Priority */}
                        <td className="px-3 py-2.5">
                          <PriorityBadge priority={item.priority} />
                        </td>

                        {/* Missing items */}
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {item.missingItems.length > 0 ? (
                              item.missingItems.map((m) => <MissingBadge key={m} label={m} />)
                            ) : (
                              <span className="text-[10px] text-green-600 font-medium">Ready</span>
                            )}
                          </div>
                        </td>

                        {/* Age */}
                        <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                          {item.age === Infinity ? "N/A" : `${item.age}d`}
                        </td>

                        {/* Assignee */}
                        <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                          {item.assigneeName || item.assignee || (
                            <span className="text-gray-300">Unassigned</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {sortedItems.length === 0 && (
                <div className="text-center py-8 text-sm text-gray-400">
                  No backlog items to display.
                </div>
              )}
            </div>

          </>
        )}
      </main>
    </div>
  );
}
