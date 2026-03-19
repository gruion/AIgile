"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import JqlBar from "../../components/JqlBar";
import IssueHoverCard from "../../components/IssueHoverCard";
import { fetchHierarchy } from "../../lib/api";
import { toast } from "../../components/Toaster";
import { useAppConfig } from "../../context/AppConfigContext";

const TYPE_COLORS = {
  Epic: { bg: "bg-purple-100", text: "text-purple-700", border: "border-purple-300" },
  Story: { bg: "bg-green-100", text: "text-green-700", border: "border-green-300" },
  Task: { bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-300" },
  "Sub-task": { bg: "bg-gray-100", text: "text-gray-600", border: "border-gray-300" },
  Bug: { bg: "bg-red-100", text: "text-red-700", border: "border-red-300" },
};

const STATUS_COLORS = {
  new: "bg-gray-200 text-gray-700",
  indeterminate: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
};

const SEVERITY_COLORS = {
  critical: "bg-red-50 border-red-200 text-red-700",
  warning: "bg-amber-50 border-amber-200 text-amber-700",
  info: "bg-blue-50 border-blue-200 text-blue-700",
};

// ─── Recursive Tree Node (Accordion) ───

function TreeNode({ node, depth = 0, search, expanded, toggleExpand, filters, jiraBaseUrl }) {
  const matchesSearch = search
    ? node.key.toLowerCase().includes(search) ||
      node.summary.toLowerCase().includes(search) ||
      (node.assigneeName || "").toLowerCase().includes(search) ||
      (node.labels || []).some((l) => l.toLowerCase().includes(search))
    : true;

  // Check if any descendant matches search
  const descendantMatches = useMemo(() => {
    if (!search) return true;
    function checkChildren(n) {
      for (const c of n.children || []) {
        if (
          c.key.toLowerCase().includes(search) ||
          c.summary.toLowerCase().includes(search) ||
          (c.assigneeName || "").toLowerCase().includes(search) ||
          (c.labels || []).some((l) => l.toLowerCase().includes(search))
        ) return true;
        if (checkChildren(c)) return true;
      }
      return false;
    }
    return checkChildren(node);
  }, [node, search]);

  // Check filters
  const matchesFilters = useMemo(() => {
    if (filters.status && node.status !== filters.status) return false;
    if (filters.assignee && node.assigneeName !== filters.assignee) return false;
    if (filters.issueType && node.issueType !== filters.issueType) return false;
    if (filters.priority && node.priority !== filters.priority) return false;
    if (filters.flagsOnly && (node.urgencyFlags?.length ?? 0) === 0) return false;
    return true;
  }, [node, filters]);

  // A descendant matches the filter
  const descendantMatchesFilter = useMemo(() => {
    function check(n) {
      for (const c of n.children || []) {
        let cMatch = true;
        if (filters.status && c.status !== filters.status) cMatch = false;
        if (filters.assignee && c.assigneeName !== filters.assignee) cMatch = false;
        if (filters.issueType && c.issueType !== filters.issueType) cMatch = false;
        if (filters.priority && c.priority !== filters.priority) cMatch = false;
        if (filters.flagsOnly && (c.urgencyFlags?.length ?? 0) === 0) cMatch = false;
        if (cMatch) return true;
        if (check(c)) return true;
      }
      return false;
    }
    return check(node);
  }, [node, filters]);

  const visible = (matchesSearch || descendantMatches) && (matchesFilters || descendantMatchesFilter);
  if (!visible) return null;

  const isExpanded = expanded.has(node.key);
  const hasChildren = node.children && node.children.length > 0;
  const typeColor = TYPE_COLORS[node.issueType] || TYPE_COLORS.Task;
  const statusColor = STATUS_COLORS[node.statusCategory] || STATUS_COLORS.new;
  const criticalFlags = node.urgencyFlags?.filter((f) => f.severity === "critical") || [];
  const warningFlags = node.urgencyFlags?.filter((f) => f.severity === "warning") || [];

  // Count descendants
  function countDesc(n) {
    let c = n.children?.length || 0;
    for (const ch of n.children || []) c += countDesc(ch);
    return c;
  }
  const descCount = countDesc(node);
  const doneCount = (function countDone(n) {
    let c = 0;
    for (const ch of n.children || []) {
      if (ch.statusCategory === "done") c++;
      c += countDone(ch);
    }
    return c;
  })(node);

  return (
    <div className={depth === 0 ? "mb-2" : ""}>
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors group ${
          depth === 0 ? "bg-white border border-gray-200 shadow-sm" : ""
        }`}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onClick={() => hasChildren && toggleExpand(node.key)}
      >
        {/* Expand/collapse arrow */}
        <span className={`w-4 text-center text-gray-400 text-xs shrink-0 transition-transform ${
          hasChildren ? (isExpanded ? "rotate-90" : "") : "opacity-0"
        }`}>
          {hasChildren ? "\u25B6" : ""}
        </span>

        {/* Issue type badge */}
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${typeColor.bg} ${typeColor.text} shrink-0`}>
          {node.issueType}
        </span>

        {/* Key as Jira link */}
        <IssueHoverCard issue={node} jiraBaseUrl={jiraBaseUrl}>
          <a
            href={`${jiraBaseUrl}/browse/${node.key}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-mono text-blue-600 hover:underline shrink-0"
          >
            {node.key}
          </a>
        </IssueHoverCard>

        {/* Summary */}
        <span className={`text-sm truncate flex-1 ${
          node.statusCategory === "done" ? "text-gray-400 line-through" : "text-gray-800"
        }`}>
          {node.summary}
        </span>

        {/* Urgency flags */}
        {criticalFlags.map((f, i) => (
          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 shrink-0">
            {f.label}
          </span>
        ))}
        {warningFlags.map((f, i) => (
          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 shrink-0">
            {f.label}
          </span>
        ))}

        {/* Status */}
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusColor} shrink-0`}>
          {node.status}
        </span>

        {/* Priority */}
        <span className="text-[10px] text-gray-400 w-16 text-right shrink-0">{node.priority}</span>

        {/* Assignee */}
        <span className="text-[10px] text-gray-500 w-24 truncate shrink-0">{node.assigneeName || "\u2014"}</span>

        {/* Child count + progress */}
        {hasChildren && (
          <span className="text-[10px] text-gray-400 shrink-0 w-16 text-right">
            {descCount} child{descCount !== 1 ? "ren" : ""}
          </span>
        )}
        {hasChildren && descCount > 0 && (
          <div className="w-12 bg-gray-100 rounded-full h-1.5 overflow-hidden shrink-0">
            <div
              className="bg-green-500 h-full rounded-full"
              style={{ width: `${Math.round((doneCount / descCount) * 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* Children (accordion) */}
      {isExpanded && hasChildren && (
        <div className={depth === 0 ? "ml-0" : ""}>
          {node.children.map((child) => (
            <TreeNode
              key={child.key}
              node={child}
              depth={depth + 1}
              search={search}
              expanded={expanded}
              toggleExpand={toggleExpand}
              filters={filters}
              jiraBaseUrl={jiraBaseUrl}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function HierarchyPage() {
  const { defaultJql, jiraBaseUrl } = useAppConfig();
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(new Set());
  const [filters, setFilters] = useState({
    status: "",
    assignee: "",
    issueType: "",
    priority: "",
    flagsOnly: false,
  });

  const loadData = async (query) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchHierarchy(query);
      setData(result);
      toast.success(`Loaded ${result.total} tickets`);
      // Auto-expand top-level items
      const topKeys = new Set(result.tree.map((n) => n.key));
      setExpanded(topKeys);
    } catch (err) {
      setError(err.message);
      toast.error(`Failed to load hierarchy: ${err.message}`);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (defaultJql) {
      setJql((prev) => prev || defaultJql);
      setInputJql((prev) => prev || defaultJql);
    }
  }, [defaultJql]);

  useEffect(() => { if (jql) loadData(jql); }, [jql]);

  const handleSearch = (e) => {
    e.preventDefault();
    setJql(inputJql);
  };

  const toggleExpand = useCallback((key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (!data) return;
    const allKeys = new Set();
    function collect(nodes) {
      for (const n of nodes) {
        if (n.children?.length > 0) {
          allKeys.add(n.key);
          collect(n.children);
        }
      }
    }
    collect(data.tree);
    setExpanded(allKeys);
  }, [data]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const searchLower = search.toLowerCase();

  // When searching, auto-expand matching branches
  useEffect(() => {
    if (!search || !data) return;
    const toExpand = new Set();
    function findMatches(nodes, ancestors) {
      for (const n of nodes) {
        const matches =
          n.key.toLowerCase().includes(searchLower) ||
          n.summary.toLowerCase().includes(searchLower) ||
          (n.assigneeName || "").toLowerCase().includes(searchLower);
        if (matches) {
          for (const a of ancestors) toExpand.add(a);
        }
        if (n.children?.length > 0) {
          findMatches(n.children, [...ancestors, n.key]);
        }
      }
    }
    findMatches(data.tree, []);
    if (toExpand.size > 0) setExpanded((prev) => new Set([...prev, ...toExpand]));
  }, [search, data, searchLower]);

  const activeFilterCount = Object.values(filters).filter((v) => v && v !== false).length;

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">Hierarchy Explorer</h1>
          </div>

          <div className="mb-3">
            <JqlBar
              value={inputJql}
              onChange={setInputJql}
              onSubmit={(q) => setJql(q)}
            />
          </div>

          {/* Search + filters bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search across all tickets (key, summary, assignee, labels)..."
                className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 pl-8 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{"\uD83D\uDD0D"}</span>
            </div>

            <select
              value={filters.issueType}
              onChange={(e) => setFilters((f) => ({ ...f, issueType: e.target.value }))}
              className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5"
            >
              <option value="">All types</option>
              {data?.filterOptions?.issueTypes?.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5"
            >
              <option value="">All statuses</option>
              {data?.filterOptions?.statuses?.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <select
              value={filters.assignee}
              onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))}
              className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5"
            >
              <option value="">All assignees</option>
              {data?.filterOptions?.assignees?.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>

            <select
              value={filters.priority}
              onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
              className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5"
            >
              <option value="">All priorities</option>
              {data?.filterOptions?.priorities?.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>

            <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.flagsOnly}
                onChange={(e) => setFilters((f) => ({ ...f, flagsOnly: e.target.checked }))}
                className="rounded"
              />
              Flagged only
            </label>

            {activeFilterCount > 0 && (
              <button
                onClick={() => setFilters({ status: "", assignee: "", issueType: "", priority: "", flagsOnly: false })}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Clear filters ({activeFilterCount})
              </button>
            )}

            <div className="flex gap-1 ml-auto">
              <button onClick={expandAll} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded">
                Expand all
              </button>
              <button onClick={collapseAll} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded">
                Collapse all
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-4">
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

        {!loading && data && (
          <>
            {/* Agile Coach Warnings */}
            {data.coachWarnings?.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Agile Coach</h3>
                {data.coachWarnings.map((w, i) => (
                  <div key={i} className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${SEVERITY_COLORS[w.severity]}`}>
                    <span className="text-xs font-bold uppercase shrink-0 mt-0.5">
                      {w.severity === "critical" ? "\u26D4" : w.severity === "warning" ? "\u26A0\uFE0F" : "\u2139\uFE0F"} {w.category}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{w.title}</p>
                      <p className="text-xs mt-1 opacity-80">{w.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Stats bar */}
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span><strong className="text-gray-800">{data.total}</strong> tickets</span>
              <span><strong className="text-green-600">{data.stats.done}</strong> done</span>
              <span><strong className="text-blue-600">{data.stats.inProgress}</strong> in progress</span>
              <span><strong className="text-red-600">{data.stats.criticals}</strong> critical flags</span>
              <span><strong className="text-gray-600">{data.tree.length}</strong> top-level items</span>
              {search && (
                <span className="text-blue-600">Filtering: &quot;{search}&quot;</span>
              )}
            </div>

            {/* Tree */}
            <div className="space-y-1">
              {data.tree.map((node) => (
                <TreeNode
                  key={node.key}
                  node={node}
                  depth={0}
                  search={searchLower}
                  expanded={expanded}
                  toggleExpand={toggleExpand}
                  filters={filters}
                  jiraBaseUrl={jiraBaseUrl}
                />
              ))}
            </div>

            {data.tree.length === 0 && (
              <div className="text-center py-12 text-gray-400 text-sm">No tickets found</div>
            )}
          </>
        )}

        {!loading && !data && !error && !jql && (
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
      </main>
    </div>
  );
}
