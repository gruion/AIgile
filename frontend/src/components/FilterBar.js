"use client";

import { useState, useEffect, useRef } from "react";
import { fetchFilters } from "../lib/api";

const STORAGE_KEY = "jira-dashboard-pinned-filters";

function loadPinnedFilters() {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function savePinnedFilters(pins) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
}

const BOARD_TYPE_ICONS = {
  kanban: "\u25A6",   // grid
  scrum: "\u21BB",    // cycle
  simple: "\u25CB",   // circle
};

const BOARD_TYPE_COLORS = {
  kanban: "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100",
  scrum: "bg-green-50 text-green-700 border-green-200 hover:bg-green-100",
  simple: "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100",
};

export default function FilterBar({ onApplyFilter, currentJql }) {
  const [filters, setFilters] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pinnedIds, setPinnedIds] = useState(loadPinnedFilters);
  const [expandedBoard, setExpandedBoard] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    fetchFilters()
      .then(setFilters)
      .catch(() => setFilters(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    savePinnedFilters(pinnedIds);
  }, [pinnedIds]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowAll(false);
        setExpandedBoard(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Filters</span>
        <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  if (!filters) return null;

  const allFilterItems = [
    ...filters.favourite.map((f) => ({ ...f, source: "favourite" })),
    ...filters.boards.map((b) => ({ ...b, source: "board", jql: b.jql })),
    ...filters.recent.map((f) => ({ ...f, source: "recent" })),
  ];

  const togglePin = (id) => {
    setPinnedIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const pinned = allFilterItems.filter((f) => pinnedIds.includes(f.id));
  const unpinned = allFilterItems.filter((f) => !pinnedIds.includes(f.id));

  const isActive = (jql) => jql && currentJql === jql;

  function FilterButton({ item, showSource = false, compact = false }) {
    const hasQuickFilters = item.source === "board" && item.quickFilters?.length > 0;
    const isPinned = pinnedIds.includes(item.id);
    const active = isActive(item.jql);

    return (
      <div className="relative group flex items-center">
        <button
          onClick={() => {
            if (item.jql) {
              onApplyFilter(item.jql);
              setShowAll(false);
            }
          }}
          disabled={!item.jql}
          title={item.jql || "No JQL available"}
          className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border transition-all whitespace-nowrap ${
            active
              ? "bg-blue-600 text-white border-blue-600"
              : item.source === "board"
              ? BOARD_TYPE_COLORS[item.type] || BOARD_TYPE_COLORS.simple
              : item.source === "favourite"
              ? "bg-yellow-50 text-yellow-800 border-yellow-200 hover:bg-yellow-100"
              : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
          } ${!item.jql ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
        >
          {item.source === "board" && (
            <span className="text-[10px]">{BOARD_TYPE_ICONS[item.type] || ""}</span>
          )}
          {item.source === "favourite" && <span className="text-[10px]">&#9733;</span>}
          <span className={compact ? "max-w-[120px] truncate" : ""}>{item.name}</span>
          {showSource && (
            <span className="text-[9px] opacity-50 ml-0.5">
              {item.source === "board" ? item.type : item.source}
            </span>
          )}
        </button>

        {/* Quick filters dropdown for boards */}
        {hasQuickFilters && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpandedBoard(expandedBoard === item.id ? null : item.id);
            }}
            className="text-[10px] ml-0.5 px-1 py-1.5 rounded-r-md border border-l-0 border-gray-200 hover:bg-gray-100 text-gray-400"
            title="Quick filters / Swimlanes"
          >
            &#9662;
          </button>
        )}

        {/* Pin/unpin */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            togglePin(item.id);
          }}
          className={`ml-0.5 text-[10px] px-1 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${
            isPinned ? "text-yellow-500" : "text-gray-300 hover:text-yellow-400"
          }`}
          title={isPinned ? "Unpin" : "Pin to bar"}
        >
          {isPinned ? "\u2605" : "\u2606"}
        </button>

        {/* Quick filter dropdown */}
        {hasQuickFilters && expandedBoard === item.id && (
          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 min-w-[200px]">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-400 font-medium border-b border-gray-100">
              Quick Filters — {item.name}
            </div>
            {item.quickFilters.map((qf) => (
              <button
                key={qf.id}
                onClick={() => {
                  // Combine board JQL with quick filter JQL
                  const combined = item.jql
                    ? `(${item.jql}) AND (${qf.jql})`
                    : qf.jql;
                  onApplyFilter(combined);
                  setExpandedBoard(null);
                  setShowAll(false);
                }}
                className="block w-full text-left px-3 py-2 text-xs hover:bg-gray-50 text-gray-700"
              >
                {qf.name}
                <span className="block text-[10px] text-gray-400 font-mono truncate mt-0.5">
                  {qf.jql}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap" ref={dropdownRef}>
      <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium shrink-0">
        Filters
      </span>

      {/* Pinned filters — always visible */}
      {pinned.map((item) => (
        <FilterButton key={item.id} item={item} compact />
      ))}

      {/* Show favourite filters if none pinned yet */}
      {pinned.length === 0 &&
        filters.favourite.slice(0, 5).map((item) => (
          <FilterButton key={item.id} item={{ ...item, source: "favourite" }} compact />
        ))}

      {/* "More" button */}
      <div className="relative">
        <button
          onClick={() => setShowAll(!showAll)}
          className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
            showAll
              ? "bg-blue-50 text-blue-600 border-blue-200"
              : "text-gray-400 border-gray-200 hover:bg-gray-50"
          }`}
        >
          {showAll ? "Close" : "More..."}
        </button>

        {showAll && (
          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 w-[420px] max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto">
            {/* Boards section */}
            {filters.boards.length > 0 && (
              <div>
                <div className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-gray-400 font-medium bg-gray-50 border-b border-gray-100 sticky top-0">
                  Boards (Kanban / Scrum)
                </div>
                <div className="p-2 flex flex-wrap gap-1.5">
                  {filters.boards.map((board) => (
                    <FilterButton
                      key={board.id}
                      item={{ ...board, source: "board" }}
                      showSource
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Favourite filters */}
            {filters.favourite.length > 0 && (
              <div>
                <div className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-gray-400 font-medium bg-gray-50 border-b border-gray-100 sticky top-0">
                  Starred Filters
                </div>
                <div className="p-2 flex flex-wrap gap-1.5">
                  {filters.favourite.map((f) => (
                    <FilterButton
                      key={f.id}
                      item={{ ...f, source: "favourite" }}
                      showSource
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Recent / other filters */}
            {filters.recent.length > 0 && (
              <div>
                <div className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-gray-400 font-medium bg-gray-50 border-b border-gray-100 sticky top-0">
                  Other Filters
                </div>
                <div className="p-2 flex flex-wrap gap-1.5">
                  {filters.recent.map((f) => (
                    <FilterButton
                      key={f.id}
                      item={{ ...f, source: "recent" }}
                      showSource
                    />
                  ))}
                </div>
              </div>
            )}

            {allFilterItems.length === 0 && (
              <div className="p-6 text-center text-sm text-gray-400">
                No filters or boards found. Star filters in Jira to see them here.
              </div>
            )}

            {/* Tip */}
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400">
              Hover a filter and click the star to pin it to the quick bar
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
