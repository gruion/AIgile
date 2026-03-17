"use client";

import { useState } from "react";
import Link from "next/link";
import IssueRow from "./IssueRow";

export default function EpicCard({ epic, jiraBaseUrl }) {
  const [expanded, setExpanded] = useState(true);
  const { stats, progress } = epic;
  const hasCritical = stats.criticalCount > 0;
  const hasWarning = stats.warningCount > 0;

  return (
    <div
      className={`bg-white rounded-xl border overflow-hidden ${
        hasCritical
          ? "border-red-200"
          : hasWarning
            ? "border-amber-200"
            : "border-gray-200"
      }`}
    >
      {/* Epic header */}
      <div
        className="px-4 py-3 cursor-pointer select-none hover:bg-gray-50/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-gray-400 text-sm">{expanded ? "v" : ">"}</span>
            <a
              href={`${jiraBaseUrl}/browse/${epic.key}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs font-mono text-blue-600 hover:underline shrink-0"
            >
              {epic.key}
            </a>
            <h3 className="text-sm font-semibold text-gray-800 truncate">
              {epic.name}
            </h3>
            <Link
              href={`/epic/${epic.key}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[10px] text-purple-600 hover:text-purple-800 hover:underline shrink-0"
            >
              AI Prompt
            </Link>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {/* Alert counters */}
            {stats.criticalCount > 0 && (
              <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                {stats.criticalCount} critical
              </span>
            )}
            {stats.warningCount > 0 && (
              <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                {stats.warningCount} warning
              </span>
            )}

            {/* Next deadline */}
            {stats.nextDeadline && (
              <span className="text-xs text-gray-500">
                Next:{" "}
                <span className="font-medium">
                  {new Date(stats.nextDeadline).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                  })}
                </span>
              </span>
            )}

            {/* Progress */}
            <div className="flex items-center gap-2 w-36">
              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    progress === 100
                      ? "bg-green-500"
                      : progress > 50
                        ? "bg-blue-500"
                        : "bg-amber-500"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 w-8 text-right">
                {progress}%
              </span>
            </div>

            {/* Status breakdown */}
            <div className="flex items-center gap-1 text-[10px]">
              <span className="text-gray-500">{stats.todo}t</span>
              <span className="text-blue-600">{stats.inProgress}p</span>
              <span className="text-green-600">{stats.done}d</span>
            </div>
          </div>
        </div>
      </div>

      {/* Issue list */}
      {expanded && (
        <div className="border-t border-gray-100">
          {/* Column headers */}
          <div className="flex items-center gap-3 px-4 py-1.5 bg-gray-50 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
            <span className="w-20">Key</span>
            <span className="flex-1">Summary</span>
            <span className="max-w-[200px]">Flags</span>
            <span className="w-20 text-center">Status</span>
            <span className="w-16 text-right">Due</span>
            <span className="w-24 text-right">Assignee</span>
            <span className="w-14 text-right">Updated</span>
            <span className="w-8 text-center">Cmt</span>
          </div>
          {epic.issues.map((issue) => (
            <IssueRow key={issue.key} issue={issue} jiraBaseUrl={jiraBaseUrl} />
          ))}
        </div>
      )}
    </div>
  );
}
