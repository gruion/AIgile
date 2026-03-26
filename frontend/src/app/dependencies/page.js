"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { fetchDependencies, discoverDependencies, fetchConfig } from "../../lib/api";
import AiCoachPanel from "../../components/AiCoachPanel";
import JqlBar from "../../components/JqlBar";
import { toast } from "../../components/Toaster";
import { useAppConfig } from "../../context/AppConfigContext";

const DEP_TYPE_COLORS = {
  blocks: "bg-red-100 text-red-800 border-red-200",
  shared_component: "bg-blue-100 text-blue-800 border-blue-200",
  data_dependency: "bg-purple-100 text-purple-800 border-purple-200",
  sequential: "bg-orange-100 text-orange-800 border-orange-200",
  resource_conflict: "bg-yellow-100 text-yellow-800 border-yellow-200",
  duplicate: "bg-gray-100 text-gray-700 border-gray-200",
  risk: "bg-red-100 text-red-800 border-red-200",
};

const CONFIDENCE_COLORS = {
  high: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-gray-100 text-gray-600",
};

const IMPACT_COLORS = {
  high: "bg-red-100 text-red-800",
  medium: "bg-orange-100 text-orange-800",
  low: "bg-blue-100 text-blue-800",
};

const SEVERITY_COLORS = {
  high: "bg-red-100 text-red-800 border-red-300",
  medium: "bg-orange-100 text-orange-800 border-orange-300",
  low: "bg-yellow-100 text-yellow-800 border-yellow-300",
};

const AI_PROMPTS = [
  { label: "Dependency analysis", question: "Analyze the cross-project dependencies. Which are the most critical and what should we address first?" },
  { label: "Planning impact", question: "How do these dependencies affect our planning? What should we schedule first?" },
  { label: "Risk mitigation", question: "What's the best strategy to mitigate cross-project dependency risks?" },
  { label: "Coordination plan", question: "Suggest a coordination plan for managing these cross-project dependencies." },
];

function projectColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "bg-blue-100 text-blue-800 border-blue-300",
    "bg-green-100 text-green-800 border-green-300",
    "bg-purple-100 text-purple-800 border-purple-300",
    "bg-orange-100 text-orange-800 border-orange-300",
    "bg-pink-100 text-pink-800 border-pink-300",
    "bg-teal-100 text-teal-800 border-teal-300",
    "bg-indigo-100 text-indigo-800 border-indigo-300",
    "bg-cyan-100 text-cyan-800 border-cyan-300",
    "bg-amber-100 text-amber-800 border-amber-300",
    "bg-rose-100 text-rose-800 border-rose-300",
  ];
  return colors[Math.abs(hash) % colors.length];
}

function ProjectBadge({ project }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${projectColor(project)}`}>
      {project}
    </span>
  );
}

function ClickableProjectBadge({ project, onClick, selectedFilter }) {
  const isActive = selectedFilter?.length === 1 && selectedFilter[0] === project;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(project); }}
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border cursor-pointer transition-all hover:ring-2 hover:ring-blue-300 ${
        isActive ? "ring-2 ring-blue-400 shadow-sm" : ""
      } ${projectColor(project)}`}
      title={`Filter by ${project}`}
    >
      {project}
    </button>
  );
}

function JiraLink({ issueKey, jiraBaseUrl, children }) {
  return (
    <a
      href={`${jiraBaseUrl}/browse/${issueKey}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-700 hover:text-blue-900 hover:underline font-mono text-xs"
    >
      {children || issueKey}
    </a>
  );
}

function StatCard({ label, value, color = "text-gray-900" }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col items-center">
      <span className={`text-2xl font-bold ${color}`}>{value}</span>
      <span className="text-xs text-gray-500 mt-1 text-center">{label}</span>
    </div>
  );
}

function LinkTypeBadge({ type }) {
  const label = type ? type.replace(/_/g, " ") : "related";
  const color = DEP_TYPE_COLORS[type] || "bg-gray-100 text-gray-700 border-gray-200";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${color}`}>
      {label}
    </span>
  );
}

function StatusBadge({ status }) {
  if (!status) return null;
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600 border border-gray-200">
      {status}
    </span>
  );
}

function ConfidenceBadge({ confidence }) {
  const c = CONFIDENCE_COLORS[confidence] || CONFIDENCE_COLORS.low;
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${c}`}>
      {confidence}
    </span>
  );
}

function ImpactBadge({ impact }) {
  const c = IMPACT_COLORS[impact] || IMPACT_COLORS.low;
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${c}`}>
      {impact} impact
    </span>
  );
}

function Spinner({ text }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-gray-500">
      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-sm">{text}</span>
    </div>
  );
}

// ─── Blocking Tree Node ───────────────────────────────────────────────────────

function BlockingTreeNode({ node, depth = 0, jiraBaseUrl }) {
  const [expanded, setExpanded] = useState(depth < 2); // auto-expand first 2 levels
  const hasChildren = node.children && node.children.length > 0;
  const isRoot = depth === 0;

  const statusColor =
    node.statusCategory === "done" ? "bg-green-100 text-green-700" :
    node.statusCategory === "indeterminate" ? "bg-blue-100 text-blue-700" :
    "bg-gray-100 text-gray-600";

  const priorityColor =
    node.priority === "Highest" || node.priority === "Blocker" ? "text-red-600" :
    node.priority === "High" ? "text-orange-600" :
    "text-gray-500";

  return (
    <div className={isRoot ? "" : "ml-6 border-l-2 border-red-200"}>
      <div className={`flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 transition-colors ${
        isRoot ? "bg-red-50 border border-red-200 rounded-lg px-3 py-2" : ""
      }`}>
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 shrink-0"
          >
            <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <span className="w-5 h-5 flex items-center justify-center shrink-0">
            <span className={`w-2 h-2 rounded-full ${node.statusCategory === "done" ? "bg-green-400" : "bg-red-400"}`} />
          </span>
        )}

        {/* Connector — parent blocks this ticket */}
        {!isRoot && (
          <span className="text-[8px] text-red-400 font-medium shrink-0">← blocks</span>
        )}

        {/* Project badge */}
        <ProjectBadge project={node.project} />

        {/* Ticket key */}
        <JiraLink issueKey={node.key} jiraBaseUrl={jiraBaseUrl} />

        {/* Status */}
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor}`}>
          {node.status}
        </span>

        {/* Priority */}
        {node.priority && (
          <span className={`text-[10px] font-medium ${priorityColor}`}>
            {node.priority}
          </span>
        )}

        {/* Summary */}
        <span className="text-xs text-gray-600 truncate flex-1 min-w-0">{node.summary}</span>

        {/* Assignee */}
        {node.assignee && (
          <span className="text-[10px] text-gray-400 shrink-0">{node.assignee}</span>
        )}

        {/* Block count badge */}
        {hasChildren && (
          <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full shrink-0">
            blocks {node.blocksCount}
          </span>
        )}
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div className="mt-0.5">
          {node.children.map((child) => (
            <BlockingTreeNode key={child.key} node={child} depth={depth + 1} jiraBaseUrl={jiraBaseUrl} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Jira Links Tab ───────────────────────────────────────────────────────────

function JiraLinksTab({ data, loading, jiraBaseUrl }) {
  const [crossProjectOnly, setCrossProjectOnly] = useState(true);
  const [treeView, setTreeView] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState(null); // null, [projA, projB] (pair), or [projA] (single)
  const [hideDone, setHideDone] = useState(true);

  const { nodes, edges, crossProjectEdges, projectMatrix, stats, criticalBlockers, blockingTree } = data || {};

  const isSingleProject = selectedFilter?.length === 1;
  const filterSet = selectedFilter ? new Set(selectedFilter) : null;

  // Click a project badge to filter by single project
  const handleProjectClick = (project) => {
    if (selectedFilter?.length === 1 && selectedFilter[0] === project) {
      setSelectedFilter(null); // toggle off
    } else {
      setSelectedFilter([project]);
    }
  };

  // Collect ticket keys involved in filtered edges
  const pairTicketKeys = useMemo(() => {
    if (!filterSet) return null;
    const keys = new Set();
    for (const e of (edges || [])) {
      // For single project: show edges where at least one side is in the project
      // For pair: show edges where both sides are in the pair
      const match = isSingleProject
        ? (filterSet.has(e.fromProject) || filterSet.has(e.toProject))
        : (filterSet.has(e.fromProject) && filterSet.has(e.toProject));
      if (match) {
        keys.add(e.from);
        keys.add(e.to);
      }
    }
    return keys;
  }, [selectedFilter, edges]);

  // Node lookup (needed for done status check and tree building)
  const nodeMap = useMemo(() => {
    const map = {};
    for (const n of (nodes || [])) map[n.key] = n;
    return map;
  }, [nodes]);

  // Filter edges — for single project, ignore cross-project-only toggle and show all
  const displayedEdges = useMemo(() => {
    let base;
    if (!filterSet) {
      base = crossProjectOnly ? (crossProjectEdges || []) : (edges || []);
    } else {
      base = (edges || []).filter((e) =>
        isSingleProject
          ? (filterSet.has(e.fromProject) || filterSet.has(e.toProject))
          : (filterSet.has(e.fromProject) && filterSet.has(e.toProject))
      );
    }
    if (hideDone) {
      base = base.filter((e) => {
        const fromDone = nodeMap[e.from]?.statusCategory === "done";
        const toDone = nodeMap[e.to]?.statusCategory === "done" || e.toStatusCategory === "done";
        return !fromDone && !toDone;
      });
    }
    return base;
  }, [crossProjectOnly, crossProjectEdges, edges, selectedFilter, hideDone, nodeMap]);


  // Build blocking tree + flat list from filtered edges (or global when no filter)
  const { filteredBlockingTree, filteredBlockers } = useMemo(() => {
    // Helper: is a ticket done?
    const isDone = (key) => nodeMap[key]?.statusCategory === "done";

    if (!selectedFilter) {
      if (!hideDone) return { filteredBlockingTree: blockingTree || [], filteredBlockers: criticalBlockers || [] };
      // Filter done from global tree
      function pruneDone(treeNodes) {
        return treeNodes
          .filter((n) => !isDone(n.key))
          .map((n) => ({ ...n, children: pruneDone(n.children || []) }));
      }
      return {
        filteredBlockingTree: pruneDone(blockingTree || []),
        filteredBlockers: (criticalBlockers || []).filter((b) => !isDone(b.key)),
      };
    }

    // Get blocking edges matching the filter
    const pairBlockingEdges = (edges || []).filter((e) => {
      const isBlocking = e.direction?.toLowerCase().includes("block") || e.type?.toLowerCase().includes("block");
      if (!isBlocking) return false;
      if (hideDone && (isDone(e.from) || isDone(e.to))) return false;
      return isSingleProject
        ? (filterSet.has(e.fromProject) || filterSet.has(e.toProject))
        : (filterSet.has(e.fromProject) && filterSet.has(e.toProject));
    });

    if (pairBlockingEdges.length === 0) {
      return { filteredBlockingTree: [], filteredBlockers: [] };
    }

    // Deduplicate: from is always the blocker, to is always the blocked
    // (backend builds edges so from=blocker in both "blocks" and "is blocked by" directions)
    const blockSets = {}; // blocker -> Set of blocked keys
    const seenPairs = new Set();
    for (const e of pairBlockingEdges) {
      const blocker = e.from;
      const blocked = e.to;
      const dedupKey = blocker + ":" + blocked;
      if (seenPairs.has(dedupKey)) continue;
      seenPairs.add(dedupKey);
      if (!blockSets[blocker]) blockSets[blocker] = new Set();
      blockSets[blocker].add(blocked);
    }

    // Find local roots:
    // 1. Pure roots: blockers not blocked by anyone
    // 2. Mutual cycle roots: A blocks B AND B blocks A — pick one per cycle
    const allBlocked = new Set();
    for (const s of Object.values(blockSets)) for (const k of s) allBlocked.add(k);
    const pureRoots = Object.keys(blockSets).filter((k) => !allBlocked.has(k));

    // Find mutual blockers not reachable from pure roots
    const reachable = new Set();
    function walk(key) {
      if (reachable.has(key)) return;
      reachable.add(key);
      for (const child of (blockSets[key] || [])) walk(child);
    }
    for (const r of pureRoots) walk(r);

    // Any blocker not reachable from pure roots is an orphan — add as root
    const orphanRoots = Object.keys(blockSets).filter((k) => !reachable.has(k));
    const finalRoots = [...pureRoots, ...orphanRoots];
    // If still empty, use all blockers
    const roots = finalRoots.length > 0 ? finalRoots : Object.keys(blockSets);

    // Build tree — include blocked tickets as leaf nodes even if they don't block anything
    function buildTree(key, visited = new Set()) {
      if (visited.has(key)) return null;
      visited.add(key);
      const node = nodeMap[key];
      if (!node) return null;
      const childKeys = blockSets[key] || new Set();
      return {
        ...node,
        blocksCount: childKeys.size,
        children: [...childKeys]
          .map((ck) => buildTree(ck, new Set(visited)))
          .filter(Boolean),
      };
    }

    const tree = roots
      .map((k) => buildTree(k))
      .filter(Boolean)
      .sort((a, b) => b.blocksCount - a.blocksCount);

    // Flat blocker list: every unique blocker from this pair's edges
    const flatBlockers = Object.entries(blockSets)
      .map(([key, blockedSet]) => ({
        ...(nodeMap[key] || { key, project: "?", summary: key }),
        blocksCount: blockedSet.size,
        blockedKeys: [...blockedSet],
      }))
      .sort((a, b) => b.blocksCount - a.blocksCount);

    return { filteredBlockingTree: tree, filteredBlockers: flatBlockers };
  }, [selectedFilter, blockingTree, criticalBlockers, edges, nodeMap, hideDone]);

  // Deduplicated edges for links view: normalize "is blocked by" → "blocks", skip duplicates
  // Deduplicate edges: normalize all to "blocker → blocked" direction
  // "A is blocked by B" and "B blocks A" are the SAME relationship → keep one (B blocks A)
  // "A blocks B" and "B blocks A" are DIFFERENT (mutual block) → keep both
  // Deduplicate edges: from=blocker (left), to=blocked (right) in all cases
  // "blocks" and "is blocked by" edges with same from→to are the same relationship
  const deduplicatedEdges = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const e of displayedEdges) {
      const dir = (e.direction || "").toLowerCase();
      // from is always the blocker, to is always the blocked (backend guarantees this)
      const direction = dir.includes("block") ? "blocks" : (e.direction || e.type);
      // Dedup: from→to directional key (mutual blocks A→B and B→A are kept as separate)
      const dedupKey = e.from + "→" + e.to + ":" + (e.type || "");
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      result.push({ ...e, direction });
    }
    return result;
  }, [displayedEdges]);

  // Early returns AFTER all hooks
  if (loading) return <Spinner text="Loading dependency data..." />;
  if (!data) return <div className="text-center py-12 text-gray-400 text-sm">No data loaded</div>;

  return (
    <div className="space-y-4">
      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          <StatCard label={selectedFilter ? "Filtered Issues" : "Total Issues"} value={selectedFilter ? (pairTicketKeys?.size || 0) : stats.totalNodes} />
          <StatCard label={selectedFilter ? "Filtered Links" : "Total Links"} value={selectedFilter ? deduplicatedEdges.length : stats.totalEdges} />
          <StatCard label="Cross-Project" value={selectedFilter ? deduplicatedEdges.filter((e) => e.isCrossProject).length : stats.crossProjectCount} color="text-blue-700" />
          <StatCard label="Blocking" value={selectedFilter ? deduplicatedEdges.filter((e) => e.direction?.toLowerCase().includes("block")).length : stats.blockingCount} color="text-red-700" />
          <StatCard label="Tree Roots" value={selectedFilter ? filteredBlockingTree.length : (blockingTree?.length || 0)} color="text-red-700" />
        </div>
      )}

      {/* Compact Project Matrix — horizontal pill bar */}
      {projectMatrix && projectMatrix.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider shrink-0 mr-1">Projects:</span>
            {projectMatrix.map((pm, i) => {
              const isSelected = selectedFilter?.length === 2 && pm.projects[0] === selectedFilter[0] && pm.projects[1] === selectedFilter[1];
              return (
                <button
                  key={i}
                  onClick={() => setSelectedFilter(isSelected ? null : [...pm.projects])}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border transition-all cursor-pointer ${
                    isSelected
                      ? "bg-blue-50 border-blue-400 text-blue-700 ring-1 ring-blue-300 font-semibold"
                      : pm.blocking > 0
                        ? "bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                        : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <ClickableProjectBadge project={pm.projects[0]} onClick={handleProjectClick} selectedFilter={selectedFilter} />
                  <span className="text-gray-300">↔</span>
                  <ClickableProjectBadge project={pm.projects[1]} onClick={handleProjectClick} selectedFilter={selectedFilter} />
                  <span className="font-mono text-[10px]">{pm.count}</span>
                  {pm.blocking > 0 && <span className="text-[9px] bg-red-100 text-red-600 px-1 rounded">🔒{pm.blocking}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Active filter banner */}
      {selectedFilter && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-blue-800">
            <svg className="w-3.5 h-3.5 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            {isSingleProject ? (
              <><ProjectBadge project={selectedFilter[0]} /> <span className="text-blue-400">(all dependencies)</span></>
            ) : (
              <><ProjectBadge project={selectedFilter[0]} /> <span className="text-blue-400 mx-1">↔</span> <ProjectBadge project={selectedFilter[1]} /></>
            )}
          </div>
          <button onClick={() => setSelectedFilter(null)} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium px-2 py-0.5 rounded hover:bg-blue-100">
            Clear
          </button>
        </div>
      )}

      {/* Dependencies — Tree / Links toggle */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Dependencies</h2>
            <p className="text-[10px] text-gray-500 mt-0.5">
              {treeView ? "Resolve top-level blockers first — they unblock the most downstream" : `${deduplicatedEdges.length} links (deduplicated, blocker on left)`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer mr-1">
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="rounded border-gray-300 text-green-600 w-3 h-3" />
              Hide done
            </label>
            {!selectedFilter && !treeView && (
              <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer mr-1">
                <input type="checkbox" checked={crossProjectOnly} onChange={(e) => setCrossProjectOnly(e.target.checked)} className="rounded border-gray-300 text-blue-600 w-3 h-3" />
                Cross-project only
              </label>
            )}
            <button
              onClick={() => setTreeView(true)}
              className={`text-[10px] px-2.5 py-1 rounded-md border transition-colors ${
                treeView ? "bg-red-50 text-red-700 border-red-200 font-medium" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
              }`}
            >
              Tree
            </button>
            <button
              onClick={() => setTreeView(false)}
              className={`text-[10px] px-2.5 py-1 rounded-md border transition-colors ${
                !treeView ? "bg-blue-50 text-blue-700 border-blue-200 font-medium" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
              }`}
            >
              Links
            </button>
          </div>
        </div>

        <div className="p-4">
          {/* Tree View */}
          {treeView && filteredBlockingTree.length > 0 && (
            <div className="space-y-3">
              {filteredBlockingTree.map((root) => (
                <BlockingTreeNode key={root.key} node={root} depth={0} jiraBaseUrl={jiraBaseUrl} />
              ))}
            </div>
          )}
          {treeView && filteredBlockingTree.length === 0 && (
            <div className="text-center py-6 text-gray-400 text-sm">
              No blocking chains found.
            </div>
          )}

          {/* Links View (deduplicated, blocker on left) */}
          {!treeView && deduplicatedEdges.length > 0 && (
            <div className="space-y-1.5">
              {deduplicatedEdges.map((edge, i) => (
                <div key={i} className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-gray-50 text-xs">
                  {/* From */}
                  <ProjectBadge project={edge.fromProject} />
                  <JiraLink issueKey={edge.from} jiraBaseUrl={jiraBaseUrl} />
                  {edge.fromStatus && <StatusBadge status={edge.fromStatus} />}
                  <span className="text-gray-500 truncate max-w-[200px] hidden lg:inline">{edge.fromSummary}</span>

                  {/* Direction */}
                  <span className={`shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded ${
                    edge.direction?.toLowerCase().includes("block") ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"
                  }`}>
                    {edge.direction || edge.type} →
                  </span>

                  {/* To */}
                  <ProjectBadge project={edge.toProject} />
                  <JiraLink issueKey={edge.to} jiraBaseUrl={jiraBaseUrl} />
                  {edge.toStatus && <StatusBadge status={edge.toStatus} />}
                  <span className="text-gray-500 truncate flex-1 min-w-0 hidden lg:inline">{edge.toSummary}</span>
                </div>
              ))}
            </div>
          )}
          {!treeView && deduplicatedEdges.length === 0 && (
            <div className="text-center py-6 text-gray-400 text-sm">
              No dependency links found.
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

// ─── AI Discovery Tab ─────────────────────────────────────────────────────────

function AiDiscoveryTab({ projects, jiraBaseUrl }) {
  const [promptData, setPromptData] = useState(null); // { prompt, issueMap, projectIssueCounts, totalAnalyzed }
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pastedResponse, setPastedResponse] = useState("");
  const [parseError, setParseError] = useState(null);
  const [result, setResult] = useState(null); // parsed AI response
  const promptRef = useRef(null);

  async function handleGeneratePrompt() {
    setLoading(true);
    setParseError(null);
    try {
      const data = await discoverDependencies(projects);
      setPromptData(data);
    } catch (err) {
      toast.error("Failed to fetch ticket data: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(promptData.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      if (promptRef.current) {
        promptRef.current.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  }

  function handleParseResponse() {
    setParseError(null);
    try {
      let cleaned = pastedResponse.trim();
      // Strip markdown code fences if present
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      const parsed = JSON.parse(cleaned);

      // Enrich dependencies with ticket details from issueMap
      const issueMap = promptData?.issueMap || {};
      const enrichedDeps = (parsed.dependencies || []).map(dep => ({
        ...dep,
        fromDetail: issueMap[dep.from] || { key: dep.from },
        toDetail: issueMap[dep.to] || { key: dep.to },
      }));

      setResult({
        dependencies: enrichedDeps,
        risks: parsed.risks || [],
        recommendations: parsed.recommendations || [],
        sharedResources: parsed.sharedResources || [],
        totalAnalyzed: promptData?.totalAnalyzed || 0,
        projectIssueCounts: promptData?.projectIssueCounts || {},
      });
    } catch (err) {
      setParseError("Failed to parse AI response as JSON. Make sure you copied the full response. Error: " + err.message);
    }
  }

  function handleReset() {
    setPromptData(null);
    setPastedResponse("");
    setParseError(null);
    setResult(null);
    setCopied(false);
  }

  // Group dependencies by type
  const groupedDeps = {};
  if (result?.dependencies) {
    for (const dep of result.dependencies) {
      const t = dep.type || "other";
      if (!groupedDeps[t]) groupedDeps[t] = [];
      groupedDeps[t].push(dep);
    }
  }

  return (
    <div className="space-y-6">
      {/* Step 1: Generate prompt */}
      {!promptData && !result && !loading && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <div className="mb-4">
            <svg className="w-12 h-12 mx-auto text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">AI Dependency Discovery</h3>
          <p className="text-sm text-gray-500 mb-2 max-w-md mx-auto">
            Generate a prompt with all ticket data from {projects.length > 0 ? projects.join(", ") : "all projects"} to discover implicit dependencies, shared resources, and risks.
          </p>
          <p className="text-xs text-gray-400 mb-4 max-w-md mx-auto">
            The prompt will be generated for you to copy into your AI chatbot (ChatGPT, Claude, etc.), then paste the response back.
          </p>
          <button
            onClick={handleGeneratePrompt}
            className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm"
          >
            Generate Prompt
          </button>
        </div>
      )}

      {loading && <Spinner text="Fetching ticket data from Jira..." />}

      {/* Step 2: Show prompt + paste area */}
      {promptData && !result && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Tickets Fetched" value={promptData.totalAnalyzed || 0} />
            <StatCard label="Projects" value={Object.keys(promptData.projectIssueCounts || {}).length} color="text-blue-700" />
            <StatCard label="Prompt Size" value={`${Math.round((promptData.prompt?.length || 0) / 1000)}K chars`} color="text-purple-700" />
          </div>

          {promptData.projectIssueCounts && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(promptData.projectIssueCounts).map(([proj, count]) => (
                <div key={proj} className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-1.5">
                  <ProjectBadge project={proj} />
                  <span className="text-sm text-gray-600">{count} tickets</span>
                </div>
              ))}
            </div>
          )}

          {/* Copy prompt */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase font-semibold text-indigo-500 tracking-wider">
                Step 1: Copy this prompt to your AI chatbot
              </p>
              <button
                onClick={handleCopy}
                className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                  copied
                    ? "bg-green-100 text-green-700 border-green-300"
                    : "bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100"
                }`}
              >
                {copied ? "Copied!" : "Copy to Clipboard"}
              </button>
            </div>
            <textarea
              ref={promptRef}
              readOnly
              value={promptData.prompt}
              className="w-full h-40 text-[11px] font-mono p-3 rounded-lg border border-gray-200 bg-gray-50 text-gray-700 resize-y focus:outline-none"
            />
          </div>

          {/* Paste response */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs uppercase font-semibold text-indigo-500 tracking-wider mb-2">
              Step 2: Paste the AI JSON response here
            </p>
            <textarea
              value={pastedResponse}
              onChange={(e) => setPastedResponse(e.target.value)}
              placeholder='Paste the AI response here (must be valid JSON matching the requested format)...'
              className="w-full h-40 text-xs p-3 rounded-lg border border-gray-200 bg-white text-gray-700 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            {parseError && (
              <p className="text-xs text-red-600 mt-2">{parseError}</p>
            )}
            <div className="flex items-center justify-between mt-2">
              <button onClick={handleReset} className="text-xs text-gray-500 hover:text-gray-700">
                &larr; Start over
              </button>
              <button
                onClick={handleParseResponse}
                disabled={!pastedResponse.trim()}
                className="text-xs px-4 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                Parse & Display
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Display parsed results */}
      {result && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Tickets Analyzed" value={result.totalAnalyzed || 0} />
            <StatCard label="Dependencies Found" value={result.dependencies?.length || 0} color="text-blue-700" />
            <StatCard label="Risks Identified" value={result.risks?.length || 0} color="text-red-700" />
            <StatCard label="Shared Resources" value={result.sharedResources?.length || 0} color="text-purple-700" />
          </div>

          {/* Project issue counts */}
          {result.projectIssueCounts && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(result.projectIssueCounts).map(([proj, count]) => (
                <div key={proj} className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-1.5">
                  <ProjectBadge project={proj} />
                  <span className="text-sm text-gray-600">{count} tickets</span>
                </div>
              ))}
            </div>
          )}

          {/* Dependencies grouped by type */}
          {Object.keys(groupedDeps).length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Discovered Dependencies</h2>
              <div className="space-y-4">
                {Object.entries(groupedDeps).map(([type, deps]) => (
                  <div key={type}>
                    <div className="flex items-center gap-2 mb-2">
                      <LinkTypeBadge type={type} />
                      <span className="text-sm text-gray-500">({deps.length})</span>
                    </div>
                    <div className="space-y-2">
                      {deps.map((dep, i) => (
                        <div
                          key={i}
                          className={`bg-white rounded-lg border p-4 ${
                            DEP_TYPE_COLORS[dep.type]
                              ? `border-l-4 ${DEP_TYPE_COLORS[dep.type].split(" ").find((c) => c.startsWith("border-")) || "border-gray-200"}`
                              : "border-gray-200"
                          }`}
                        >
                          {/* From -> To */}
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <div className="flex items-center gap-1.5">
                              {dep.fromDetail && <ProjectBadge project={dep.fromDetail.key?.split("-")[0] || ""} />}
                              <JiraLink issueKey={dep.from} jiraBaseUrl={jiraBaseUrl} />
                              {dep.fromDetail && (
                                <span className="text-xs text-gray-500 truncate max-w-[200px]">{dep.fromDetail.summary}</span>
                              )}
                            </div>
                            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                            </svg>
                            <div className="flex items-center gap-1.5">
                              {dep.toDetail && <ProjectBadge project={dep.toDetail.key?.split("-")[0] || ""} />}
                              <JiraLink issueKey={dep.to} jiraBaseUrl={jiraBaseUrl} />
                              {dep.toDetail && (
                                <span className="text-xs text-gray-500 truncate max-w-[200px]">{dep.toDetail.summary}</span>
                              )}
                            </div>
                          </div>

                          {/* Badges */}
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <ConfidenceBadge confidence={dep.confidence} />
                            {dep.impact && <ImpactBadge impact={dep.impact} />}
                          </div>

                          {/* Reason */}
                          {dep.reason && (
                            <p className="text-xs text-gray-600 mb-1">
                              <span className="font-medium text-gray-700">Reason:</span> {dep.reason}
                            </p>
                          )}

                          {/* Recommendation */}
                          {dep.recommendation && (
                            <p className="text-xs text-gray-500">
                              <span className="font-medium text-gray-600">Recommendation:</span> {dep.recommendation}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Risks */}
          {result.risks && result.risks.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Risks</h2>
              <div className="space-y-2">
                {result.risks.map((risk, i) => (
                  <div
                    key={i}
                    className={`bg-white rounded-lg p-4 border-2 ${
                      SEVERITY_COLORS[risk.severity] || "border-gray-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <p className="text-sm font-medium text-gray-900">{risk.description}</p>
                      {risk.severity && (
                        <span className={`shrink-0 inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          IMPACT_COLORS[risk.severity] || "bg-gray-100 text-gray-600"
                        }`}>
                          {risk.severity}
                        </span>
                      )}
                    </div>
                    {risk.affectedProjects && risk.affectedProjects.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {risk.affectedProjects.map((p) => (
                          <ProjectBadge key={p} project={p} />
                        ))}
                      </div>
                    )}
                    {risk.mitigation && (
                      <p className="text-xs text-gray-500">
                        <span className="font-medium text-gray-600">Mitigation:</span> {risk.mitigation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Shared Resources */}
          {result.sharedResources && result.sharedResources.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Shared Resources</h2>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Person</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Projects</th>
                      <th className="text-center px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Tickets</th>
                      <th className="text-center px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.sharedResources.map((sr, i) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-2 font-medium text-gray-900">{sr.person}</td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {sr.projects.map((p) => (
                              <ProjectBadge key={p} project={p} />
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center text-gray-600">{sr.ticketCount}</td>
                        <td className="px-4 py-2 text-center">
                          {sr.risk && (
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                              IMPACT_COLORS[sr.risk] || "bg-gray-100 text-gray-600"
                            }`}>
                              {sr.risk}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recommendations */}
          {result.recommendations && result.recommendations.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Recommendations</h2>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <ol className="space-y-2">
                  {result.recommendations.map((rec, i) => (
                    <li key={i} className="flex gap-3 text-sm text-gray-700">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">
                        {i + 1}
                      </span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {/* Re-run button */}
          <div className="text-center">
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
            >
              Start New Analysis
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DependenciesPage() {
  const { defaultJql, jiraBaseUrl } = useAppConfig();
  const [activeTab, setActiveTab] = useState("jira");
  const [jiraData, setJiraData] = useState(null);
  const [jiraLoading, setJiraLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");

  useEffect(() => {
    loadJiraLinks();
  }, [jql]);

  async function loadJiraLinks() {
    setJiraLoading(true);
    try {
      const data = await fetchDependencies(jql || undefined);
      setJiraData(data);
      setProjects(data?.projects || []);
    } catch (err) {
      toast.error("Failed to load dependencies: " + err.message);
    } finally {
      setJiraLoading(false);
    }
  }

  const tabs = [
    { key: "jira", label: "Jira Links" },
    { key: "ai", label: "AI Discovery" },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Cross-Project Dependencies</h1>
        <p className="text-sm text-gray-500 mt-1">
          Discover explicit and AI-detected dependencies between projects
        </p>
      </div>

      <JqlBar value={inputJql} onChange={setInputJql} onSubmit={(q) => setJql(q)} />

      {/* AI Coach */}
      <div className="mb-4">
        <AiCoachPanel
          context="Cross-Project Dependencies"
          data={activeTab === "jira" ? jiraData : null}
          prompts={AI_PROMPTS}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white rounded-lg border border-gray-200 p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-blue-600 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "jira" && (
        <JiraLinksTab data={jiraData} loading={jiraLoading} jiraBaseUrl={jiraBaseUrl} />
      )}

      {activeTab === "ai" && (
        <AiDiscoveryTab projects={projects} jiraBaseUrl={jiraBaseUrl} />
      )}

    </div>
  );
}
