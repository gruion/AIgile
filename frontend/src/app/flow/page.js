"use client";

import { useState, useEffect, useMemo } from "react";
import {
  fetchSprints,
  fetchBurndown,
  fetchVelocity,
  fetchCFD,
  fetchCycleTime,
  fetchFlowMetrics,
} from "../../lib/api";
import AiCoachPanel from "../../components/AiCoachPanel";
import JqlBar from "../../components/JqlBar";
import { toast } from "../../components/Toaster";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TABS = ["Burndown", "Velocity", "CFD", "Cycle Time", "Flow Overview"];

function fmt(n) {
  return n == null ? "–" : Number(n).toFixed(1).replace(/\.0$/, "");
}

function shortDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex flex-col gap-0.5">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span className="text-xl font-bold text-gray-900">{value}</span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BURNDOWN TAB
// ---------------------------------------------------------------------------

function BurndownTab({ jql }) {
  const [sprints, setSprints] = useState([]);
  const [sprintId, setSprintId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchSprints()
      .then((res) => {
        const list = res?.sprints || [];
        setSprints(list);
        if (list.length) setSprintId(list[0].id);
      })
      .catch(() => toast.error("Failed to load sprints"));
  }, []);

  useEffect(() => {
    if (!sprintId) return;
    setLoading(true);
    fetchBurndown(sprintId, jql)
      .then((d) => setData(d))
      .catch(() => toast.error("Failed to load burndown"))
      .finally(() => setLoading(false));
  }, [sprintId, jql]);

  const chartPoints = data?.daily || [];
  const totalPoints = data?.totalPoints ?? 0;
  const lastPoint = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : {};
  const completed = lastPoint.completed ?? 0;
  const remaining = lastPoint.remaining ?? 0;
  const scopeChanges = 0; // not tracked by backend yet

  // SVG dimensions
  const W = 700,
    H = 320,
    PAD = 50;

  const maxY = useMemo(() => {
    const vals = chartPoints.map((p) => Math.max(p.ideal ?? 0, p.remaining ?? 0));
    return Math.max(totalPoints, ...vals, 1);
  }, [chartPoints, totalPoints]);

  function x(i) {
    if (chartPoints.length <= 1) return PAD;
    return PAD + (i / (chartPoints.length - 1)) * (W - PAD * 2);
  }
  function y(v) {
    return H - PAD - ((v ?? 0) / maxY) * (H - PAD * 2);
  }

  const idealLine = chartPoints.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.ideal)}`).join(" ");
  const remainingLine = chartPoints.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.remaining)}`).join(" ");
  const completedArea =
    chartPoints.length > 0
      ? `M${x(0)},${y(0)} ` +
        chartPoints.map((p, i) => `L${x(i)},${y(p.completed ?? 0)}`).join(" ") +
        ` L${x(chartPoints.length - 1)},${y(0)} Z`
      : "";

  const prompts = [
    {
      label: "Explain this burndown",
      question: "What does this burndown chart tell us about the sprint? Are we on track?",
    },
    {
      label: "Identify risks",
      question: "Based on the burndown data, what risks do you see? Will we hit our sprint commitment?",
    },
    {
      label: "Improvement tips",
      question: "How can we improve our sprint execution based on this burndown pattern?",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Sprint selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Sprint</label>
        <select
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          value={sprintId ?? ""}
          onChange={(e) => setSprintId(e.target.value)}
        >
          {sprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <AiCoachPanel context="Sprint Burndown Chart" data={data} prompts={prompts} />

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>
      ) : (
        <>
          {/* Chart */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <g key={f}>
                  <line
                    x1={PAD}
                    y1={y(maxY * f)}
                    x2={W - PAD}
                    y2={y(maxY * f)}
                    stroke="#e5e7eb"
                    strokeWidth="1"
                  />
                  <text x={PAD - 8} y={y(maxY * f) + 4} textAnchor="end" className="text-[10px]" fill="#9ca3af">
                    {fmt(maxY * f)}
                  </text>
                </g>
              ))}

              {/* X-axis labels */}
              {chartPoints.map((p, i) =>
                i % Math.max(1, Math.floor(chartPoints.length / 7)) === 0 ? (
                  <text key={i} x={x(i)} y={H - 12} textAnchor="middle" className="text-[10px]" fill="#9ca3af">
                    {shortDate(p.date)}
                  </text>
                ) : null
              )}

              {/* Completed area */}
              {completedArea && <path d={completedArea} fill="#bbf7d0" opacity="0.6" />}

              {/* Ideal line */}
              {idealLine && <path d={idealLine} fill="none" stroke="#9ca3af" strokeWidth="2" strokeDasharray="6 4" />}

              {/* Remaining line */}
              {remainingLine && <path d={remainingLine} fill="none" stroke="#3b82f6" strokeWidth="2.5" />}

              {/* Data point dots */}
              {chartPoints.map((p, i) => (
                <circle key={i} cx={x(i)} cy={y(p.remaining)} r="3" fill="#3b82f6" />
              ))}
            </svg>

            {/* Legend */}
            <div className="flex gap-6 justify-center mt-2 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-gray-400 inline-block" style={{ borderTop: "2px dashed #9ca3af" }} />
                Ideal
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-blue-500 inline-block" />
                Remaining
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 bg-green-200 inline-block rounded-sm" />
                Completed
              </span>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Points" value={fmt(totalPoints)} />
            <StatCard label="Completed" value={fmt(completed)} />
            <StatCard label="Remaining" value={fmt(remaining)} />
            <StatCard label="Scope Changes" value={fmt(scopeChanges)} />
          </div>

        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VELOCITY TAB
// ---------------------------------------------------------------------------

function VelocityTab({ jql }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVelocity(jql || undefined)
      .then((d) => setData(d))
      .catch(() => toast.error("Failed to load velocity"))
      .finally(() => setLoading(false));
  }, [jql]);

  const sprints = data?.velocity || [];
  const avgVelocity = data?.avgVelocity ?? 0;
  const bestSprint = useMemo(() => {
    if (!sprints.length) return "–";
    const best = sprints.reduce((a, b) => (b.completed > a.completed ? b : a), sprints[0]);
    return best.sprintName || "–";
  }, [sprints]);
  const completionRate = useMemo(() => {
    if (!sprints.length) return 0;
    const avg = sprints.reduce((s, v) => s + (v.completionRate ?? 0), 0) / sprints.length;
    return Math.round(avg);
  }, [sprints]);

  const W = 700,
    H = 320,
    PAD = 50;

  const maxY = useMemo(() => {
    const vals = sprints.flatMap((s) => [s.committed ?? 0, s.completed ?? 0]);
    return Math.max(...vals, 1);
  }, [sprints]);

  const barW = sprints.length > 0 ? Math.min(40, (W - PAD * 2) / sprints.length / 2.5) : 30;

  function xPos(i) {
    if (sprints.length <= 1) return W / 2;
    return PAD + barW + (i / (sprints.length - 1)) * (W - PAD * 2 - barW * 2);
  }
  function yPos(v) {
    return H - PAD - ((v ?? 0) / maxY) * (H - PAD * 2);
  }

  const prompts = [
    {
      label: "Analyze velocity trend",
      question: "Analyze the velocity trend across sprints. Is the team improving, stable, or declining?",
    },
    {
      label: "Forecast capacity",
      question: "Based on the velocity data, how many items can the team commit to next sprint?",
    },
    {
      label: "Identify patterns",
      question: "What patterns do you see in committed vs completed work? Are we over-committing?",
    },
  ];

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <AiCoachPanel context="Sprint Velocity Chart" data={data} prompts={prompts} />

      {/* Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          {/* Grid */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={PAD} y1={yPos(maxY * f)} x2={W - PAD} y2={yPos(maxY * f)} stroke="#e5e7eb" strokeWidth="1" />
              <text x={PAD - 8} y={yPos(maxY * f) + 4} textAnchor="end" className="text-[10px]" fill="#9ca3af">
                {fmt(maxY * f)}
              </text>
            </g>
          ))}

          {/* Average velocity line */}
          <line
            x1={PAD}
            y1={yPos(avgVelocity)}
            x2={W - PAD}
            y2={yPos(avgVelocity)}
            stroke="#f59e0b"
            strokeWidth="1.5"
            strokeDasharray="6 4"
          />
          <text x={W - PAD + 4} y={yPos(avgVelocity) + 4} className="text-[10px]" fill="#f59e0b">
            avg
          </text>

          {/* Bars */}
          {sprints.map((s, i) => (
            <g key={i}>
              {/* Committed bar */}
              <rect
                x={xPos(i) - barW}
                y={yPos(s.committed)}
                width={barW - 2}
                height={H - PAD - yPos(s.committed)}
                fill="#93c5fd"
                rx="2"
              />
              {/* Completed bar */}
              <rect
                x={xPos(i) + 2}
                y={yPos(s.completed)}
                width={barW - 2}
                height={H - PAD - yPos(s.completed)}
                fill="#2563eb"
                rx="2"
              />
              {/* Label */}
              <text x={xPos(i)} y={H - 12} textAnchor="middle" className="text-[9px]" fill="#9ca3af">
                {s.sprintName || `S${i + 1}`}
              </text>
            </g>
          ))}
        </svg>

        <div className="flex gap-6 justify-center mt-2 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-blue-300 inline-block rounded-sm" />
            Committed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-blue-600 inline-block rounded-sm" />
            Completed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 inline-block" style={{ borderTop: "2px dashed #f59e0b" }} />
            Average
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Avg Velocity" value={fmt(avgVelocity)} sub="points / sprint" />
        <StatCard label="Best Sprint" value={bestSprint} />
        <StatCard label="Completion Rate" value={`${fmt(completionRate)}%`} />
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// CFD TAB
// ---------------------------------------------------------------------------

function CFDTab({ jql }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchCFD(jql || undefined, days)
      .then((d) => setData(d))
      .catch(() => toast.error("Failed to load CFD"))
      .finally(() => setLoading(false));
  }, [days, jql]);

  const points = data?.daily || [];

  const W = 700,
    H = 320,
    PAD = 50;

  const maxY = useMemo(() => {
    const vals = points.map((p) => (p.todo ?? 0) + (p.inProgress ?? 0) + (p.done ?? 0));
    return Math.max(...vals, 1);
  }, [points]);

  function xPos(i) {
    if (points.length <= 1) return PAD;
    return PAD + (i / (points.length - 1)) * (W - PAD * 2);
  }
  function yPos(v) {
    return H - PAD - ((v ?? 0) / maxY) * (H - PAD * 2);
  }

  // Build stacked area paths
  const donePath = useMemo(() => {
    if (!points.length) return "";
    const top = points.map((p, i) => `${i === 0 ? "M" : "L"}${xPos(i)},${yPos(p.done ?? 0)}`).join(" ");
    const bottom = `L${xPos(points.length - 1)},${yPos(0)} L${xPos(0)},${yPos(0)} Z`;
    return top + " " + bottom;
  }, [points, maxY]);

  const inProgressPath = useMemo(() => {
    if (!points.length) return "";
    const top = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${xPos(i)},${yPos((p.done ?? 0) + (p.inProgress ?? 0))}`)
      .join(" ");
    const bottom = [...points]
      .reverse()
      .map((p, i) => `L${xPos(points.length - 1 - i)},${yPos(p.done ?? 0)}`)
      .join(" ");
    return top + " " + bottom + " Z";
  }, [points, maxY]);

  const todoPath = useMemo(() => {
    if (!points.length) return "";
    const top = points
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${xPos(i)},${yPos((p.done ?? 0) + (p.inProgress ?? 0) + (p.todo ?? 0))}`
      )
      .join(" ");
    const bottom = [...points]
      .reverse()
      .map((p, i) => `L${xPos(points.length - 1 - i)},${yPos((p.done ?? 0) + (p.inProgress ?? 0))}`)
      .join(" ");
    return top + " " + bottom + " Z";
  }, [points, maxY]);

  const periodOptions = [
    { label: "14 days", value: 14 },
    { label: "30 days", value: 30 },
    { label: "60 days", value: 60 },
    { label: "90 days", value: 90 },
  ];

  const prompts = [
    {
      label: "Read this CFD",
      question: "Explain what this CFD shows about our workflow. Are there bottlenecks?",
    },
    {
      label: "WIP analysis",
      question: "Analyze the Work In Progress trend. Is our WIP stable, growing, or shrinking?",
    },
    {
      label: "Flow efficiency",
      question: "How efficient is our flow? What changes would improve throughput?",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex gap-2">
        {periodOptions.map((o) => (
          <button
            key={o.value}
            onClick={() => setDays(o.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              days === o.value
                ? "bg-blue-600 text-white"
                : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <AiCoachPanel context="Cumulative Flow Diagram" data={data} prompts={prompts} />

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
              {/* Grid */}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <g key={f}>
                  <line
                    x1={PAD}
                    y1={yPos(maxY * f)}
                    x2={W - PAD}
                    y2={yPos(maxY * f)}
                    stroke="#e5e7eb"
                    strokeWidth="1"
                  />
                  <text x={PAD - 8} y={yPos(maxY * f) + 4} textAnchor="end" className="text-[10px]" fill="#9ca3af">
                    {fmt(maxY * f)}
                  </text>
                </g>
              ))}

              {/* X-axis labels */}
              {points.map((p, i) =>
                i % Math.max(1, Math.floor(points.length / 7)) === 0 ? (
                  <text key={i} x={xPos(i)} y={H - 12} textAnchor="middle" className="text-[10px]" fill="#9ca3af">
                    {shortDate(p.date)}
                  </text>
                ) : null
              )}

              {/* Stacked areas */}
              {todoPath && <path d={todoPath} fill="#d1d5db" opacity="0.7" />}
              {inProgressPath && <path d={inProgressPath} fill="#93c5fd" opacity="0.7" />}
              {donePath && <path d={donePath} fill="#86efac" opacity="0.7" />}
            </svg>

            <div className="flex gap-6 justify-center mt-2 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 bg-gray-300 inline-block rounded-sm" />
                Todo
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 bg-blue-300 inline-block rounded-sm" />
                In Progress
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 bg-green-300 inline-block rounded-sm" />
                Done
              </span>
            </div>
          </div>

        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CYCLE TIME TAB
// ---------------------------------------------------------------------------

function CycleTimeTab({ jql }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCycleTime(jql || undefined)
      .then((d) => setData(d))
      .catch(() => toast.error("Failed to load cycle time"))
      .finally(() => setLoading(false));
  }, [jql]);

  const issues = data?.items || [];
  const p50 = data?.percentiles?.p50 ?? 0;
  const p85 = data?.percentiles?.p85 ?? 0;
  const p95 = data?.percentiles?.p95 ?? 0;
  const avg = data?.percentiles?.avg ?? 0;

  const W = 700,
    H = 360,
    PAD = 50;

  const maxDays = useMemo(() => {
    const vals = issues.map((i) => i.cycleTimeDays ?? 0);
    return Math.max(...vals, p95, 1);
  }, [issues, p95]);

  const dateRange = useMemo(() => {
    if (!issues.length) return { min: Date.now(), max: Date.now() };
    const dates = issues.map((i) => new Date(i.resolved).getTime()).filter((d) => !isNaN(d));
    return { min: Math.min(...dates), max: Math.max(...dates) };
  }, [issues]);

  function xPos(dateStr) {
    const t = new Date(dateStr).getTime();
    const range = dateRange.max - dateRange.min || 1;
    return PAD + ((t - dateRange.min) / range) * (W - PAD * 2);
  }
  function yPos(v) {
    return H - PAD - ((v ?? 0) / maxDays) * (H - PAD * 2);
  }

  const typeColors = {
    Story: "#3b82f6",
    Bug: "#ef4444",
    Task: "#10b981",
    Epic: "#8b5cf6",
  };
  function dotColor(issue) {
    return typeColors[issue.issueType] || "#6b7280";
  }

  const prompts = [
    {
      label: "Explain cycle time",
      question: "Explain our cycle time distribution. What do the percentiles tell us?",
    },
    {
      label: "Reduce cycle time",
      question: "What actionable steps can we take to reduce cycle time based on this data?",
    },
    {
      label: "Predictability",
      question: "How predictable is our delivery? What's causing the outliers?",
    },
  ];

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <AiCoachPanel context="Cycle Time Scatterplot" data={data} prompts={prompts} />

      {/* Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          {/* Grid */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line
                x1={PAD}
                y1={yPos(maxDays * f)}
                x2={W - PAD}
                y2={yPos(maxDays * f)}
                stroke="#e5e7eb"
                strokeWidth="1"
              />
              <text x={PAD - 8} y={yPos(maxDays * f) + 4} textAnchor="end" className="text-[10px]" fill="#9ca3af">
                {fmt(maxDays * f)}d
              </text>
            </g>
          ))}

          {/* Percentile lines */}
          {[
            { val: p50, label: "P50", color: "#22c55e" },
            { val: p85, label: "P85", color: "#f59e0b" },
            { val: p95, label: "P95", color: "#ef4444" },
          ].map((line) => (
            <g key={line.label}>
              <line
                x1={PAD}
                y1={yPos(line.val)}
                x2={W - PAD}
                y2={yPos(line.val)}
                stroke={line.color}
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
              <text x={W - PAD + 4} y={yPos(line.val) + 4} className="text-[10px]" fill={line.color}>
                {line.label}
              </text>
            </g>
          ))}

          {/* Scatter dots */}
          {issues.map((issue, i) => (
            <circle
              key={i}
              cx={xPos(issue.resolved)}
              cy={yPos(issue.cycleTimeDays)}
              r="4"
              fill={dotColor(issue)}
              opacity="0.7"
            >
              <title>
                {issue.key}: {issue.cycleTimeDays}d ({issue.issueType})
              </title>
            </circle>
          ))}
        </svg>

        <div className="flex gap-4 justify-center mt-2 text-xs text-gray-500">
          {Object.entries(typeColors).map(([type, color]) => (
            <span key={type} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />
              {type}
            </span>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="P50 (Median)" value={`${fmt(p50)}d`} />
        <StatCard label="P85" value={`${fmt(p85)}d`} />
        <StatCard label="P95" value={`${fmt(p95)}d`} />
        <StatCard label="Average" value={`${fmt(avg)}d`} />
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// FLOW OVERVIEW TAB
// ---------------------------------------------------------------------------

function FlowOverviewTab({ jql }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFlowMetrics(jql || undefined)
      .then((d) => setData(d))
      .catch(() => toast.error("Failed to load flow metrics"))
      .finally(() => setLoading(false));
  }, [jql]);

  const throughput = data?.throughput || [];
  const wipAge = data?.wipItems || [];
  const rawStatusDist = data?.statusDistribution || {};
  const statusDist = Object.entries(rawStatusDist).map(([status, count]) => ({ status, count }));

  // Throughput bar chart
  const W = 700,
    H = 240,
    PAD = 50;

  const maxTP = useMemo(() => {
    const vals = throughput.map((t) => t.completed ?? 0);
    return Math.max(...vals, 1);
  }, [throughput]);

  const barW = throughput.length > 0 ? Math.min(50, (W - PAD * 2) / throughput.length / 1.5) : 40;

  function xTP(i) {
    if (throughput.length <= 1) return W / 2;
    return PAD + barW / 2 + (i / (throughput.length - 1)) * (W - PAD * 2 - barW);
  }
  function yTP(v) {
    return H - PAD - ((v ?? 0) / maxTP) * (H - PAD * 2);
  }

  // Status distribution colors
  const statusColors = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#6b7280"];
  const totalStatus = statusDist.reduce((s, d) => s + (d.count ?? 0), 0) || 1;

  const prompts = [
    {
      label: "Flow health check",
      question: "How healthy are our flow metrics? Rate our throughput, WIP, and cycle time.",
    },
    {
      label: "Bottleneck analysis",
      question: "Where are the bottlenecks in our process based on these flow metrics?",
    },
    {
      label: "Process improvements",
      question: "What process improvements would have the biggest impact on our flow?",
    },
  ];

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <AiCoachPanel context="Flow Metrics Overview" data={data} prompts={prompts} />

      {/* Throughput chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Weekly Throughput</h3>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={PAD} y1={yTP(maxTP * f)} x2={W - PAD} y2={yTP(maxTP * f)} stroke="#e5e7eb" strokeWidth="1" />
              <text x={PAD - 8} y={yTP(maxTP * f) + 4} textAnchor="end" className="text-[10px]" fill="#9ca3af">
                {fmt(maxTP * f)}
              </text>
            </g>
          ))}
          {throughput.map((t, i) => (
            <g key={i}>
              <rect
                x={xTP(i) - barW / 2}
                y={yTP(t.completed)}
                width={barW}
                height={H - PAD - yTP(t.completed)}
                fill="#3b82f6"
                rx="3"
              />
              <text x={xTP(i)} y={H - 12} textAnchor="middle" className="text-[9px]" fill="#9ca3af">
                {t.weekStart ? shortDate(t.weekStart) : `W${i + 1}`}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* WIP Age list */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">WIP Age</h3>
          {wipAge.length === 0 ? (
            <p className="text-sm text-gray-400">No items in progress</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {wipAge.map((item, i) => (
                <li key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                  <div className="min-w-0">
                    <span className="text-xs font-mono text-gray-500 mr-2">{item.key}</span>
                    <span className="text-sm text-gray-800 truncate">{item.summary}</span>
                  </div>
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ml-2 ${
                      (item.ageDays ?? 0) > 14
                        ? "bg-red-100 text-red-700"
                        : (item.ageDays ?? 0) > 7
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-green-100 text-green-700"
                    }`}
                  >
                    {item.ageDays ?? 0}d
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Status distribution */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Status Distribution</h3>
          <div className="space-y-2">
            {statusDist.map((s, i) => {
              const pct = ((s.count ?? 0) / totalStatus) * 100;
              return (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-700 font-medium">{s.status}</span>
                    <span className="text-gray-500">
                      {s.count} ({fmt(pct)}%)
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: statusColors[i % statusColors.length],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// MAIN PAGE
// ---------------------------------------------------------------------------

export default function FlowMetricsPage() {
  const [activeTab, setActiveTab] = useState("Burndown");
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Flow Metrics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track sprint progress, team velocity, workflow efficiency, and delivery predictability.
          </p>
        </div>

        <JqlBar value={inputJql} onChange={setInputJql} onSubmit={(q) => setJql(q)} />

        {/* Tab bar */}
        <div className="flex gap-1 bg-white rounded-xl border border-gray-200 p-1 mb-6 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {activeTab === "Burndown" && <BurndownTab jql={jql} />}
          {activeTab === "Velocity" && <VelocityTab jql={jql} />}
          {activeTab === "CFD" && <CFDTab jql={jql} />}
          {activeTab === "Cycle Time" && <CycleTimeTab jql={jql} />}
          {activeTab === "Flow Overview" && <FlowOverviewTab jql={jql} />}
        </div>
      </div>
    </div>
  );
}
