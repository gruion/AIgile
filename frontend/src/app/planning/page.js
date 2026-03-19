"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import JqlBar from "../../components/JqlBar";
import ResizableTable from "../../components/ResizableTable";
import IssueHoverCard from "../../components/IssueHoverCard";
import { fetchIssues, fetchPiOverview, fetchConfig } from "../../lib/api";
import { toast } from "../../components/Toaster";

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || "http://localhost:9080";

// ─── Color palette (shared with gantt) ──────────────────
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

const STATUS_COLORS = {
  done: { bg: "bg-green-100", text: "text-green-700", dot: "bg-green-500" },
  indeterminate: { bg: "bg-blue-100", text: "text-blue-700", dot: "bg-blue-500" },
  new: { bg: "bg-gray-100", text: "text-gray-600", dot: "bg-gray-400" },
};

const PRIORITY_ICONS = {
  Highest: "text-red-600",
  High: "text-red-500",
  Medium: "text-orange-500",
  Low: "text-blue-500",
  Lowest: "text-blue-400",
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
function formatFullDate(d) {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}
function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ─── Normalize issues from both project & PI data ──────
function normalizeIssues(data, source) {
  const issues = [];
  const epicColorMap = {};
  let colorIdx = 0;

  if (source === "project") {
    const epics = data.epics || [];
    const noEpic = data.noEpic || [];
    for (const epic of epics) {
      if (!epicColorMap[epic.key]) {
        epicColorMap[epic.key] = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
        colorIdx++;
      }
      for (const issue of epic.issues || []) {
        issues.push({ ...issue, epicKey: epic.key, epicName: epic.name, color: epicColorMap[epic.key] });
      }
    }
    if (!epicColorMap["__no_epic__"]) {
      epicColorMap["__no_epic__"] = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
    }
    for (const issue of noEpic) {
      issues.push({ ...issue, epicKey: "__no_epic__", epicName: "No Epic", color: epicColorMap["__no_epic__"] });
    }
  } else {
    // PI data — teams contain sprints with issues
    const teams = data.teams || [];
    for (const team of teams) {
      if (!epicColorMap[team.key || team.name]) {
        epicColorMap[team.key || team.name] = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
        colorIdx++;
      }
      const teamColor = epicColorMap[team.key || team.name];
      const sprints = team.sprints || [];
      for (const sprint of sprints) {
        for (const issue of sprint.issues || []) {
          issues.push({
            ...issue,
            epicKey: team.key || team.name,
            epicName: team.name,
            sprintName: sprint.name,
            color: teamColor,
          });
        }
      }
    }
  }
  return { issues, epicColorMap };
}

// ─── Calendar helpers ───────────────────────────────────
function getCalendarDays(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay(); // 0=Sun
  const startDate = addDays(firstDay, -((startWeekday + 6) % 7)); // start on Monday
  const days = [];
  let current = new Date(startDate);
  // Always show 6 weeks
  for (let i = 0; i < 42; i++) {
    days.push(new Date(current));
    current = addDays(current, 1);
  }
  return days;
}

// ─── Gantt computation ──────────────────────────────────
function computeGanttData(issues) {
  const DEFAULT_DURATION = 7;
  const rows = [];

  for (const issue of issues) {
    const start = parseDate(issue.created);
    if (!start) continue;
    let end = parseDate(issue.dueDate);
    if (!end) {
      if (issue.statusCategory === "done") {
        end = parseDate(issue.updated) || addDays(start, DEFAULT_DURATION);
      } else {
        end = addDays(new Date(), DEFAULT_DURATION);
      }
    }
    if (end <= start) end = addDays(start, 1);

    rows.push({
      ...issue,
      assignee: issue.assigneeName,
      epicKey: issue.epicKey,
      epicName: issue.epicName,
      color: issue.color,
      start: startOfDay(start),
      end: startOfDay(end),
    });
  }

  if (rows.length === 0) return { rows: [], timelineStart: new Date(), timelineEnd: new Date(), totalDays: 0 };

  rows.sort((a, b) => {
    if (a.epicKey !== b.epicKey) return a.epicKey < b.epicKey ? -1 : 1;
    return a.start.getTime() - b.start.getTime();
  });

  const allDates = rows.flatMap((r) => [r.start, r.end]);
  const minDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...allDates.map((d) => d.getTime())));
  const timelineStart = addDays(minDate, -2);
  const timelineEnd = addDays(maxDate, 5);
  const totalDays = daysBetween(timelineStart, timelineEnd);

  return { rows, timelineStart, timelineEnd, totalDays };
}

// ─── Components ─────────────────────────────────────────

function TodayMarker({ timelineStart, totalDays }) {
  const today = startOfDay(new Date());
  const offset = daysBetween(timelineStart, today);
  const pct = (offset / totalDays) * 100;
  if (pct < 0 || pct > 100) return null;
  return (
    <div className="absolute top-0 bottom-0 w-px bg-red-500 z-10 pointer-events-none" style={{ left: `${pct}%` }}>
      <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded whitespace-nowrap">Today</div>
    </div>
  );
}

function TimelineHeader({ timelineStart, totalDays }) {
  const weeks = [];
  let current = new Date(timelineStart);
  const day = current.getDay();
  current = addDays(current, day === 0 ? 1 : (8 - day) % 7);
  while (daysBetween(timelineStart, current) < totalDays) {
    weeks.push({ date: new Date(current), offset: daysBetween(timelineStart, current) });
    current = addDays(current, 7);
  }
  const months = [];
  let monthCurrent = new Date(timelineStart);
  monthCurrent.setDate(1);
  if (monthCurrent < timelineStart) monthCurrent.setMonth(monthCurrent.getMonth() + 1);
  while (daysBetween(timelineStart, monthCurrent) < totalDays) {
    months.push({ label: formatMonthYear(monthCurrent), offset: daysBetween(timelineStart, monthCurrent) });
    monthCurrent = new Date(monthCurrent);
    monthCurrent.setMonth(monthCurrent.getMonth() + 1);
  }
  return (
    <div className="relative h-10 border-b border-gray-200 bg-gray-50">
      {months.map((m, i) => (
        <div key={i} className="absolute top-0 text-[10px] font-semibold text-gray-500 uppercase" style={{ left: `${(m.offset / totalDays) * 100}%` }}>
          <span className="px-1">{m.label}</span>
        </div>
      ))}
      {weeks.map((w, i) => (
        <div key={i} className="absolute bottom-0 text-[9px] text-gray-400" style={{ left: `${(w.offset / totalDays) * 100}%` }}>
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
  const isDone = row.statusCategory === "done";
  return (
    <div
      className="absolute top-1 bottom-1 rounded-md flex items-center overflow-hidden cursor-pointer group transition-all hover:shadow-md hover:z-10"
      style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: "4px" }}
      onMouseEnter={() => onHover(row)}
      onMouseLeave={() => onHover(null)}
    >
      <div className={`absolute inset-0 ${row.color.bg} ${isDone ? "opacity-50" : ""}`} />
      {isDone && (
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0" style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.3) 3px, rgba(255,255,255,0.3) 6px)" }} />
        </div>
      )}
      <span className="relative z-[1] text-[10px] text-white font-medium px-1.5 truncate drop-shadow-sm">{row.key}</span>
    </div>
  );
}

function GanttTooltip({ row }) {
  if (!row) return null;
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl max-w-xs pointer-events-none">
      <div className="font-bold mb-1">{row.key} — {row.summary}</div>
      <div className="space-y-0.5 text-gray-300">
        <div>Status: <span className="text-white">{row.status}</span></div>
        <div>Assignee: <span className="text-white">{row.assignee || "Unassigned"}</span></div>
        <div>Start: <span className="text-white">{formatDate(row.start)}</span></div>
        <div>{row.dueDate ? "Due" : "Est. end"}: <span className="text-white">{formatDate(row.end)}</span></div>
        <div>Epic: <span className="text-white">{row.epicName}</span></div>
      </div>
    </div>
  );
}

// ─── Tab: Calendar ──────────────────────────────────────
const DATE_MODES = [
  { id: "effective", label: "Effective Date", desc: "Due date if set, otherwise created date" },
  { id: "created", label: "Created", desc: "When the issue was created" },
  { id: "updated", label: "Last Updated", desc: "When the issue was last updated" },
  { id: "dueDate", label: "Due Date Only", desc: "Only issues with a due date" },
];

function getIssueDate(issue, mode) {
  if (mode === "dueDate") return parseDate(issue.dueDate);
  if (mode === "created") return parseDate(issue.created);
  if (mode === "updated") return parseDate(issue.updated);
  // effective: due date first, fallback to created
  return parseDate(issue.dueDate) || parseDate(issue.created);
}

function CalendarView({ issues }) {
  const today = startOfDay(new Date());
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [dateMode, setDateMode] = useState("effective");
  const days = useMemo(() => getCalendarDays(year, month), [year, month]);

  // Map issues to dates based on selected mode
  const dateMap = useMemo(() => {
    const map = {};
    for (const issue of issues) {
      const d = getIssueDate(issue, dateMode);
      if (!d) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map[key]) map[key] = [];
      map[key].push(issue);
    }
    return map;
  }, [issues, dateMode]);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
  };
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); };

  const monthLabel = new Date(year, month).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div>
      {/* Month nav */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1.5 rounded hover:bg-gray-100">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h2 className="text-lg font-semibold text-gray-900 min-w-[180px] text-center">{monthLabel}</h2>
          <button onClick={nextMonth} className="p-1.5 rounded hover:bg-gray-100">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
        <button onClick={goToday} className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium">Today</button>
      </div>

      {/* Date mode selector */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500">Show by:</span>
        {DATE_MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setDateMode(m.id)}
            title={m.desc}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              dateMode === m.id ? "bg-blue-50 text-blue-600 border-blue-200" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
          {weekdays.map((d) => (
            <div key={d} className="text-center text-[11px] font-semibold text-gray-500 uppercase py-2">{d}</div>
          ))}
        </div>
        {/* Days */}
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
            const dayIssues = dateMap[key] || [];
            const isCurrentMonth = day.getMonth() === month;
            const isToday = isSameDay(day, today);
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;

            return (
              <div
                key={i}
                className={`min-h-[100px] border-b border-r border-gray-100 p-1.5 ${
                  !isCurrentMonth ? "bg-gray-50/50" : isWeekend ? "bg-gray-50/30" : "bg-white"
                }`}
              >
                <div className={`text-xs font-medium mb-1 ${isToday ? "bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center" : isCurrentMonth ? "text-gray-700" : "text-gray-300"}`}>
                  {day.getDate()}
                </div>
                <div className="space-y-0.5 max-h-[80px] overflow-y-auto">
                  {dayIssues.slice(0, 4).map((issue) => {
                    const sc = STATUS_COLORS[issue.statusCategory] || STATUS_COLORS.new;
                    return (
                      <div key={issue.key} className={`text-[10px] px-1.5 py-0.5 rounded ${sc.bg} ${sc.text} truncate`}>
                        <IssueHoverCard issue={issue} jiraBaseUrl={JIRA_BASE_URL}>
                          <a href={`${JIRA_BASE_URL}/browse/${issue.key}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline cursor-pointer">{issue.key}</a>
                        </IssueHoverCard> {issue.summary}
                      </div>
                    );
                  })}
                  {dayIssues.length > 4 && (
                    <div className="text-[10px] text-gray-400 px-1">+{dayIssues.length - 4} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-[11px] text-gray-500">
        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Done</div>
        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" />In Progress</div>
        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gray-400" />To Do</div>
      </div>
    </div>
  );
}

// ─── Tab: Task List ─────────────────────────────────────
const PLANNING_SORT_FN = (a, b, key) => {
  if (key === "dueDate") {
    const va = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const vb = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return va - vb;
  }
  if (key === "created") {
    const va = a.created ? new Date(a.created).getTime() : 0;
    const vb = b.created ? new Date(b.created).getTime() : 0;
    return va - vb;
  }
  if (key === "status") {
    const order = { new: 0, indeterminate: 1, done: 2 };
    return (order[a.statusCategory] ?? 1) - (order[b.statusCategory] ?? 1);
  }
  if (key === "priority") {
    const order = { Highest: 0, High: 1, Medium: 2, Low: 3, Lowest: 4 };
    return (order[a.priority] ?? 5) - (order[b.priority] ?? 5);
  }
  if (key === "assignee") {
    return (a.assigneeName || "zzz").localeCompare(b.assigneeName || "zzz");
  }
  if (key === "epic") {
    return (a.epicName || "zzz").localeCompare(b.epicName || "zzz");
  }
  return String(a[key] || "").localeCompare(String(b[key] || ""));
};

function TaskListView({ issues }) {
  const [filterStatus, setFilterStatus] = useState("all");

  const filtered = useMemo(() => {
    if (filterStatus === "all") return issues;
    return issues.filter((i) => i.statusCategory === filterStatus);
  }, [issues, filterStatus]);

  const today = startOfDay(new Date());

  const columns = useMemo(() => [
    {
      key: "key", label: "Key", sortable: true, defaultWidth: 90, minWidth: 70,
      className: "font-mono text-blue-600 font-medium whitespace-nowrap",
      render: (row) => (
        <IssueHoverCard issue={row} jiraBaseUrl={JIRA_BASE_URL}>
          <a href={`${JIRA_BASE_URL}/browse/${row.key}`} target="_blank" rel="noopener noreferrer" className="hover:underline">{row.key}</a>
        </IssueHoverCard>
      ),
    },
    {
      key: "summary", label: "Summary", sortable: true, defaultWidth: 320, minWidth: 150,
      className: "text-gray-700 truncate",
      render: (row) => <span className="truncate block">{row.summary}</span>,
    },
    {
      key: "status", label: "Status", sortable: true, defaultWidth: 110, minWidth: 80,
      render: (row) => {
        const sc = STATUS_COLORS[row.statusCategory] || STATUS_COLORS.new;
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${sc.bg} ${sc.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
            {row.status}
          </span>
        );
      },
    },
    {
      key: "priority", label: "Priority", sortable: true, defaultWidth: 80, minWidth: 60,
      render: (row) => <span className={`font-medium ${PRIORITY_ICONS[row.priority] || "text-gray-500"}`}>{row.priority || "—"}</span>,
    },
    {
      key: "assignee", label: "Assignee", sortable: true, defaultWidth: 120, minWidth: 80,
      className: "text-gray-600",
      render: (row) => row.assigneeName || "Unassigned",
    },
    {
      key: "dueDate", label: "Due Date", sortable: true, defaultWidth: 150, minWidth: 100,
      render: (row) => {
        const due = parseDate(row.dueDate);
        const isOverdue = due && due < today && row.statusCategory !== "done";
        const isDueSoon = due && !isOverdue && daysBetween(today, due) <= 3 && row.statusCategory !== "done";
        return (
          <span className={`whitespace-nowrap ${isOverdue ? "text-red-600 font-semibold" : isDueSoon ? "text-amber-600 font-medium" : "text-gray-600"}`}>
            {due ? formatFullDate(due) : <span className="text-gray-300">—</span>}
            {isOverdue && <span className="ml-1 text-[9px] bg-red-100 text-red-600 px-1 py-0.5 rounded">OVERDUE</span>}
            {isDueSoon && <span className="ml-1 text-[9px] bg-amber-100 text-amber-600 px-1 py-0.5 rounded">SOON</span>}
          </span>
        );
      },
    },
    {
      key: "created", label: "Created", sortable: true, defaultWidth: 140, minWidth: 100,
      className: "text-gray-500 whitespace-nowrap",
      render: (row) => row.created ? formatFullDate(new Date(row.created)) : "—",
    },
    {
      key: "epic", label: "Epic", sortable: true, defaultWidth: 120, minWidth: 80,
      render: (row) =>
        row.epicName && row.epicKey !== "__no_epic__" ? (
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${row.color?.light || "bg-gray-100"} ${row.color?.text || "text-gray-600"}`}>
            {row.epicName}
          </span>
        ) : (
          <span className="text-gray-300">—</span>
        ),
    },
  ], [today]);

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500">Filter:</span>
        {[
          { value: "all", label: "All" },
          { value: "new", label: "To Do" },
          { value: "indeterminate", label: "In Progress" },
          { value: "done", label: "Done" },
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setFilterStatus(f.value)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              filterStatus === f.value ? "bg-blue-50 text-blue-600 border-blue-200" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400">{filtered.length} issues</span>
      </div>

      <ResizableTable
        columns={columns}
        data={filtered}
        getRowKey={(row) => row.key}
        defaultSort={{ key: "dueDate", dir: "asc" }}
        sortFn={PLANNING_SORT_FN}
        emptyMessage="No issues match the current filter"
      />
    </div>
  );
}

// ─── Tab: Gantt ─────────────────────────────────────────
function GanttView({ issues }) {
  const [hoveredRow, setHoveredRow] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [hiddenEpics, setHiddenEpics] = useState(new Set());
  const containerRef = useRef(null);

  const gantt = useMemo(() => computeGanttData(issues), [issues]);

  const filteredRows = useMemo(() => {
    return gantt.rows.filter((r) => !hiddenEpics.has(r.epicKey));
  }, [gantt, hiddenEpics]);

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

  // Epic legend
  const epicKeys = useMemo(() => {
    const seen = new Map();
    for (const row of gantt.rows) {
      if (!seen.has(row.epicKey)) seen.set(row.epicKey, { name: row.epicName, color: row.color });
    }
    return seen;
  }, [gantt]);

  const toggleEpic = (key) => {
    setHiddenEpics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleMouseMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const ROW_HEIGHT = 32;
  const EPIC_ROW_HEIGHT = 28;

  if (gantt.rows.length === 0) {
    return <div className="text-center py-12 text-gray-400"><p className="text-lg mb-2">No issues to display on the timeline</p></div>;
  }

  return (
    <div>
      {/* Epic legend */}
      <div className="flex flex-wrap gap-2 mb-4">
        {Array.from(epicKeys.entries()).map(([key, { name, color }]) => {
          const hidden = hiddenEpics.has(key);
          return (
            <button
              key={key}
              onClick={() => toggleEpic(key)}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-all ${
                hidden ? "bg-gray-100 text-gray-400 border-gray-200 line-through" : `${color.light} ${color.text} ${color.border}`
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${hidden ? "bg-gray-300" : color.bg}`} />
              {name}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div ref={containerRef} className="relative bg-white rounded-xl border border-gray-200 overflow-auto" onMouseMove={handleMouseMove}>
        <div className="flex" style={{ minWidth: "1000px" }}>
          {/* Left: Row labels */}
          <div className="w-64 shrink-0 border-r border-gray-200 bg-gray-50/50">
            <div className="h-10 border-b border-gray-200 px-3 flex items-center">
              <span className="text-[10px] font-semibold text-gray-400 uppercase">Ticket</span>
            </div>
            {groupedRows.map((item, i) => {
              if (item.type === "epic") {
                return (
                  <div key={`epic-${item.key}-${i}`} className={`flex items-center gap-2 px-3 ${item.color.light} border-b border-t border-gray-200`} style={{ height: `${EPIC_ROW_HEIGHT}px` }}>
                    <span className={`w-2 h-2 rounded-full ${item.color.bg}`} />
                    <span className={`text-xs font-bold ${item.color.text} truncate`}>{item.name}</span>
                  </div>
                );
              }
              return (
                <div key={item.key} className="flex items-center gap-2 px-3 border-b border-gray-100 hover:bg-gray-50" style={{ height: `${ROW_HEIGHT}px` }}>
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
            <div className="absolute top-10 bottom-0 left-0 right-0">
              {Array.from({ length: Math.ceil(gantt.totalDays / 7) }).map((_, i) => {
                const pct = ((i * 7) / gantt.totalDays) * 100;
                return <div key={i} className="absolute top-0 bottom-0 w-px bg-gray-100" style={{ left: `${pct}%` }} />;
              })}
              <TodayMarker timelineStart={gantt.timelineStart} totalDays={gantt.totalDays} />
            </div>
            <div className="relative">
              {groupedRows.map((item, i) => {
                if (item.type === "epic") {
                  return <div key={`epic-${item.key}-${i}`} className={`${item.color.light} border-b border-t border-gray-200`} style={{ height: `${EPIC_ROW_HEIGHT}px` }} />;
                }
                return (
                  <div key={item.key} className="relative border-b border-gray-100" style={{ height: `${ROW_HEIGHT}px` }}>
                    <GanttBar row={item} timelineStart={gantt.timelineStart} totalDays={gantt.totalDays} onHover={setHoveredRow} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {hoveredRow && (
          <div className="absolute z-30 pointer-events-none" style={{ left: `${Math.min(mousePos.x + 12, (containerRef.current?.clientWidth || 800) - 280)}px`, top: `${mousePos.y + 12}px` }}>
            <GanttTooltip row={hoveredRow} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────
const DEFAULT_JQL = "project = TEAM ORDER BY status ASC, updated DESC";

const TABS = [
  { id: "list", label: "Task List", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { id: "gantt", label: "Gantt", icon: "M4 6h16M4 10h16M4 14h10M4 18h6" },
  { id: "calendar", label: "Calendar", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
];

export default function PlanningPage() {
  const [tab, setTab] = useState("list");
  const [scope, setScope] = useState("project"); // "project" or "pi"
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [jql, setJql] = useState(DEFAULT_JQL);
  const [inputJql, setInputJql] = useState(DEFAULT_JQL);
  const [piEnabled, setPiEnabled] = useState(false);
  const [piTeams, setPiTeams] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState("all");

  // Load config to check PI mode
  useEffect(() => {
    fetchConfig().then((cfg) => {
      const enabled = !!cfg.piConfig?.enabled;
      setPiEnabled(enabled);
      setPiTeams(cfg.teams || []);
    }).catch(() => {});
  }, []);

  // Load data based on scope
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (scope === "pi") {
          const result = await fetchPiOverview();
          setData(result);
        } else {
          const result = await fetchIssues(jql);
          setData(result);
        }
        toast.success("Planning data loaded");
      } catch (err) {
        setError(err.message);
        toast.error("Failed to load planning data");
      }
      setLoading(false);
    }
    load();
  }, [scope, jql]);

  // Normalize issues
  const { issues } = useMemo(() => {
    if (!data) return { issues: [] };
    return normalizeIssues(data, scope);
  }, [data, scope]);

  // Filter by team in PI mode
  const filteredIssues = useMemo(() => {
    if (scope !== "pi" || selectedTeam === "all") return issues;
    return issues.filter((i) => i.epicKey === selectedTeam);
  }, [issues, scope, selectedTeam]);

  // Stats
  const stats = useMemo(() => {
    const total = filteredIssues.length;
    const withDue = filteredIssues.filter((i) => i.dueDate).length;
    const overdue = filteredIssues.filter((i) => {
      const d = parseDate(i.dueDate);
      return d && d < new Date() && i.statusCategory !== "done";
    }).length;
    const inProgress = filteredIssues.filter((i) => i.statusCategory === "indeterminate").length;
    const done = filteredIssues.filter((i) => i.statusCategory === "done").length;
    return { total, withDue, overdue, inProgress, done };
  }, [filteredIssues]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">Planning</h1>

            {/* Scope toggle */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setScope("project")}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                  scope === "project" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Project
              </button>
              {piEnabled && (
                <button
                  onClick={() => setScope("pi")}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                    scope === "pi" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  PI Level
                </button>
              )}
            </div>
          </div>

          {/* JQL bar for project scope */}
          {scope === "project" && (
            <JqlBar value={inputJql} onChange={setInputJql} onSubmit={(q) => setJql(q)} />
          )}

          {/* Team filter for PI scope */}
          {scope === "pi" && piTeams.length > 0 && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-gray-500">Team:</span>
              <button
                onClick={() => setSelectedTeam("all")}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  selectedTeam === "all" ? "bg-blue-50 text-blue-600 border-blue-200" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                }`}
              >
                All Teams
              </button>
              {piTeams.map((t) => (
                <button
                  key={t.key || t.name}
                  onClick={() => setSelectedTeam(t.key || t.name)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    selectedTeam === (t.key || t.name) ? "bg-blue-50 text-blue-600 border-blue-200" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}

          {/* Stats bar */}
          {!loading && (
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
              <span><strong className="text-gray-900">{stats.total}</strong> issues</span>
              <span><strong className="text-gray-900">{stats.withDue}</strong> with due dates</span>
              {stats.overdue > 0 && <span className="text-red-600"><strong>{stats.overdue}</strong> overdue</span>}
              <span><strong className="text-blue-600">{stats.inProgress}</strong> in progress</span>
              <span><strong className="text-green-600">{stats.done}</strong> done</span>
            </div>
          )}

          {/* Tab bar */}
          <div className="flex items-center gap-1 mt-3 border-b border-gray-200 -mb-3 -mx-4 px-4">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
                </svg>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 mb-4">
            <strong>Error:</strong> {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-blue-200 border-t-blue-600 rounded-full" />
          </div>
        )}

        {!loading && filteredIssues.length > 0 && (
          <>
            {tab === "calendar" && <CalendarView issues={filteredIssues} />}
            {tab === "list" && <TaskListView issues={filteredIssues} />}
            {tab === "gantt" && <GanttView issues={filteredIssues} />}
          </>
        )}

        {!loading && filteredIssues.length === 0 && !error && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg mb-2">No issues found</p>
            <p className="text-sm">{scope === "project" ? "Try adjusting your JQL query" : "No PI data available"}</p>
          </div>
        )}
      </main>
    </div>
  );
}
