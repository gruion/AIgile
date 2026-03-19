"use client";

import { useState, useEffect, useMemo } from "react";
import { fetchStandup } from "../../lib/api";
import AiCoachPanel from "../../components/AiCoachPanel";
import JqlBar from "../../components/JqlBar";
import { toast } from "../../components/Toaster";
import { useAppConfig } from "../../context/AppConfigContext";

const TIME_RANGES = [
  { label: "24h", hours: 24 },
  { label: "48h", hours: 48 },
  { label: "72h", hours: 72 },
];

const PRIORITY_COLORS = {
  Highest: "bg-red-100 text-red-800",
  High: "bg-orange-100 text-orange-800",
  Medium: "bg-yellow-100 text-yellow-800",
  Low: "bg-blue-100 text-blue-800",
  Lowest: "bg-gray-100 text-gray-600",
};

const STATUS_COLORS = {
  done: "bg-green-100 text-green-700 border-green-200",
  indeterminate: "bg-blue-100 text-blue-700 border-blue-200",
  new: "bg-gray-100 text-gray-600 border-gray-200",
};

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function PriorityBadge({ priority }) {
  const colors = PRIORITY_COLORS[priority] || "bg-gray-100 text-gray-600";
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${colors}`}>
      {priority || "None"}
    </span>
  );
}

function StatusBadge({ status, statusCategory }) {
  const colors = STATUS_COLORS[statusCategory] || STATUS_COLORS.new;
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${colors}`}>
      {status}
    </span>
  );
}

function IssueLink({ issueKey, jiraBaseUrl }) {
  return (
    <a
      href={`${jiraBaseUrl}/browse/${issueKey}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs font-mono font-semibold text-blue-600 hover:underline shrink-0"
    >
      {issueKey}
    </a>
  );
}

const CHANGE_TYPE_STYLE = {
  status: { label: "Status", color: "bg-blue-100 text-blue-700", icon: "\u21C4" },
  assignee: { label: "Assignee", color: "bg-purple-100 text-purple-700", icon: "\u{1F464}" },
  priority: { label: "Priority", color: "bg-orange-100 text-orange-700", icon: "\u2B06" },
  duedate: { label: "Due date", color: "bg-red-100 text-red-700", icon: "\u{1F4C5}" },
  labels: { label: "Labels", color: "bg-teal-100 text-teal-700", icon: "\u{1F3F7}" },
  summary: { label: "Title", color: "bg-gray-200 text-gray-700", icon: "\u270E" },
  description: { label: "Description", color: "bg-gray-200 text-gray-700", icon: "\u{1F4DD}" },
  resolution: { label: "Resolution", color: "bg-green-100 text-green-700", icon: "\u2705" },
  sprint: { label: "Sprint", color: "bg-indigo-100 text-indigo-700", icon: "\u{1F3C3}" },
  points: { label: "Points", color: "bg-yellow-100 text-yellow-700", icon: "\u{1F4CA}" },
  link: { label: "Link", color: "bg-cyan-100 text-cyan-700", icon: "\u{1F517}" },
};

function ChangeBadge({ type, detail }) {
  const style = CHANGE_TYPE_STYLE[type] || { label: type, color: "bg-gray-100 text-gray-600", icon: "\u2022" };
  return (
    <span className={`inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full ${style.color}`} title={detail || ""}>
      <span>{style.icon}</span>
      <span>{style.label}</span>
    </span>
  );
}

function DetailedIssueCard({ issue, showComments = true }) {
  const [expanded, setExpanded] = useState(false);
  const commentCount = issue.recentComments?.length || 0;
  const changes = issue.recentChanges || [];
  // Deduplicate change types for badge display, keep first occurrence per type
  const uniqueChangeTypes = [];
  const seen = new Set();
  for (const c of changes) {
    if (!seen.has(c.type)) {
      seen.add(c.type);
      uniqueChangeTypes.push(c);
    }
  }
  const hasActivity = commentCount > 0 || changes.length > 0;

  return (
    <div className="border border-gray-100 rounded-lg p-3 hover:bg-gray-50/50 transition-colors">
      <div className="flex items-start gap-2">
        <IssueLink jiraBaseUrl={jiraBaseUrl} issueKey={issue.key} />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-800 leading-snug">{issue.summary}</p>
          {issue.epicName && (
            <p className="text-[10px] text-gray-400 mt-0.5 truncate">Epic: {issue.epicName}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={issue.status} statusCategory={issue.statusCategory} />
          <PriorityBadge priority={issue.priority} />
        </div>
      </div>

      {/* Change badges row */}
      {(uniqueChangeTypes.length > 0 || commentCount > 0) && (
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          {uniqueChangeTypes.map((c, i) => (
            <ChangeBadge key={i} type={c.type} detail={c.detail} />
          ))}
          {commentCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
              <span>{"\u{1F4AC}"}</span>
              <span>{commentCount} comment{commentCount !== 1 ? "s" : ""}</span>
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-500">
        {issue.assignee && (
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {issue.assignee}
          </span>
        )}
        {issue.issueType && (
          <span className="text-gray-400">{issue.issueType}</span>
        )}
        <span className="text-gray-400" title={new Date(issue.updated).toLocaleString()}>
          Updated {timeAgo(issue.updated)}
        </span>
        {issue.dueDate && (
          <span className={`${new Date(issue.dueDate) < new Date() ? "text-red-500 font-medium" : "text-gray-400"}`}>
            Due {new Date(issue.dueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
          </span>
        )}
        {issue.labels?.length > 0 && (
          <div className="flex gap-1">
            {issue.labels.slice(0, 3).map(l => (
              <span key={l} className="px-1 py-0.5 rounded bg-gray-100 text-gray-500 text-[9px]">{l}</span>
            ))}
          </div>
        )}
      </div>

      {/* Expandable detail: changes + comments */}
      {hasActivity && showComments && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 mt-2 text-[10px] text-blue-500 hover:text-blue-700 cursor-pointer"
        >
          <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          {expanded ? "Hide" : "Show"} activity ({changes.length} change{changes.length !== 1 ? "s" : ""}{commentCount > 0 ? `, ${commentCount} comment${commentCount !== 1 ? "s" : ""}` : ""})
        </button>
      )}

      {expanded && hasActivity && (
        <div className="mt-2 ml-1 pl-3 border-l-2 border-blue-200 space-y-1.5">
          {/* Merge changes and comments into a timeline, sorted newest first */}
          {[
            ...changes.map(c => ({ kind: "change", ...c })),
            ...(issue.recentComments || []).map(c => ({ kind: "comment", ...c })),
          ]
            .sort((a, b) => new Date(b.created) - new Date(a.created))
            .map((entry, i) => (
              <div key={i} className="text-[11px] flex items-start gap-2">
                <span className="text-gray-400 shrink-0 w-12 text-right">{timeAgo(entry.created)}</span>
                {entry.kind === "change" ? (
                  <div className="flex items-center gap-1.5">
                    <ChangeBadge type={entry.type} detail={entry.detail} />
                    <span className="text-gray-600">{entry.detail}</span>
                    <span className="text-gray-400">by {entry.author}</span>
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-gray-700">{entry.author}</span>
                    <span className="text-gray-400 ml-1">commented</span>
                    <p className="text-gray-600 leading-relaxed whitespace-pre-wrap mt-0.5 line-clamp-3">{entry.body}</p>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, count, color, icon }) {
  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">{label}</span>
        <span className="text-sm">{icon}</span>
      </div>
      <p className="text-2xl font-bold mt-1">{count}</p>
    </div>
  );
}

function SectionHeader({ title, count, accentColor, subtitle }) {
  return (
    <div className={`flex items-center gap-2 mb-3 pl-3 border-l-4 ${accentColor}`}>
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-[10px] text-gray-400">{subtitle}</p>}
      </div>
      {count != null && (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
          {count}
        </span>
      )}
    </div>
  );
}

function WorkloadBar({ inProgress, todo, total }) {
  const maxBar = Math.max(total, 1);
  const wipPct = Math.round((inProgress / maxBar) * 100);
  const todoPct = Math.round((todo / maxBar) * 100);
  return (
    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden flex">
      <div className="h-full bg-blue-500 rounded-l" style={{ width: `${wipPct}%` }} />
      <div className="h-full bg-gray-300" style={{ width: `${todoPct}%` }} />
    </div>
  );
}

function CommentFeed({ comments }) {
  const [showAll, setShowAll] = useState(false);
  if (!comments || comments.length === 0) return null;
  const displayed = showAll ? comments : comments.slice(0, 8);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <SectionHeader title="Recent Comments" count={comments.length} accentColor="border-indigo-500" subtitle="Latest comments across all issues" />
      <div className="space-y-3">
        {displayed.map((c, i) => (
          <div key={i} className="border-b border-gray-50 pb-2 last:border-0 last:pb-0">
            <div className="flex items-center gap-2 mb-1">
              <IssueLink jiraBaseUrl={jiraBaseUrl} issueKey={c.issueKey} />
              <span className="text-[10px] text-gray-400 truncate flex-1">{c.issueSummary}</span>
              <span className="text-[10px] text-gray-400 shrink-0">{timeAgo(c.created)}</span>
            </div>
            <div className="ml-1 pl-3 border-l-2 border-indigo-100">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[11px] font-medium text-gray-700">{c.author}</span>
                {c.status && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-500">{c.status}</span>
                )}
              </div>
              <p className="text-[11px] text-gray-600 leading-relaxed whitespace-pre-wrap line-clamp-3">{c.body}</p>
            </div>
          </div>
        ))}
      </div>
      {comments.length > 8 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-[11px] text-blue-600 hover:text-blue-800 mt-2 font-medium"
        >
          {showAll ? "Show less" : `Show all ${comments.length} comments`}
        </button>
      )}
    </div>
  );
}

// ─── Helper: filter data by assignee ───────────────────────
function filterDataByUser(data, user) {
  if (!data || !user) return data;
  const match = (issue) => issue.assignee === user;
  const filtered = {
    ...data,
    recentlyUpdated: (data.recentlyUpdated || []).filter(match),
    newlyCreated: (data.newlyCreated || []).filter(match),
    recentlyResolved: (data.recentlyResolved || []).filter(match),
    blocked: (data.blocked || []).filter(match),
    approachingDue: (data.approachingDue || []).filter(match),
    stale: (data.stale || []).filter(match),
    recentComments: (data.recentComments || []).filter(c => c.assignee === user),
    workload: data.workload?.[user] ? { [user]: data.workload[user] } : {},
  };
  filtered.summary = {
    updatedCount: filtered.recentlyUpdated.length,
    createdCount: filtered.newlyCreated.length,
    resolvedCount: filtered.recentlyResolved.length,
    blockedCount: filtered.blocked.length,
    staleCount: filtered.stale.length,
    approachingDueCount: filtered.approachingDue.length,
    recentCommentCount: filtered.recentComments.length,
  };
  return filtered;
}

// ─── Standup content for a tab ─────────────────────────────
function StandupContent({ data, hours, prompts }) {
  const summary = data?.summary || {};
  const workload = data?.workload || {};

  return (
    <>
      {/* AI Coach Panel */}
      <div className="mb-4">
        <AiCoachPanel
          context={prompts._context || "Daily Standup Dashboard"}
          data={data}
          prompts={prompts}
        />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <SummaryCard label="Updated" count={summary.updatedCount || 0} color="bg-blue-50 border-blue-200 text-blue-900" icon="&#x1F504;" />
        <SummaryCard label="Created" count={summary.createdCount || 0} color="bg-purple-50 border-purple-200 text-purple-900" icon="&#x2728;" />
        <SummaryCard label="Resolved" count={summary.resolvedCount || 0} color="bg-green-50 border-green-200 text-green-900" icon="&#x2705;" />
        <SummaryCard label="Comments" count={summary.recentCommentCount || 0} color="bg-indigo-50 border-indigo-200 text-indigo-900" icon="&#x1F4AC;" />
        <SummaryCard label="Blocked" count={summary.blockedCount || 0} color="bg-red-50 border-red-200 text-red-900" icon="&#x1F6D1;" />
        <SummaryCard label="Stale" count={summary.staleCount || 0} color="bg-gray-50 border-gray-300 text-gray-900" icon="&#x1F4A4;" />
        <SummaryCard label="Due Soon" count={summary.approachingDueCount || 0} color="bg-orange-50 border-orange-200 text-orange-900" icon="&#x23F0;" />
      </div>

      {/* Main Content: 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-5">
          {data.recentlyUpdated?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <SectionHeader title="Recently Updated" count={data.recentlyUpdated.length} accentColor="border-blue-500" subtitle={`Issues with activity in the last ${hours}h`} />
              <div className="space-y-2">
                {data.recentlyUpdated.map((issue) => (
                  <DetailedIssueCard key={issue.key} issue={issue} />
                ))}
              </div>
            </div>
          )}

          {data.blocked?.length > 0 && (
            <div className="bg-white rounded-xl border border-red-100 p-4">
              <SectionHeader title="Blocked Items" count={data.blocked.length} accentColor="border-red-500" subtitle="Items with 'block' label" />
              <div className="space-y-2">
                {data.blocked.map((issue) => (
                  <DetailedIssueCard key={issue.key} issue={issue} />
                ))}
              </div>
            </div>
          )}

          {data.approachingDue?.length > 0 && (
            <div className="bg-white rounded-xl border border-orange-100 p-4">
              <SectionHeader title="Approaching Due" count={data.approachingDue.length} accentColor="border-orange-500" subtitle="Due within 3 days" />
              <div className="space-y-2">
                {data.approachingDue.map((issue) => (
                  <div key={issue.key} className="border border-gray-100 rounded-lg p-3 hover:bg-gray-50/50 transition-colors">
                    <div className="flex items-start gap-2">
                      <IssueLink jiraBaseUrl={jiraBaseUrl} issueKey={issue.key} />
                      <p className="text-xs text-gray-800 flex-1 min-w-0">{issue.summary}</p>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                        issue.daysLeft <= 1 ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"
                      }`}>
                        {issue.daysLeft === 0 ? "Today" : `${issue.daysLeft}d left`}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
                      {issue.assignee && <span>{issue.assignee}</span>}
                      <StatusBadge status={issue.status} statusCategory={issue.statusCategory} />
                      <PriorityBadge priority={issue.priority} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.recentlyResolved?.length > 0 && (
            <div className="bg-white rounded-xl border border-green-100 p-4">
              <SectionHeader title="Recently Resolved" count={data.recentlyResolved.length} accentColor="border-green-500" subtitle="Completed in this period" />
              <div className="space-y-2">
                {data.recentlyResolved.map((issue) => (
                  <DetailedIssueCard key={issue.key} issue={issue} showComments={false} />
                ))}
              </div>
            </div>
          )}

          {data.stale?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <SectionHeader title="Stale Items" count={data.stale.length} accentColor="border-gray-400" subtitle="In Progress but no update in 7+ days" />
              <div className="space-y-2">
                {data.stale.map((issue) => (
                  <div key={issue.key} className="border border-gray-100 rounded-lg p-3 hover:bg-gray-50/50 transition-colors">
                    <div className="flex items-start gap-2">
                      <IssueLink jiraBaseUrl={jiraBaseUrl} issueKey={issue.key} />
                      <p className="text-xs text-gray-800 flex-1 min-w-0">{issue.summary}</p>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 shrink-0">
                        {issue.staleDays}d stale
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
                      {issue.assignee && <span>{issue.assignee}</span>}
                      <StatusBadge status={issue.status} statusCategory={issue.statusCategory} />
                      <span className="text-gray-400">Last updated {timeAgo(issue.updated)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Team Workload</h3>
            {Object.keys(workload).length === 0 ? (
              <p className="text-xs text-gray-400">No workload data</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(workload)
                  .sort(([, a], [, b]) => b.inProgress - a.inProgress)
                  .map(([person, w]) => {
                    const overWip = w.inProgress > 3;
                    return (
                      <div
                        key={person}
                        className={`rounded-lg border p-2.5 ${
                          overWip ? "border-red-200 bg-red-50" : "border-gray-100 bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-medium text-gray-900 truncate">{person}</span>
                          <div className="flex items-center gap-2 text-[10px] shrink-0">
                            <span className={`font-semibold ${overWip ? "text-red-600" : "text-blue-600"}`}>
                              {w.inProgress} WIP
                            </span>
                            <span className="text-gray-400">{w.todo} todo</span>
                          </div>
                        </div>
                        <WorkloadBar inProgress={w.inProgress} todo={w.todo} total={w.total} />
                        {overWip && (
                          <p className="text-[10px] text-red-600 mt-1 font-medium">Over WIP limit (3)</p>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <CommentFeed comments={data.recentComments} />

          {data.newlyCreated?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <SectionHeader title="Newly Created" count={data.newlyCreated.length} accentColor="border-purple-500" subtitle="Created in this period" />
              <div className="space-y-2">
                {data.newlyCreated.map((issue) => (
                  <div key={issue.key} className="border border-gray-100 rounded-lg p-2.5 hover:bg-gray-50/50 transition-colors">
                    <div className="flex items-start gap-2">
                      <IssueLink jiraBaseUrl={jiraBaseUrl} issueKey={issue.key} />
                      <p className="text-xs text-gray-800 flex-1 min-w-0 truncate">{issue.summary}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-500">
                      {issue.assignee ? <span>{issue.assignee}</span> : <span className="text-orange-500">Unassigned</span>}
                      <span className="text-gray-400">{issue.issueType}</span>
                      <PriorityBadge priority={issue.priority} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

    </>
  );
}

// ─── AI Prompt builders ────────────────────────────────────

function buildUserPrompts(userName) {
  return [
    {
      label: `${userName}'s Standup Report`,
      question: `Generate a personal standup report for ${userName} covering:

1. **WHAT I DID**: Summarize recently updated and resolved tickets. Reference ticket keys and status changes.

2. **WHAT I'M WORKING ON**: List current in-progress items with status and any blockers.

3. **BLOCKERS & RISKS**: Any blocked or stale items. What help is needed?

4. **UPCOMING**: Items approaching due date or in the backlog.

Format as a standup update that ${userName} can paste into a team channel.`,
      primary: true,
    },
    {
      label: "My blockers",
      question: `What are ${userName}'s current blockers and risks? How can they be unblocked?`,
    },
    {
      label: "My priorities",
      question: `Based on due dates, priority levels, and status, what should ${userName} focus on today? Rank the items.`,
    },
  ];
}

function buildGlobalPrompts(teamMembers) {
  const memberList = teamMembers.join(", ");
  return [
    {
      label: "Complete Team Standup",
      question: `Generate a complete daily standup report for the ENTIRE team (${memberList}). Cover ALL of the following:

1. **TEAM STANDUP SUMMARY**: High-level overview — what happened, what's in progress, what needs attention.

2. **PER-PERSON UPDATE**: For EACH team member, summarize:
   - What they completed/updated recently
   - What they're currently working on (in progress items)
   - Any blockers or risks on their items
   - Upcoming due dates

3. **BLOCKERS & RISKS**: All blocked and stale items across the team. Impact assessment and suggested actions.

4. **TEAM CAPACITY**: Who is overloaded? Who has capacity? Suggest rebalancing if needed.

5. **TOP ACTION ITEMS**: The 5 most important things the team should address today, with owners.

6. **RECENT ACTIVITY**: Notable comments, status changes, and resolved items.

Format clearly with headers. This should be comprehensive enough to replace a live standup meeting for the whole team.`,
      primary: true,
    },
    {
      label: "Standup summary",
      question: "Summarize the key points for today's standup based on this data. What should the team focus on?",
    },
    {
      label: "Blockers analysis",
      question: "Analyze the current blockers and stale items. What's the impact and what should we do?",
    },
    {
      label: "Team capacity",
      question: "Is the team overloaded? Analyze the workload distribution and suggest rebalancing if needed.",
    },
    {
      label: "Action items",
      question: "What are the top 3 action items coming out of this standup data?",
    },
  ];
}

// ─── Main Page ─────────────────────────────────────────────

export default function StandupPage() {
  const { defaultJql, jiraBaseUrl } = useAppConfig();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");
  const [activeTab, setActiveTab] = useState("all");

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
      setLoading(true);
      try {
        const result = await fetchStandup(hours, jql);
        if (!cancelled) setData(result);
      } catch (err) {
        toast.error("Failed to load standup data");
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [hours, jql]);

  // Extract unique team members from workload + all issues
  const teamMembers = useMemo(() => {
    if (!data) return [];
    const names = new Set();
    if (data.workload) Object.keys(data.workload).forEach(n => { if (n !== "Unassigned") names.add(n); });
    for (const list of [data.recentlyUpdated, data.newlyCreated, data.recentlyResolved, data.blocked, data.approachingDue, data.stale]) {
      (list || []).forEach(i => { if (i.assignee) names.add(i.assignee); });
    }
    return [...names].sort();
  }, [data]);

  // Build tabs
  const tabs = useMemo(() => {
    const t = [{ key: "all", label: "All" }];
    teamMembers.forEach(name => {
      // Use first name + last initial for tab label
      const parts = name.split(" ");
      const short = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
      t.push({ key: name, label: short });
    });
    return t;
  }, [teamMembers]);

  // Filter data for active tab
  const tabData = useMemo(() => {
    if (!data) return null;
    if (activeTab === "all") return data;
    return filterDataByUser(data, activeTab);
  }, [data, activeTab]);

  // Build prompts for active tab
  const tabPrompts = useMemo(() => {
    if (activeTab === "all") return buildGlobalPrompts(teamMembers);
    return buildUserPrompts(activeTab);
  }, [activeTab, teamMembers]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Daily Standup</h1>
            {data?.since && (
              <p className="text-xs text-gray-500 mt-0.5">
                Changes since {new Date(data.since).toLocaleString()}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-0.5">
            {TIME_RANGES.map((r) => (
              <button
                key={r.hours}
                onClick={() => setHours(r.hours)}
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                  hours === r.hours
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* JQL Bar */}
        <JqlBar
          value={inputJql}
          onChange={setInputJql}
          onSubmit={(q) => setJql(q)}
        />

        {/* User Tabs */}
        {!loading && data && tabs.length > 1 && (
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    activeTab === tab.key
                      ? "bg-blue-600 text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && !data && !jql && (
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
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="w-6 h-6 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="ml-2 text-sm text-gray-500">Loading standup data...</span>
          </div>
        ) : tabData ? (
          <div className="space-y-6">
            <StandupContent data={tabData} hours={hours} prompts={tabPrompts} />
          </div>
        ) : (
          <div className="text-center py-20 text-sm text-gray-400">
            No standup data available.
          </div>
        )}
      </div>
    </div>
  );
}
