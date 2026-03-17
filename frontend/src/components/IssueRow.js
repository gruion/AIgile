"use client";

import { useState } from "react";
import UrgencyBadge from "./UrgencyBadge";

const STATUS_COLORS = {
  new: "bg-gray-200 text-gray-700",
  indeterminate: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
};

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export default function IssueRow({ issue, jiraBaseUrl }) {
  const [showComment, setShowComment] = useState(false);
  const statusStyle = STATUS_COLORS[issue.statusCategory] || STATUS_COLORS.new;
  const jiraUrl = `${jiraBaseUrl}/browse/${issue.key}`;
  const isOverdue = issue.urgencyFlags.some((f) => f.type === "overdue");

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/50 transition-colors">
        {/* Key + Type */}
        <a
          href={jiraUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-mono text-blue-600 hover:underline w-20 shrink-0"
        >
          {issue.key}
        </a>

        {/* Summary */}
        <p className="flex-1 text-sm text-gray-800 truncate min-w-0">
          {issue.summary}
        </p>

        {/* Urgency flags */}
        <div className="flex flex-wrap gap-1 shrink-0 max-w-[200px]">
          {issue.urgencyFlags.map((flag, i) => (
            <UrgencyBadge key={i} flag={flag} />
          ))}
        </div>

        {/* Status */}
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${statusStyle}`}
        >
          {issue.status}
        </span>

        {/* Due date */}
        <span
          className={`text-xs w-16 text-right shrink-0 ${
            isOverdue ? "text-red-600 font-semibold" : "text-gray-500"
          }`}
        >
          {formatDate(issue.dueDate)}
        </span>

        {/* Assignee */}
        <span className="text-xs text-gray-500 w-24 truncate text-right shrink-0">
          {issue.assigneeName || "—"}
        </span>

        {/* Last update */}
        <span className="text-[10px] text-gray-400 w-14 text-right shrink-0">
          {timeAgo(issue.updated)}
        </span>

        {/* Comment toggle */}
        {issue.lastComment && (
          <button
            onClick={() => setShowComment(!showComment)}
            className="text-[10px] text-gray-400 hover:text-gray-600 shrink-0 w-8 text-center"
            title="Toggle last comment"
          >
            {issue.commentCount}
          </button>
        )}
        {!issue.lastComment && <span className="w-8 shrink-0" />}
      </div>

      {/* Expanded last comment */}
      {showComment && issue.lastComment && (
        <div className="px-4 pb-3 ml-20">
          <div className="bg-gray-50 rounded-md p-3 text-xs border border-gray-100">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-gray-700">
                {issue.lastComment.author}
              </span>
              <span className="text-gray-400">
                {timeAgo(issue.lastComment.date)}
              </span>
            </div>
            <p className="text-gray-600 whitespace-pre-wrap leading-relaxed">
              {issue.lastComment.body}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
