"use client";

import { useState, useRef, useCallback } from "react";

/**
 * IssueHoverCard — wraps a child element (typically a Jira key link) and shows
 * a floating detail card on hover. Positions itself intelligently relative to viewport.
 *
 * Props:
 *   issue: { key, summary, status, statusCategory, priority, assigneeName, assigneeAvatar,
 *            issueType, created, updated, dueDate, epicName, epicKey, labels, storyPoints, ... }
 *   children: the trigger element (e.g. <a>TEAM-1</a>)
 *   jiraBaseUrl: optional, for the "Open in Jira" link
 */

const STATUS_STYLES = {
  done: { bg: "bg-green-100", text: "text-green-700", dot: "bg-green-500" },
  indeterminate: { bg: "bg-blue-100", text: "text-blue-700", dot: "bg-blue-500" },
  new: { bg: "bg-gray-100", text: "text-gray-600", dot: "bg-gray-400" },
};

const PRIORITY_COLORS = {
  Highest: "text-red-600",
  High: "text-red-500",
  Medium: "text-orange-500",
  Low: "text-blue-500",
  Lowest: "text-blue-400",
};

function formatRelative(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

export default function IssueHoverCard({ issue, children, jiraBaseUrl }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, above: false });
  const triggerRef = useRef(null);
  const timeoutRef = useRef(null);

  const show = useCallback(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const viewH = window.innerHeight;
      const viewW = window.innerWidth;
      const cardH = 220;
      const cardW = 320;

      const above = rect.bottom + cardH + 8 > viewH && rect.top - cardH - 8 > 0;
      const top = above ? rect.top - 8 : rect.bottom + 8;
      let left = rect.left;
      if (left + cardW > viewW - 16) left = viewW - cardW - 16;
      if (left < 8) left = 8;

      setPos({ top, left, above });
      setVisible(true);
    }, 300);
  }, []);

  const hide = useCallback(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(false), 150);
  }, []);

  const keepOpen = useCallback(() => {
    clearTimeout(timeoutRef.current);
  }, []);

  if (!issue) return children;

  const sc = STATUS_STYLES[issue.statusCategory] || STATUS_STYLES.new;
  const dueDate = issue.dueDate ? new Date(issue.dueDate) : null;
  const isOverdue = dueDate && dueDate < new Date() && issue.statusCategory !== "done";

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        className="inline"
      >
        {children}
      </span>
      {visible && (
        <div
          className="fixed z-50 pointer-events-auto"
          style={{
            top: `${pos.top}px`,
            left: `${pos.left}px`,
            transform: pos.above ? "translateY(-100%)" : undefined,
          }}
          onMouseEnter={keepOpen}
          onMouseLeave={hide}
        >
          <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-[320px] overflow-hidden text-xs">
            {/* Header */}
            <div className="px-3 pt-3 pb-2 border-b border-gray-100">
              <div className="flex items-center gap-2 mb-1">
                {issue.issueTypeIcon && (
                  <img src={issue.issueTypeIcon} alt="" className="w-3.5 h-3.5" />
                )}
                <span className="font-mono font-bold text-blue-600">{issue.key}</span>
                <span className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${sc.bg} ${sc.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                  {issue.status}
                </span>
              </div>
              <p className="text-gray-900 font-medium leading-snug line-clamp-2">{issue.summary}</p>
            </div>

            {/* Details grid */}
            <div className="px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Priority</span>
                <span className={`font-medium ${PRIORITY_COLORS[issue.priority] || "text-gray-500"}`}>
                  {issue.priority || "None"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Assignee</span>
                <span className="text-gray-700 flex items-center gap-1.5">
                  {issue.assigneeAvatar && (
                    <img src={issue.assigneeAvatar} alt="" className="w-4 h-4 rounded-full" />
                  )}
                  {issue.assigneeName || issue.assignee || <span className="text-gray-300 italic">Unassigned</span>}
                </span>
              </div>
              {issue.issueType && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Type</span>
                  <span className="text-gray-700">{issue.issueType}</span>
                </div>
              )}
              {(issue.storyPoints != null || issue.originalEstimate) && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Estimate</span>
                  <span className="text-gray-700">
                    {issue.storyPoints != null ? `${issue.storyPoints} SP` : issue.originalEstimate}
                  </span>
                </div>
              )}
              {issue.epicName && issue.epicKey !== "__no_epic__" && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Epic</span>
                  <span className="text-gray-700 truncate ml-4">{issue.epicName}</span>
                </div>
              )}
              {dueDate && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Due</span>
                  <span className={isOverdue ? "text-red-600 font-semibold" : "text-gray-700"}>
                    {formatDate(issue.dueDate)}
                    {isOverdue && <span className="ml-1 text-[9px] bg-red-100 text-red-600 px-1 py-0.5 rounded">OVERDUE</span>}
                  </span>
                </div>
              )}
              {issue.labels?.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 shrink-0">Labels</span>
                  <div className="flex flex-wrap gap-1 justify-end ml-4">
                    {issue.labels.slice(0, 3).map((l) => (
                      <span key={l} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{l}</span>
                    ))}
                    {issue.labels.length > 3 && <span className="text-[9px] text-gray-400">+{issue.labels.length - 3}</span>}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            {(issue.created || issue.updated) && (
              <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
                {issue.created && <span>Created {formatRelative(issue.created)}</span>}
                {issue.updated && <span>Updated {formatRelative(issue.updated)}</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
