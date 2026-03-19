"use client";

import { useState, useEffect } from "react";
import { fetchSprintReview, fetchIssues } from "../../lib/api";
import AiCoachPanel from "../../components/AiCoachPanel";
import JqlBar from "../../components/JqlBar";
import { toast } from "../../components/Toaster";
import { useAppConfig } from "../../context/AppConfigContext";

const STATUS_BADGE = {
  done: "bg-green-100 text-green-700",
  indeterminate: "bg-blue-100 text-blue-700",
  new: "bg-gray-100 text-gray-600",
};

function formatDate(str) {
  if (!str) return "";
  return new Date(str).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function CompletionRing({ rate }) {
  const radius = 54;
  const stroke = 8;
  const normalizedRadius = radius - stroke / 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const offset = circumference - (rate / 100) * circumference;
  const color = rate >= 80 ? "#22c55e" : rate >= 50 ? "#3b82f6" : "#f59e0b";

  return (
    <div className="flex flex-col items-center">
      <svg height={radius * 2} width={radius * 2}>
        <circle
          stroke="#e5e7eb"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <circle
          stroke={color}
          fill="transparent"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference + " " + circumference}
          style={{ strokeDashoffset: offset, transition: "stroke-dashoffset 0.6s ease" }}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          transform={`rotate(-90 ${radius} ${radius})`}
        />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="text-2xl font-bold" fill="#1f2937">
          {Math.round(rate)}%
        </text>
      </svg>
      <span className="text-sm text-gray-500 mt-1">Completion</span>
    </div>
  );
}

function StatBadge({ label, value, color }) {
  return (
    <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${color}`}>
      <span className="text-2xl font-bold">{value}</span>
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

function ProgressBar({ done, inProgress, todo }) {
  const total = done + inProgress + todo;
  if (total === 0) return null;
  const pDone = (done / total) * 100;
  const pIP = (inProgress / total) * 100;
  return (
    <div className="w-full h-3 rounded-full bg-gray-200 overflow-hidden flex">
      <div className="bg-green-500 h-full transition-all" style={{ width: `${pDone}%` }} />
      <div className="bg-blue-500 h-full transition-all" style={{ width: `${pIP}%` }} />
    </div>
  );
}

function StatusBadge({ status, category }) {
  const cat = (category || "new").toLowerCase();
  const cls = STATUS_BADGE[cat] || STATUS_BADGE.new;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{status}</span>;
}

function EpicCard({ epic, defaultOpen, jiraBaseUrl }) {
  const [open, setOpen] = useState(defaultOpen);
  const pct = epic.total > 0 ? Math.round((epic.done / epic.total) * 100) : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-semibold text-gray-800 truncate">{epic.name || epic.key}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm text-gray-500">{epic.done}/{epic.total}</span>
          <div className="w-24 h-2 rounded-full bg-gray-200 overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-sm font-medium text-gray-600 w-10 text-right">{pct}%</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {(epic.issues || []).map((issue) => (
            <div key={issue.key} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-gray-50">
              <StatusBadge status={issue.status} category={issue.statusCategory} />
              <a
                href={`${jiraBaseUrl}/browse/${issue.key}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-blue-600 hover:underline shrink-0"
              >
                {issue.key}
              </a>
              <span className="text-gray-700 truncate">{issue.summary}</span>
              {issue.assignee && (
                <span className="ml-auto text-xs text-gray-400 shrink-0">{issue.assignee}</span>
              )}
            </div>
          ))}
          {(!epic.issues || epic.issues.length === 0) && (
            <p className="px-5 py-3 text-sm text-gray-400 italic">No issues in this epic.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ChecklistItem({ label, checked }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${checked ? "border-green-500 bg-green-500" : "border-gray-300 bg-white"}`}>
        {checked && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <span className={`text-sm ${checked ? "text-green-700 font-medium" : "text-gray-600"}`}>{label}</span>
    </div>
  );
}

const AI_PROMPTS = [
  {
    label: "Full Sprint Review",
    primary: true,
    question: "As an Agile Coach, provide a comprehensive sprint review analysis. Cover: 1) Sprint goal achievement assessment, 2) What was delivered (reference specific tickets), 3) What wasn't delivered and why, 4) Stakeholder value delivered, 5) Demo readiness assessment, 6) Carry-over items and their impact on next sprint, 7) Key metrics (velocity, completion rate, quality), 8) Recommendations for the team.",
  },
  { label: "Demo talking points", question: "Generate structured demo talking points for stakeholders. For each completed feature/story, provide: what was built, why it matters (business value), and how to demo it. Order by business impact." },
  { label: "Carry-over analysis", question: "Analyze the incomplete items with coaching insights: For each, assess WHY it wasn't finished (scope creep? blocked? underestimated?), what the impact is, and whether it should be prioritized in the next sprint or sent back to the backlog." },
  { label: "Sprint retrospective seeds", question: "Based on the sprint data, identify 5 specific discussion topics for the retrospective. For each, provide the evidence from the sprint (specific tickets, metrics) and a coaching question to start the conversation." },
  { label: "Velocity & trend coaching", question: "Analyze the sprint's velocity and completion rate. How does it compare to what was planned? What patterns suggest about the team's estimation accuracy? Provide coaching advice on improving predictability." },
];

export default function SprintReviewPage() {
  const { defaultJql, jiraBaseUrl } = useAppConfig();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");
  const [ticketData, setTicketData] = useState(null);

  useEffect(() => {
    if (defaultJql) {
      setJql((prev) => prev || defaultJql);
      setInputJql((prev) => prev || defaultJql);
    }
  }, [defaultJql]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!jql) { setLoading(false); return; }
      try {
        setLoading(true);
        setError(null);
        const result = await fetchSprintReview(jql || undefined);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          toast.error("Failed to load sprint review data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [jql]);

  // Load ticket context for AI analysis
  useEffect(() => {
    if (jql) fetchIssues(jql).then(setTicketData).catch(() => {});
  }, [jql]);

  if (!loading && !data && !error && !jql) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
            <JqlBar
              value={inputJql}
              onChange={setInputJql}
              onSubmit={(q) => setJql(q)}
              placeholder="Select tickets for sprint review context..."
            />
          </div>
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
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-500 text-sm">Loading sprint review...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-xl border border-red-200 p-8 max-w-md text-center">
          <p className="text-red-600 font-medium mb-2">Error loading sprint data</p>
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!data || !data.sprint) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-xl border border-gray-200 p-10 max-w-md text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">No Active Sprint</h2>
          <p className="text-gray-500 text-sm">There is no active sprint to review right now. Start a sprint in Jira and come back here for the review dashboard.</p>
        </div>
      </div>
    );
  }

  const { sprint, stats, epicGroups, issues } = data;
  const hasBlockers = (issues || []).some((i) => (i.labels || []).includes("blocker") || (i.priority || "").toLowerCase() === "highest");
  const allDone = stats.completionRate === 100;
  const noBlockers = !hasBlockers;
  const goalAchieved = allDone && sprint.goal;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

        {/* ─── JQL Bar ─────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-2">Load additional ticket context for AI analysis:</p>
          <JqlBar
            value={inputJql}
            onChange={setInputJql}
            onSubmit={(q) => setJql(q)}
            placeholder="Select tickets for sprint review context..."
          />
        </div>

        {/* ─── AI Coach ────────────────────────────────── */}
        <div className="mb-4">
          <AiCoachPanel
            context="Sprint Review / Demo Readiness"
            data={{ ...data, ticketContext: ticketData ? { total: ticketData.total, epicCount: ticketData.epics?.length } : null }}
            prompts={AI_PROMPTS}
          />
        </div>

        {/* ─── Header ──────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{sprint.name}</h1>
              {sprint.goal && (
                <p className="text-gray-500 mt-1">{sprint.goal}</p>
              )}
            </div>
            <div className="text-sm text-gray-400 shrink-0">
              {formatDate(sprint.startDate)} &mdash; {formatDate(sprint.endDate)}
            </div>
          </div>
        </div>

        {/* ─── Progress Section ────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-5">Sprint Progress</h2>
          <div className="flex flex-col md:flex-row items-center gap-8">
            <CompletionRing rate={stats.completionRate || 0} />
            <div className="flex-1 space-y-5 w-full">
              <div className="flex flex-wrap gap-3">
                <StatBadge label="Done" value={stats.done} color="bg-green-50 text-green-700" />
                <StatBadge label="In Progress" value={stats.inProgress} color="bg-blue-50 text-blue-700" />
                <StatBadge label="To Do" value={stats.todo} color="bg-gray-100 text-gray-600" />
                <StatBadge label="Total" value={stats.total} color="bg-indigo-50 text-indigo-700" />
              </div>
              <ProgressBar done={stats.done} inProgress={stats.inProgress} todo={stats.todo} />
              <div className="flex gap-4 text-xs text-gray-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Done</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> In Progress</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block" /> To Do</span>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Sprint Goal ─────────────────────────────── */}
        {sprint.goal && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${allDone ? "bg-green-100" : "bg-amber-100"}`}>
                {allDone ? (
                  <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Sprint Goal</h2>
                <p className="text-gray-600 mt-1">{sprint.goal}</p>
              </div>
            </div>
          </div>
        )}

        {/* ─── By Epic ──────────────────────────────────── */}
        {epicGroups && epicGroups.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">By Epic</h2>
            <div className="space-y-3">
              {epicGroups.map((epic, idx) => (
                <EpicCard key={epic.key || idx} epic={epic} defaultOpen={idx === 0} jiraBaseUrl={jiraBaseUrl} />
              ))}
            </div>
          </div>
        )}

        {/* ─── Demo Readiness Checklist ─────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Demo Readiness Checklist</h2>
          <div className="space-y-1">
            <ChecklistItem label="All stories in Done status" checked={allDone} />
            <ChecklistItem label="No open blockers" checked={noBlockers} />
            <ChecklistItem label="Sprint goal achieved" checked={goalAchieved} />
            <ChecklistItem label="Demo notes prepared" checked={false} />
          </div>
          {allDone && noBlockers ? (
            <div className="mt-4 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm font-medium">
              Looking good! The sprint appears ready for demo.
            </div>
          ) : (
            <div className="mt-4 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
              Some items still need attention before the demo.
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
