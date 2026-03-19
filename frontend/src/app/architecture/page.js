"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import JqlBar from "../../components/JqlBar";
import { fetchIssues, fetchSettings } from "../../lib/api";
import { selectTicketsForPrompt, formatTicketForPrompt, trimPrompt } from "../../lib/prompt-utils";
import { toast } from "../../components/Toaster";

const DEFAULT_JQL =
  process.env.NEXT_PUBLIC_DEFAULT_JQL ||
  "project = TEAM ORDER BY status ASC, updated DESC";
const JIRA_BASE_URL =
  process.env.NEXT_PUBLIC_JIRA_BASE_URL || "http://localhost:9080";

const STORAGE_KEY = "jira-dashboard-architecture-report";

// ─── Prompt builder ─────────────────────────────────────

function buildArchitecturePrompt(data, missingInfoCriteria, promptSettings = {}) {
  const today = new Date().toISOString().split("T")[0];
  const lines = [];

  lines.push(
    "You are a senior Agile coach and project architect. Analyze ALL the Jira tickets below and propose an optimal Epic / Story / Task / Sub-task hierarchy."
  );
  lines.push(
    "IMPORTANT: Return ONLY valid JSON, no markdown, no explanation, no code fences. Just the raw JSON object."
  );
  lines.push("");
  lines.push(`# Ticket Architecture Analysis — ${today}`);
  lines.push(`Total issues: ${data.total}`);
  lines.push("");

  // Board stats
  const s = data.stats;
  lines.push("## Current Board Statistics");
  lines.push(
    `- Total: ${s.total}, Done: ${s.done}, In Progress: ${s.inProgress}, To Do: ${s.todo}`
  );
  lines.push(
    `- Overdue: ${s.overdue}, Stale (7d+): ${s.stale}, Unassigned: ${s.unassigned}`
  );
  lines.push("");

  // Missing info criteria from settings
  lines.push("## Missing Information Criteria");
  lines.push(missingInfoCriteria);
  lines.push("");

  // Current epics
  if (data.epics?.length > 0) {
    lines.push("## Current Epics");
    for (const epic of data.epics) {
      lines.push(`### ${epic.key} — ${epic.name}`);
      lines.push(
        `- Progress: ${epic.progress}% (${epic.stats.done}/${epic.stats.total})`
      );
      lines.push(
        `- In Progress: ${epic.stats.inProgress}, To Do: ${epic.stats.todo}`
      );
      lines.push(
        `- Critical: ${epic.stats.criticalCount}, Warnings: ${epic.stats.warningCount}`
      );
      lines.push("");
    }
  }

  // All tickets
  // Smart ticket selection
  const allIssues = [
    ...(data.epics || []).flatMap((e) =>
      e.issues.map((i) => ({ ...i, epicKey: e.key, epicName: e.name }))
    ),
    ...(data.noEpic || []).map((i) => ({
      ...i,
      epicKey: null,
      epicName: "No Epic",
    })),
  ];

  const { selected, stats: selStats } = selectTicketsForPrompt(allIssues, promptSettings);

  if (selStats.excluded > 0) {
    lines.push(`## Tickets (${selStats.included} of ${selStats.total} — ${selStats.excluded} lower-priority tickets excluded to stay within budget)`);
  } else {
    lines.push("## All Tickets (full detail)");
  }

  for (const t of selected) {
    lines.push("");
    lines.push(formatTicketForPrompt(t, promptSettings));
    if (t.epicName) lines.push(`- Current Epic: ${t.epicName}`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    "Analyze ALL tickets above and return a single JSON object with this EXACT structure:"
  );
  lines.push("");
  lines.push(`{
  "analysis_summary": {
    "total_tickets": ${allIssues.length},
    "current_epics": ${data.epics?.length || 0},
    "orphan_tickets": ${data.noEpic?.length || 0},
    "key_findings": ["string — top 3-5 structural issues found"],
    "overall_health": "good | needs_work | critical"
  },
  "missing_info_audit": [
    {
      "key": "PROJ-123",
      "summary": "ticket title",
      "missing_fields": ["description", "acceptance_criteria", "due_date", "assignee", "estimate"],
      "severity": "critical | warning",
      "recommendation": "what to add and why"
    }
  ],
  "proposed_hierarchy": [
    {
      "type": "epic",
      "key": "PROJ-10 or NEW-EPIC-1 if new",
      "is_new": false,
      "current_name": "current name if existing",
      "proposed_name": "Proposed epic name — clear, goal-oriented",
      "proposed_description": "2-3 sentence description of this epic's scope and goal",
      "rationale": "why this grouping makes sense",
      "children": [
        {
          "type": "story",
          "key": "PROJ-20 or NEW-STORY-1 if new",
          "is_new": false,
          "current_name": "current name if existing",
          "proposed_name": "As a [role], I want [feature] so that [benefit]",
          "proposed_description": "Clear story description with context",
          "acceptance_criteria": ["AC 1", "AC 2", "AC 3"],
          "children": [
            {
              "type": "task",
              "key": "PROJ-30 or NEW-TASK-1 if new",
              "is_new": false,
              "current_name": "current name if existing",
              "proposed_name": "Clear actionable task name",
              "proposed_description": "What needs to be done, technically",
              "suggested_assignee": "name or null",
              "suggested_estimate": "2h / 1d / 3d etc",
              "children": [
                {
                  "type": "subtask",
                  "key": "NEW-SUB-1",
                  "is_new": true,
                  "proposed_name": "Specific sub-task",
                  "proposed_description": "Granular work item",
                  "suggested_estimate": "1h"
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "tickets_to_split": [
    {
      "key": "PROJ-45",
      "current_summary": "original title",
      "reason": "why it should be split",
      "proposed_splits": [
        { "proposed_name": "Split ticket 1", "type": "task", "description": "scope" },
        { "proposed_name": "Split ticket 2", "type": "task", "description": "scope" }
      ]
    }
  ],
  "tickets_to_merge": [
    {
      "keys": ["PROJ-12", "PROJ-13"],
      "reason": "why they are duplicates or should be merged",
      "proposed_name": "Merged ticket name",
      "proposed_type": "story"
    }
  ],
  "naming_improvements": [
    {
      "key": "PROJ-99",
      "current_name": "fix bug",
      "proposed_name": "Fix login timeout error when session expires after 30min",
      "reason": "Original name is vague, new name is specific and actionable"
    }
  ],
  "priority_recommendations": [
    {
      "key": "PROJ-55",
      "current_priority": "Medium",
      "recommended_priority": "High",
      "reason": "Blocks 3 other tickets and is overdue"
    }
  ],
  "action_plan": [
    {
      "priority": 1,
      "action": "Create epic 'NEW-EPIC-1: User Authentication Overhaul'",
      "tickets_affected": ["PROJ-12", "PROJ-13", "PROJ-45"],
      "effort": "low | medium | high",
      "impact": "description of impact"
    }
  ]
}`);

  return lines.join("\n");
}

// ─── Report renderer ──────────────────────────────────────

function JiraLink({ ticketKey }) {
  if (!ticketKey || ticketKey.startsWith("NEW-")) {
    return (
      <span className="text-xs font-mono text-purple-600 font-medium">
        {ticketKey}
      </span>
    );
  }
  return (
    <a
      href={`${JIRA_BASE_URL}/browse/${ticketKey}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs font-mono text-blue-600 hover:underline font-medium"
    >
      {ticketKey}
    </a>
  );
}

function SeverityBadge({ severity }) {
  const colors =
    severity === "critical"
      ? "bg-red-100 text-red-700"
      : "bg-amber-100 text-amber-700";
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${colors}`}>
      {severity}
    </span>
  );
}

function TypeBadge({ type }) {
  const colors = {
    epic: "bg-purple-100 text-purple-700",
    story: "bg-green-100 text-green-700",
    task: "bg-blue-100 text-blue-700",
    subtask: "bg-gray-100 text-gray-600",
  };
  return (
    <span
      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${colors[type] || colors.task}`}
    >
      {type}
    </span>
  );
}

function HierarchyNode({ node, depth = 0 }) {
  const indent = depth * 24;
  return (
    <>
      <div
        className="flex items-start gap-2 py-2 px-4 hover:bg-gray-50/50 border-b border-gray-50"
        style={{ paddingLeft: `${16 + indent}px` }}
      >
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          {depth > 0 && (
            <span className="text-gray-300 text-xs">{"└"}</span>
          )}
          <TypeBadge type={node.type} />
          <JiraLink ticketKey={node.key} />
          {node.is_new && (
            <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-green-50 text-green-600 border border-green-200">
              NEW
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-800">
            {node.proposed_name || node.current_name}
          </div>
          {node.current_name &&
            node.proposed_name &&
            node.current_name !== node.proposed_name && (
              <div className="text-[10px] text-gray-400 line-through mt-0.5">
                was: {node.current_name}
              </div>
            )}
          {node.proposed_description && (
            <div className="text-xs text-gray-500 mt-0.5">
              {node.proposed_description}
            </div>
          )}
          {node.acceptance_criteria?.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {node.acceptance_criteria.map((ac, i) => (
                <div key={i} className="text-[10px] text-gray-500 flex gap-1">
                  <span className="text-green-500">&#10003;</span> {ac}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {node.suggested_assignee && (
            <span className="text-[10px] text-gray-500">
              {node.suggested_assignee}
            </span>
          )}
          {node.suggested_estimate && (
            <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
              {node.suggested_estimate}
            </span>
          )}
        </div>
      </div>
      {node.children?.map((child, i) => (
        <HierarchyNode key={child.key || i} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

function ArchitectureReport({ report }) {
  const [activeSection, setActiveSection] = useState("hierarchy");

  const sections = [
    { key: "summary", label: "Summary" },
    { key: "hierarchy", label: "Proposed Hierarchy" },
    { key: "missing", label: "Missing Info Audit" },
    { key: "splits", label: "Splits & Merges" },
    { key: "naming", label: "Naming Fixes" },
    { key: "priorities", label: "Priority Fixes" },
    { key: "actions", label: "Action Plan" },
  ];

  return (
    <div className="space-y-4">
      {/* Section tabs */}
      <div className="flex flex-wrap gap-1">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setActiveSection(s.key)}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              activeSection === s.key
                ? "bg-blue-600 text-white"
                : "text-gray-500 hover:bg-gray-100 border border-gray-200"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Summary ── */}
      {activeSection === "summary" && report.analysis_summary && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-800">
                {report.analysis_summary.total_tickets}
              </div>
              <div className="text-xs text-gray-500">Total Tickets</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {report.analysis_summary.current_epics}
              </div>
              <div className="text-xs text-gray-500">Current Epics</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-600">
                {report.analysis_summary.orphan_tickets}
              </div>
              <div className="text-xs text-gray-500">Orphan Tickets</div>
            </div>
            <div className="text-center">
              <div
                className={`text-2xl font-bold ${
                  report.analysis_summary.overall_health === "good"
                    ? "text-green-600"
                    : report.analysis_summary.overall_health === "critical"
                      ? "text-red-600"
                      : "text-amber-600"
                }`}
              >
                {report.analysis_summary.overall_health}
              </div>
              <div className="text-xs text-gray-500">Health</div>
            </div>
          </div>
          {report.analysis_summary.key_findings?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">
                Key Findings
              </h4>
              <ul className="space-y-1">
                {report.analysis_summary.key_findings.map((f, i) => (
                  <li key={i} className="text-sm text-gray-600 flex gap-2">
                    <span className="text-amber-500 shrink-0">&#9679;</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Proposed Hierarchy ── */}
      {activeSection === "hierarchy" &&
        report.proposed_hierarchy?.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">
                Proposed Epic / Story / Task / Sub-task Hierarchy
              </h3>
              <p className="text-[10px] text-gray-400 mt-0.5">
                <span className="inline-block px-1 py-0.5 rounded bg-green-50 text-green-600 border border-green-200 mr-1">
                  NEW
                </span>{" "}
                = suggested new ticket to create
              </p>
            </div>
            {report.proposed_hierarchy.map((epic, i) => (
              <HierarchyNode key={epic.key || i} node={epic} depth={0} />
            ))}
          </div>
        )}

      {/* ── Missing Info Audit ── */}
      {activeSection === "missing" &&
        report.missing_info_audit?.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">
                Missing Information Audit ({report.missing_info_audit.length}{" "}
                tickets)
              </h3>
            </div>
            <div className="divide-y divide-gray-50">
              {report.missing_info_audit.map((item) => (
                <div
                  key={item.key}
                  className="px-4 py-3 hover:bg-gray-50/50"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <JiraLink ticketKey={item.key} />
                    <SeverityBadge severity={item.severity} />
                    <span className="text-sm text-gray-700 truncate">
                      {item.summary}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-1">
                    {item.missing_fields?.map((field) => (
                      <span
                        key={field}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600"
                      >
                        {field}
                      </span>
                    ))}
                  </div>
                  {item.recommendation && (
                    <p className="text-xs text-gray-500">
                      {item.recommendation}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      {activeSection === "missing" &&
        (!report.missing_info_audit ||
          report.missing_info_audit.length === 0) && (
          <div className="bg-green-50 rounded-xl border border-green-200 p-6 text-center text-sm text-green-700">
            All tickets pass the missing info audit!
          </div>
        )}

      {/* ── Splits & Merges ── */}
      {activeSection === "splits" && (
        <div className="space-y-4">
          {report.tickets_to_split?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-800">
                  Tickets to Split
                </h3>
              </div>
              <div className="divide-y divide-gray-50">
                {report.tickets_to_split.map((item) => (
                  <div key={item.key} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <JiraLink ticketKey={item.key} />
                      <span className="text-sm text-gray-700">
                        {item.current_summary}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">
                      {item.reason}
                    </p>
                    <div className="ml-4 space-y-1">
                      {item.proposed_splits?.map((split, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-gray-300 text-xs">{"→"}</span>
                          <TypeBadge type={split.type} />
                          <span className="text-sm text-gray-700">
                            {split.proposed_name}
                          </span>
                          {split.description && (
                            <span className="text-xs text-gray-400">
                              — {split.description}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.tickets_to_merge?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-800">
                  Tickets to Merge
                </h3>
              </div>
              <div className="divide-y divide-gray-50">
                {report.tickets_to_merge.map((item, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      {item.keys?.map((k) => (
                        <JiraLink key={k} ticketKey={k} />
                      ))}
                      <span className="text-xs text-gray-400">{"→"}</span>
                      <TypeBadge type={item.proposed_type || "story"} />
                      <span className="text-sm text-gray-700 font-medium">
                        {item.proposed_name}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{item.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(!report.tickets_to_split || report.tickets_to_split.length === 0) &&
            (!report.tickets_to_merge ||
              report.tickets_to_merge.length === 0) && (
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-500">
                No splits or merges suggested.
              </div>
            )}
        </div>
      )}

      {/* ── Naming Improvements ── */}
      {activeSection === "naming" &&
        report.naming_improvements?.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">
                Naming Improvements ({report.naming_improvements.length})
              </h3>
            </div>
            <div className="divide-y divide-gray-50">
              {report.naming_improvements.map((item) => (
                <div
                  key={item.key}
                  className="px-4 py-3 hover:bg-gray-50/50"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <JiraLink ticketKey={item.key} />
                  </div>
                  <div className="text-sm text-red-400 line-through">
                    {item.current_name}
                  </div>
                  <div className="text-sm text-green-700 font-medium">
                    {item.proposed_name}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{item.reason}</p>
                </div>
              ))}
            </div>
          </div>
        )}

      {/* ── Priority Recommendations ── */}
      {activeSection === "priorities" &&
        report.priority_recommendations?.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">
                Priority Recommendations (
                {report.priority_recommendations.length})
              </h3>
            </div>
            <div className="divide-y divide-gray-50">
              {report.priority_recommendations.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/50"
                >
                  <JiraLink ticketKey={item.key} />
                  <span className="text-xs text-gray-400">
                    {item.current_priority}
                  </span>
                  <span className="text-xs text-gray-400">{"→"}</span>
                  <span className="text-xs font-medium text-orange-600">
                    {item.recommended_priority}
                  </span>
                  <span className="text-xs text-gray-500 flex-1">
                    {item.reason}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      {/* ── Action Plan ── */}
      {activeSection === "actions" && report.action_plan?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-800">
              Action Plan (priority order)
            </h3>
          </div>
          <div className="divide-y divide-gray-50">
            {report.action_plan.map((item, i) => {
              const effortColor =
                item.effort === "low"
                  ? "bg-green-100 text-green-700"
                  : item.effort === "high"
                    ? "bg-red-100 text-red-700"
                    : "bg-amber-100 text-amber-700";
              return (
                <div key={i} className="px-4 py-3 hover:bg-gray-50/50">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                      #{item.priority}
                    </span>
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${effortColor}`}
                    >
                      {item.effort} effort
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 font-medium">
                    {item.action}
                  </p>
                  {item.tickets_affected?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {item.tickets_affected.map((k) => (
                        <JiraLink key={k} ticketKey={k} />
                      ))}
                    </div>
                  )}
                  {item.impact && (
                    <p className="text-xs text-gray-500 mt-1">{item.impact}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────

export default function ArchitecturePage() {
  const [jql, setJql] = useState(DEFAULT_JQL);
  const [inputJql, setInputJql] = useState(DEFAULT_JQL);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [missingInfoCriteria, setMissingInfoCriteria] = useState("");
  const [promptSettings, setPromptSettings] = useState({
    maxTickets: 100,
    maxPromptChars: 40000,
    includeDescriptions: true,
    includeComments: true,
    includeEstimates: true,
    includeDoneTickets: false,
  });
  const [promptStats, setPromptStats] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [activeTab, setActiveTab] = useState("data");
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [parseError, setParseError] = useState(null);
  const [report, setReport] = useState(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  // Load settings
  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setMissingInfoCriteria(s.missingInfoCriteria || "");
        if (s.promptSettings) setPromptSettings((prev) => ({ ...prev, ...s.promptSettings }));
        setSettingsLoaded(true);
      })
      .catch(() => {});
  }, []);

  const loadData = useCallback(
    async (query) => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchIssues(query);
        setData(result);
        toast.success(`Loaded ${result.total} issues`);
        const rawPrompt = buildArchitecturePrompt(result, missingInfoCriteria, promptSettings);
        const { prompt: finalPrompt, trimmed, charCount } = trimPrompt(rawPrompt, promptSettings.maxPromptChars);
        setPrompt(finalPrompt);
        setPromptStats({ charCount, trimmed, approxTokens: Math.round(charCount / 4) });
      } catch (err) {
        setError(err.message);
        toast.error(`Failed to load issues: ${err.message}`);
      }
      setLoading(false);
    },
    [missingInfoCriteria, promptSettings]
  );

  useEffect(() => {
    loadData(jql);
  }, [jql, loadData]);

  const promptWarnings = useMemo(() => {
    if (!data || !promptStats) return [];
    const warnings = [];
    const allIssues = [
      ...(data.epics || []).flatMap((e) => e.issues.map((i) => ({ ...i, epicKey: e.key }))),
      ...(data.noEpic || []).map((i) => ({ ...i, epicKey: null })),
    ];
    const doneCount = allIssues.filter((t) => t.statusCategory === "done").length;
    const { stats: selStats } = selectTicketsForPrompt(allIssues, promptSettings);

    if (promptStats.trimmed) {
      warnings.push({ level: "critical", msg: `Prompt was trimmed to fit the ${promptSettings.maxPromptChars.toLocaleString()} char limit. Some ticket data was cut off. Increase "Max prompt chars" in Settings.` });
    }
    if (selStats.excluded > 0) {
      warnings.push({ level: "warning", msg: `${selStats.excluded} tickets excluded (limit: ${promptSettings.maxTickets}). The AI won't see these. Increase "Max tickets" in Settings if needed.` });
    }
    if (!promptSettings.includeDoneTickets && doneCount > 10) {
      warnings.push({ level: "info", msg: `${doneCount} done tickets excluded (only 10 sampled). Enable "Done tickets" in Settings for full analysis.` });
    }
    if (!promptSettings.includeDescriptions) {
      warnings.push({ level: "warning", msg: `Descriptions are turned off. The AI will lack context about what each ticket is about. Enable in Settings > Prompt Control.` });
    }
    if (!promptSettings.includeComments) {
      warnings.push({ level: "info", msg: `Comments are turned off. The AI won't see discussion context. Enable in Settings > Prompt Control.` });
    }
    if (!settingsLoaded) {
      warnings.push({ level: "info", msg: `Using default prompt settings. Configure them in Settings > Prompt Control for better results.` });
    }
    return warnings;
  }, [data, promptStats, promptSettings, settingsLoaded]);

  const handleSearch = (e) => {
    e.preventDefault();
    setJql(inputJql);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleParse = () => {
    setParseError(null);
    try {
      let cleaned = jsonInput.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      const parsed = JSON.parse(cleaned);
      setReport(parsed);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      toast.success("Architecture analysis complete");
      setActiveTab("report");
    } catch (err) {
      setParseError(`Invalid JSON: ${err.message}`);
      toast.error(`Failed to parse AI response: ${err.message}`);
    }
  };

  const tabs = [
    { key: "data", label: "Jira Data" },
    { key: "prompt", label: "1. Copy Prompt" },
    { key: "paste", label: "2. Paste Response" },
    { key: "report", label: "3. View Report", disabled: !report },
  ];

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <h1 className="text-lg font-bold text-gray-900">Architecture</h1>
              {data && (
                <span className="text-xs text-gray-400">
                  {data.total} issues loaded
                </span>
              )}
            </div>
          </div>

          <JqlBar
            value={inputJql}
            onChange={setInputJql}
            onSubmit={(q) => setJql(q)}
          />

          {/* Tab bar */}
          <div className="flex items-center gap-1 mt-3">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => !t.disabled && setActiveTab(t.key)}
                disabled={t.disabled}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  activeTab === t.key
                    ? "bg-blue-600 text-white"
                    : t.disabled
                      ? "text-gray-300 cursor-not-allowed"
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

        {/* ── Jira Data tab ── */}
        {activeTab === "data" && !loading && data && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">
                Current Ticket Structure
              </h3>
              <div className="grid grid-cols-4 gap-4 text-center mb-4">
                <div>
                  <div className="text-2xl font-bold text-gray-800">
                    {data.total}
                  </div>
                  <div className="text-xs text-gray-500">Total</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-purple-600">
                    {data.epics?.length || 0}
                  </div>
                  <div className="text-xs text-gray-500">Epics</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-amber-600">
                    {data.noEpic?.length || 0}
                  </div>
                  <div className="text-xs text-gray-500">No Epic</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-600">
                    {data.stats?.unassigned || 0}
                  </div>
                  <div className="text-xs text-gray-500">Unassigned</div>
                </div>
              </div>

              {/* Epic list */}
              {data.epics?.map((epic) => (
                <div
                  key={epic.key}
                  className="border border-gray-100 rounded-lg p-3 mb-2"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <JiraLink ticketKey={epic.key} />
                    <span className="text-sm font-medium text-gray-800">
                      {epic.name}
                    </span>
                    <span className="text-xs text-gray-400">
                      {epic.stats.total} issues, {epic.progress}% done
                    </span>
                  </div>
                  <div className="ml-4 space-y-0.5">
                    {epic.issues.map((issue) => (
                      <div key={issue.key} className="flex items-center gap-2">
                        <JiraLink ticketKey={issue.key} />
                        <span className="text-xs text-gray-600 truncate">
                          {issue.summary}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            issue.statusCategory === "done"
                              ? "bg-green-100 text-green-700"
                              : issue.statusCategory === "indeterminate"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {issue.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Orphan tickets */}
              {data.noEpic?.length > 0 && (
                <div className="border border-amber-100 rounded-lg p-3 bg-amber-50/30">
                  <div className="text-sm font-medium text-amber-800 mb-1">
                    Orphan Tickets (no epic)
                  </div>
                  <div className="ml-4 space-y-0.5">
                    {data.noEpic.map((issue) => (
                      <div key={issue.key} className="flex items-center gap-2">
                        <JiraLink ticketKey={issue.key} />
                        <span className="text-xs text-gray-600 truncate">
                          {issue.summary}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          {issue.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="text-center">
              <button
                onClick={() => setActiveTab("prompt")}
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg"
              >
                Generate Architecture Prompt →
              </button>
            </div>
          </div>
        )}

        {/* ── Prompt tab ── */}
        {activeTab === "prompt" && (
          <div className="space-y-4">
            {promptWarnings.length > 0 && (
              <div className="space-y-1.5">
                {promptWarnings.map((w, i) => (
                  <div key={i} className={`rounded-lg px-4 py-2.5 text-xs flex items-start gap-2 ${
                    w.level === "critical" ? "bg-red-50 border border-red-200 text-red-700" :
                    w.level === "warning" ? "bg-amber-50 border border-amber-200 text-amber-700" :
                    "bg-gray-50 border border-gray-200 text-gray-600"
                  }`}>
                    <span className="shrink-0 mt-0.5">{w.level === "critical" ? "\u26A0" : w.level === "warning" ? "\u26A0" : "\u2139"}</span>
                    <span>{w.msg}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800">
                  Architecture Analysis Prompt
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    {prompt.length.toLocaleString()} chars
                    {promptStats && (
                      <span className="ml-1">
                        (~{promptStats.approxTokens.toLocaleString()} tokens)
                        {promptStats.trimmed && (
                          <span className="text-amber-500 ml-1">trimmed</span>
                        )}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={handleCopy}
                    className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                      copied
                        ? "bg-green-600 text-white"
                        : "bg-blue-600 hover:bg-blue-700 text-white"
                    }`}
                  >
                    {copied ? "Copied!" : "Copy Prompt"}
                  </button>
                </div>
              </div>
              <pre className="text-xs text-gray-600 bg-gray-50 rounded-lg p-4 max-h-[60vh] overflow-auto whitespace-pre-wrap font-mono border border-gray-100">
                {prompt}
              </pre>
            </div>

            <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
              <h4 className="text-sm font-semibold text-blue-800 mb-2">
                How to use
              </h4>
              <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
                <li>
                  Click &quot;Copy Prompt&quot; above to copy the full analysis
                  to your clipboard
                </li>
                <li>
                  Paste it into your AI assistant (ChatGPT, Claude, Gemini,
                  corporate chatbot, etc.)
                </li>
                <li>
                  Copy the JSON response and go to the &quot;2. Paste
                  Response&quot; tab
                </li>
              </ol>
            </div>
          </div>
        )}

        {/* ── Paste Response tab ── */}
        {activeTab === "paste" && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">
                Paste AI Response (JSON)
              </h3>
              <textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                placeholder="Paste the JSON response from your AI assistant here..."
                rows={15}
                className="w-full text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 resize-y"
              />
              {parseError && (
                <div className="mt-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
                  {parseError}
                </div>
              )}
              <button
                onClick={handleParse}
                disabled={!jsonInput.trim()}
                className="mt-3 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-6 py-2.5 rounded-lg"
              >
                Parse & View Report
              </button>
            </div>
          </div>
        )}

        {/* ── Report tab ── */}
        {activeTab === "report" && report && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">
                Architecture Report
              </h2>
              <button
                onClick={() => {
                  setReport(null);
                  localStorage.removeItem(STORAGE_KEY);
                  setActiveTab("prompt");
                }}
                className="text-xs text-gray-400 hover:text-red-500"
              >
                Clear Report
              </button>
            </div>
            <ArchitectureReport report={report} />
          </div>
        )}
      </main>
    </div>
  );
}
