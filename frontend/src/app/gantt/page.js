"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import JqlBar from "../../components/JqlBar";
import IssueHoverCard from "../../components/IssueHoverCard";
import { fetchIssues } from "../../lib/api";
import { toast } from "../../components/Toaster";
import AiCoachPanel from "../../components/AiCoachPanel";

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || "http://localhost:9080";

// ─── Color palette for epics ────────────────────────────

const EPIC_COLORS = [
  { bg: "bg-blue-500", light: "bg-blue-100", text: "text-blue-800", border: "border-blue-300", hex: "#3b82f6" },
  { bg: "bg-emerald-500", light: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-300", hex: "#10b981" },
  { bg: "bg-violet-500", light: "bg-violet-100", text: "text-violet-800", border: "border-violet-300", hex: "#8b5cf6" },
  { bg: "bg-amber-500", light: "bg-amber-100", text: "text-amber-800", border: "border-amber-300", hex: "#f59e0b" },
  { bg: "bg-rose-500", light: "bg-rose-100", text: "text-rose-800", border: "border-rose-300", hex: "#f43f5e" },
  { bg: "bg-cyan-500", light: "bg-cyan-100", text: "text-cyan-800", border: "border-cyan-300", hex: "#06b6d4" },
  { bg: "bg-orange-500", light: "bg-orange-100", text: "text-orange-800", border: "border-orange-300", hex: "#f97316" },
  { bg: "bg-indigo-500", light: "bg-indigo-100", text: "text-indigo-800", border: "border-indigo-300", hex: "#6366f1" },
  { bg: "bg-pink-500", light: "bg-pink-100", text: "text-pink-800", border: "border-pink-300", hex: "#ec4899" },
  { bg: "bg-teal-500", light: "bg-teal-100", text: "text-teal-800", border: "border-teal-300", hex: "#14b8a6" },
];

const STATUS_OPACITY = {
  done: "opacity-60",
  indeterminate: "opacity-100",
  new: "opacity-80",
};

// ─── Date helpers ───────────────────────────────────────

function parseDate(str) {
  if (!str) return null;
  return new Date(str);
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(d) {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function formatMonthYear(d) {
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

// ─── Gantt computation ──────────────────────────────────

function computeGanttData(epics, noEpic) {
  const colorMap = {};
  let colorIdx = 0;

  // Collect all items with start/end dates
  const rows = [];
  const DEFAULT_DURATION = 7; // days if no due date

  const allGroups = [
    ...epics.map((e) => ({ key: e.key, name: e.name, issues: e.issues })),
  ];
  if (noEpic.length > 0) {
    allGroups.push({ key: "__no_epic__", name: "No Epic", issues: noEpic });
  }

  for (const group of allGroups) {
    if (!colorMap[group.key]) {
      colorMap[group.key] = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
      colorIdx++;
    }

    for (const issue of group.issues) {
      const start = parseDate(issue.created);
      if (!start) continue;

      let end = parseDate(issue.dueDate);
      if (!end) {
        // Use updated date if done, otherwise default duration from today
        if (issue.statusCategory === "done") {
          end = parseDate(issue.updated) || addDays(start, DEFAULT_DURATION);
        } else {
          end = addDays(new Date(), DEFAULT_DURATION);
        }
      }

      // Ensure end is after start
      if (end <= start) end = addDays(start, 1);

      rows.push({
        ...issue,
        assignee: issue.assigneeName,
        epicKey: group.key,
        epicName: group.name,
        color: colorMap[group.key],
        start: startOfDay(start),
        end: startOfDay(end),
        urgencyFlags: issue.urgencyFlags || [],
      });
    }
  }

  if (rows.length === 0) return { rows: [], timelineStart: new Date(), timelineEnd: new Date(), totalDays: 0, colorMap };

  // Sort rows: by epic, then by start date
  rows.sort((a, b) => {
    if (a.epicKey !== b.epicKey) return a.epicKey < b.epicKey ? -1 : 1;
    return a.start.getTime() - b.start.getTime();
  });

  // Compute timeline bounds with padding
  const allDates = rows.flatMap((r) => [r.start, r.end]);
  const minDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...allDates.map((d) => d.getTime())));

  const timelineStart = addDays(minDate, -2);
  const timelineEnd = addDays(maxDate, 5);
  const totalDays = daysBetween(timelineStart, timelineEnd);

  return { rows, timelineStart, timelineEnd, totalDays, colorMap };
}

// ─── Components ─────────────────────────────────────────

function TodayMarker({ timelineStart, totalDays }) {
  const today = startOfDay(new Date());
  const offset = daysBetween(timelineStart, today);
  const pct = (offset / totalDays) * 100;
  if (pct < 0 || pct > 100) return null;

  return (
    <div
      className="absolute top-0 bottom-0 w-px bg-red-500 z-10 pointer-events-none"
      style={{ left: `${pct}%` }}
    >
      <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded whitespace-nowrap">
        Today
      </div>
    </div>
  );
}

function TimelineHeader({ timelineStart, totalDays }) {
  const weeks = [];
  let current = new Date(timelineStart);
  // Align to Monday
  const day = current.getDay();
  current = addDays(current, day === 0 ? 1 : (8 - day) % 7);

  while (daysBetween(timelineStart, current) < totalDays) {
    const offset = daysBetween(timelineStart, current);
    weeks.push({ date: new Date(current), offset });
    current = addDays(current, 7);
  }

  // Month labels
  const months = [];
  let monthCurrent = new Date(timelineStart);
  monthCurrent.setDate(1);
  if (monthCurrent < timelineStart) monthCurrent.setMonth(monthCurrent.getMonth() + 1);

  while (daysBetween(timelineStart, monthCurrent) < totalDays) {
    const offset = daysBetween(timelineStart, monthCurrent);
    months.push({ label: formatMonthYear(monthCurrent), offset });
    monthCurrent = new Date(monthCurrent);
    monthCurrent.setMonth(monthCurrent.getMonth() + 1);
  }

  return (
    <div className="relative h-10 border-b border-gray-200 bg-gray-50">
      {/* Month labels */}
      {months.map((m, i) => (
        <div
          key={i}
          className="absolute top-0 text-[10px] font-semibold text-gray-500 uppercase"
          style={{ left: `${(m.offset / totalDays) * 100}%` }}
        >
          <span className="px-1">{m.label}</span>
        </div>
      ))}
      {/* Week ticks */}
      {weeks.map((w, i) => (
        <div
          key={i}
          className="absolute bottom-0 text-[9px] text-gray-400"
          style={{ left: `${(w.offset / totalDays) * 100}%` }}
        >
          <div className="h-2 w-px bg-gray-300 mb-0.5" />
          <span className="px-0.5">{formatDate(w.date)}</span>
        </div>
      ))}
    </div>
  );
}

function GanttBar({ row, timelineStart, totalDays, onHover }) {
  const startOffset = daysBetween(timelineStart, row.start);
  const duration = daysBetween(row.start, row.end);
  const leftPct = (startOffset / totalDays) * 100;
  const widthPct = Math.max((duration / totalDays) * 100, 0.5);

  const isOverdue = row.urgencyFlags.some((f) => f.type === "overdue");
  const isDone = row.statusCategory === "done";

  return (
    <div
      className="absolute top-1 bottom-1 rounded-md flex items-center overflow-hidden cursor-pointer group transition-all hover:shadow-md hover:z-10"
      style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: "4px" }}
      onMouseEnter={() => onHover(row)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Bar fill */}
      <div className={`absolute inset-0 ${row.color.bg} ${STATUS_OPACITY[row.statusCategory] || ""} ${isDone ? "opacity-50" : ""}`} />
      {isOverdue && <div className="absolute inset-0 bg-red-500 opacity-20" />}
      {isDone && (
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0" style={{
            backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.3) 3px, rgba(255,255,255,0.3) 6px)"
          }} />
        </div>
      )}
      {/* Label inside bar */}
      <span className="relative z-[1] text-[10px] text-white font-medium px-1.5 truncate drop-shadow-sm">
        {row.key}
      </span>
    </div>
  );
}

function Tooltip({ row }) {
  if (!row) return null;
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl max-w-xs pointer-events-none">
      <div className="font-bold mb-1">{row.key} — {row.summary}</div>
      <div className="space-y-0.5 text-gray-300">
        <div>Status: <span className="text-white">{row.status}</span></div>
        <div>Assignee: <span className="text-white">{row.assignee || "Unassigned"}</span></div>
        <div>Start: <span className="text-white">{formatDate(row.start)}</span></div>
        <div>{row.dueDate ? "Due" : "Est. end"}: <span className="text-white">{formatDate(row.end)}</span></div>
        <div>Priority: <span className="text-white">{row.priority || "—"}</span></div>
        <div>Epic: <span className="text-white">{row.epicName}</span></div>
        {row.urgencyFlags.length > 0 && (
          <div className="text-amber-300 mt-1">{row.urgencyFlags.map((f) => f.label).join(", ")}</div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────

const DEFAULT_JQL = "project = TEAM ORDER BY status ASC, updated DESC";

export default function GanttPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [jql, setJql] = useState(DEFAULT_JQL);
  const [inputJql, setInputJql] = useState(DEFAULT_JQL);
  const [hoveredRow, setHoveredRow] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [hiddenEpics, setHiddenEpics] = useState(new Set());
  const [showDeps, setShowDeps] = useState(true);
  const containerRef = useRef(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchIssues(jql);
        setData(result);
        toast.success("Gantt data loaded");
      } catch (err) {
        setError(err.message);
        toast.error("Failed to load Gantt data");
      }
      setLoading(false);
    }
    load();
  }, [jql]);

  const handleSearch = (e) => {
    e.preventDefault();
    setJql(inputJql);
  };

  const gantt = useMemo(() => {
    if (!data) return null;
    return computeGanttData(data.epics || [], data.noEpic || []);
  }, [data]);

  const filteredRows = useMemo(() => {
    if (!gantt) return [];
    return gantt.rows.filter((r) => !hiddenEpics.has(r.epicKey));
  }, [gantt, hiddenEpics]);

  const toggleEpic = (key) => {
    setHiddenEpics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Track mouse for tooltip
  const handleMouseMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // Group rows by epic for row labels
  const groupedRows = useMemo(() => {
    const groups = [];
    let currentEpic = null;
    for (const row of filteredRows) {
      if (row.epicKey !== currentEpic) {
        groups.push({ type: "epic", key: row.epicKey, name: row.epicName, color: row.color });
        currentEpic = row.epicKey;
      }
      groups.push({ type: "task", ...row });
    }
    return groups;
  }, [filteredRows]);

  // Compute dependency arrows between rows
  const depEdges = useMemo(() => {
    if (!showDeps) return [];
    const rowIndex = {};
    let idx = 0;
    for (const item of groupedRows) {
      if (item.type === "task") rowIndex[item.key] = idx;
      idx++;
    }
    const edges = [];
    for (const item of groupedRows) {
      if (item.type !== "task" || !item.links) continue;
      for (const link of item.links) {
        if (!link.key || rowIndex[link.key] == null) continue;
        const isBlocking = link.direction?.toLowerCase().includes("block");
        edges.push({
          fromKey: item.key, toKey: link.key,
          fromIdx: rowIndex[item.key], toIdx: rowIndex[link.key],
          type: link.type, direction: link.direction,
          isBlocking,
        });
      }
    }
    return edges;
  }, [groupedRows, showDeps]);

  const ROW_HEIGHT = 32;
  const EPIC_ROW_HEIGHT = 28;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">Gantt Chart</h1>
          </div>

          <JqlBar
            value={inputJql}
            onChange={setInputJql}
            onSubmit={(q) => setJql(q)}
          />

          {/* Epic legend / toggles + dependency toggle */}
          {gantt && Object.keys(gantt.colorMap).length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3 items-center">
              <button
                onClick={() => setShowDeps(!showDeps)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-all ${
                  showDeps ? "bg-red-50 text-red-700 border-red-200" : "bg-gray-100 text-gray-400 border-gray-200"
                }`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                Dependencies {depEdges.length > 0 ? `(${depEdges.length})` : ""}
              </button>
              {Object.entries(gantt.colorMap).map(([epicKey, color]) => {
                const hidden = hiddenEpics.has(epicKey);
                const epicName = gantt.rows.find((r) => r.epicKey === epicKey)?.epicName || epicKey;
                return (
                  <button
                    key={epicKey}
                    onClick={() => toggleEpic(epicKey)}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-all ${
                      hidden
                        ? "bg-gray-100 text-gray-400 border-gray-200 line-through"
                        : `${color.light} ${color.text} ${color.border}`
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${hidden ? "bg-gray-300" : color.bg}`} />
                    {epicName}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-6">
        {/* AI Coach */}
        {!loading && gantt && gantt.rows.length > 0 && (
          <div className="mb-4">
            <AiCoachPanel
              context="Gantt Chart — Timeline & Dependencies"
              data={{
                totalIssues: gantt.rows.length,
                epics: Object.keys(gantt.colorMap).length,
                timelineSpan: `${gantt.totalDays} days`,
                dependencies: depEdges.length,
                rows: gantt.rows.slice(0, 40).map((r) => ({
                  key: r.key,
                  summary: r.summary,
                  status: r.status,
                  statusCategory: r.statusCategory,
                  assignee: r.assignee || "Unassigned",
                  epic: r.epicName,
                  start: formatDate(r.start),
                  end: formatDate(r.end),
                  hasDueDate: !!r.dueDate,
                  flags: r.urgencyFlags.map((f) => f.label),
                })),
              }}
              prompts={[
                {
                  label: "Timeline Risk Analysis",
                  primary: true,
                  question: "Analyze the Gantt timeline for risks: overlapping work, items without due dates, long-running tasks, and potential bottlenecks. Are there critical path items that could delay the whole project? Suggest timeline adjustments.",
                },
                {
                  label: "Dependency Health",
                  question: "Review the task dependencies. Are there circular risks, single-person bottlenecks, or blocked chains? Identify the most critical dependency paths and suggest how to reduce risk.",
                },
                {
                  label: "Workload Balance",
                  question: "Based on the timeline, is work evenly distributed across the team? Identify overloaded assignees, parallel work conflicts, and suggest rebalancing strategies.",
                },
                {
                  label: "Deadline Feasibility",
                  question: "Given the current timeline and task statuses, which deadlines are at risk? Which items need to be fast-tracked or descoped? Provide a prioritized list of actions to keep the project on track.",
                },
              ]}
            />
          </div>
        )}

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

        {!loading && gantt && gantt.rows.length > 0 && (
          <div
            ref={containerRef}
            className="relative bg-white rounded-xl border border-gray-200 overflow-auto"
            onMouseMove={handleMouseMove}
          >
            <div className="flex" style={{ minWidth: "1000px" }}>
              {/* Left: Row labels */}
              <div className="w-64 shrink-0 border-r border-gray-200 bg-gray-50/50">
                {/* Header spacer */}
                <div className="h-10 border-b border-gray-200 px-3 flex items-center">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase">Ticket</span>
                </div>
                {/* Rows */}
                {groupedRows.map((item, i) => {
                  if (item.type === "epic") {
                    return (
                      <div
                        key={`epic-${item.key}-${i}`}
                        className={`flex items-center gap-2 px-3 ${item.color.light} border-b border-t border-gray-200`}
                        style={{ height: `${EPIC_ROW_HEIGHT}px` }}
                      >
                        <span className={`w-2 h-2 rounded-full ${item.color.bg}`} />
                        <Link href={`/epic/${item.key}`} className={`text-xs font-bold ${item.color.text} truncate hover:underline`}>
                          {item.name}
                        </Link>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={item.key}
                      className="flex items-center gap-2 px-3 border-b border-gray-100 hover:bg-gray-50"
                      style={{ height: `${ROW_HEIGHT}px` }}
                    >
                      <IssueHoverCard issue={item} jiraBaseUrl={JIRA_BASE_URL}>
                        <a href={`${JIRA_BASE_URL}/browse/${item.key}`} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-blue-600 w-16 shrink-0 hover:underline">{item.key}</a>
                      </IssueHoverCard>
                      <span className="text-xs text-gray-700 truncate flex-1">{item.summary}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                        item.statusCategory === "done" ? "bg-green-100 text-green-700"
                        : item.statusCategory === "indeterminate" ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-600"
                      }`}>{item.status}</span>
                    </div>
                  );
                })}
              </div>

              {/* Right: Timeline */}
              <div className="flex-1 relative">
                <TimelineHeader timelineStart={gantt.timelineStart} totalDays={gantt.totalDays} />

                {/* Grid lines (weekly) */}
                <div className="absolute top-10 bottom-0 left-0 right-0">
                  {Array.from({ length: Math.ceil(gantt.totalDays / 7) }).map((_, i) => {
                    const offset = i * 7;
                    const pct = (offset / gantt.totalDays) * 100;
                    return (
                      <div
                        key={i}
                        className="absolute top-0 bottom-0 w-px bg-gray-100"
                        style={{ left: `${pct}%` }}
                      />
                    );
                  })}
                  <TodayMarker timelineStart={gantt.timelineStart} totalDays={gantt.totalDays} />
                </div>

                {/* Bars */}
                <div className="relative">
                  {groupedRows.map((item, i) => {
                    if (item.type === "epic") {
                      return (
                        <div
                          key={`epic-${item.key}-${i}`}
                          className={`${item.color.light} border-b border-t border-gray-200`}
                          style={{ height: `${EPIC_ROW_HEIGHT}px` }}
                        />
                      );
                    }
                    return (
                      <div
                        key={item.key}
                        className="relative border-b border-gray-100"
                        style={{ height: `${ROW_HEIGHT}px` }}
                      >
                        <GanttBar
                          row={item}
                          timelineStart={gantt.timelineStart}
                          totalDays={gantt.totalDays}
                          onHover={setHoveredRow}
                        />
                      </div>
                    );
                  })}
                  {/* Dependency arrows overlay */}
                  {showDeps && depEdges.length > 0 && (
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 20 }}>
                      <defs>
                        <marker id="dep-arrow" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
                          <path d="M0,0 L6,2 L0,4" fill="#ef4444" />
                        </marker>
                        <marker id="dep-arrow-gray" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
                          <path d="M0,0 L6,2 L0,4" fill="#9ca3af" />
                        </marker>
                      </defs>
                      {depEdges.map((edge, ei) => {
                        let y1 = 0, y2 = 0;
                        for (let r = 0; r <= Math.max(edge.fromIdx, edge.toIdx); r++) {
                          const h = groupedRows[r]?.type === "epic" ? EPIC_ROW_HEIGHT : ROW_HEIGHT;
                          if (r < edge.fromIdx) y1 += h;
                          else if (r === edge.fromIdx) y1 += h / 2;
                          if (r < edge.toIdx) y2 += h;
                          else if (r === edge.toIdx) y2 += h / 2;
                        }
                        const fromRow = groupedRows[edge.fromIdx];
                        const toRow = groupedRows[edge.toIdx];
                        if (!fromRow || !toRow || fromRow.type === "epic" || toRow.type === "epic") return null;
                        const x1Pct = ((daysBetween(gantt.timelineStart, fromRow.end) / gantt.totalDays) * 100);
                        const x2Pct = ((daysBetween(gantt.timelineStart, toRow.start) / gantt.totalDays) * 100);
                        return (
                          <path
                            key={ei}
                            d={`M ${x1Pct}% ${y1} C ${(x1Pct + x2Pct) / 2}% ${y1}, ${(x1Pct + x2Pct) / 2}% ${y2}, ${x2Pct}% ${y2}`}
                            fill="none"
                            stroke={edge.isBlocking ? "#ef4444" : "#9ca3af"}
                            strokeWidth={edge.isBlocking ? 2 : 1}
                            strokeDasharray={edge.isBlocking ? "none" : "4,3"}
                            markerEnd={`url(#${edge.isBlocking ? "dep-arrow" : "dep-arrow-gray"})`}
                            opacity={0.7}
                          />
                        );
                      })}
                    </svg>
                  )}
                </div>
              </div>
            </div>

            {/* Floating tooltip */}
            {hoveredRow && (
              <div
                className="absolute z-30 pointer-events-none"
                style={{
                  left: `${Math.min(mousePos.x + 12, (containerRef.current?.clientWidth || 800) - 280)}px`,
                  top: `${mousePos.y + 12}px`,
                }}
              >
                <Tooltip row={hoveredRow} />
              </div>
            )}
          </div>
        )}

        {!loading && gantt && gantt.rows.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg mb-2">No issues to display</p>
            <p className="text-sm">Try adjusting your JQL query</p>
          </div>
        )}

      </main>
    </div>
  );
}
