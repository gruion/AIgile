"use client";

import { useState, useEffect, useRef } from "react";
import { fetchQuickQueries, createBookmark, deleteBookmark } from "../lib/api";
import { toast } from "./Toaster";

export default function JqlBar({ value, onChange, onSubmit, placeholder = "Enter JQL query..." }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [bookmarkName, setBookmarkName] = useState("");
  const [showBookmarkInput, setShowBookmarkInput] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    fetchQuickQueries().then(setData).catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setShowBookmarkInput(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectJql = (jql) => {
    onChange(jql);
    onSubmit(jql);
    setOpen(false);
  };

  const handleAddBookmark = async () => {
    if (!bookmarkName.trim() || !value.trim()) return;
    try {
      const result = await createBookmark(bookmarkName.trim(), value.trim());
      setData((prev) => prev ? { ...prev, bookmarks: result.bookmarks } : prev);
      setBookmarkName("");
      setShowBookmarkInput(false);
      toast.success("Bookmark saved");
    } catch { toast.error("Failed to save bookmark"); }
  };

  const handleDeleteBookmark = async (id) => {
    try {
      const result = await deleteBookmark(id);
      setData((prev) => prev ? { ...prev, bookmarks: result.bookmarks } : prev);
      toast.success("Bookmark removed");
    } catch { toast.error("Failed to remove bookmark"); }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    onSubmit(value);
  };

  const projects = data?.projects || [];
  const teams = data?.teams || [];
  const bookmarks = data?.bookmarks || [];

  return (
    <div className="relative" ref={ref}>
      <form onSubmit={handleFormSubmit} className="flex gap-2">
        {/* Dropdown trigger */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`text-sm px-3 py-2 rounded-lg border transition-colors shrink-0 ${
            open ? "bg-blue-50 border-blue-300 text-blue-600" : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
          }`}
          title="Quick queries"
        >
          &#9660;
        </button>

        {/* JQL input */}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 font-mono"
        />

        {/* Bookmark current query */}
        <button
          type="button"
          onClick={() => setShowBookmarkInput(!showBookmarkInput)}
          className={`text-sm px-3 py-2 rounded-lg border transition-colors shrink-0 ${
            bookmarks.some((b) => b.jql === value)
              ? "bg-yellow-50 border-yellow-300 text-yellow-600"
              : "bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100 hover:text-yellow-500"
          }`}
          title="Bookmark this query"
        >
          &#9733;
        </button>

        <button
          type="submit"
          className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shrink-0"
        >
          Search
        </button>
      </form>

      {/* Bookmark name input */}
      {showBookmarkInput && (
        <div className="mt-2 flex gap-2 items-center">
          <input
            type="text"
            value={bookmarkName}
            onChange={(e) => setBookmarkName(e.target.value)}
            placeholder="Bookmark name..."
            className="flex-1 text-xs bg-yellow-50 border border-yellow-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-yellow-400/30"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddBookmark())}
            autoFocus
          />
          <button
            type="button"
            onClick={handleAddBookmark}
            className="text-xs bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1.5 rounded-md"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => { setShowBookmarkInput(false); setBookmarkName(""); }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 max-h-[70vh] overflow-y-auto">

          {/* Bookmarks */}
          {bookmarks.length > 0 && (
            <div>
              <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-yellow-600 font-medium bg-yellow-50 border-b border-yellow-100 sticky top-0 z-10">
                &#9733; Bookmarks
              </div>
              <div className="p-2 space-y-0.5">
                {bookmarks.map((bm) => (
                  <div key={bm.id} className="group flex items-center">
                    <button
                      onClick={() => selectJql(bm.jql)}
                      className={`flex-1 text-left px-3 py-2 text-xs rounded-lg transition-colors ${
                        value === bm.jql ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50 text-gray-700"
                      }`}
                    >
                      <span className="font-medium">{bm.name}</span>
                      <span className="block text-[10px] text-gray-400 font-mono truncate mt-0.5">{bm.jql}</span>
                    </button>
                    <button
                      onClick={() => handleDeleteBookmark(bm.id)}
                      className="text-[10px] text-gray-300 hover:text-red-500 px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove bookmark"
                    >
                      &#10005;
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Projects */}
          {projects.length > 0 && (
            <div>
              <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-medium bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                Projects
              </div>
              <div className="p-2 grid grid-cols-2 gap-1">
                {projects.map((p) => (
                  <button
                    key={`${p.serverId}-${p.key}`}
                    onClick={() => selectJql(p.jql)}
                    className={`text-left px-3 py-2 text-xs rounded-lg transition-colors ${
                      value === p.jql ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50 text-gray-700"
                    }`}
                  >
                    <span className="font-mono font-bold">{p.key}</span>
                    <span className="text-gray-400 ml-1.5 text-[10px]">{p.serverName}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Team Queries */}
          {teams.length > 0 && (
            <div>
              <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-medium bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                Team Queries
              </div>
              <div className="p-2 space-y-0.5">
                {teams.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => selectJql(t.jql)}
                    className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-colors flex items-center gap-2 ${
                      value === t.jql ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50 text-gray-700"
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                    <span className="font-medium">{t.name}</span>
                    <span className="text-[10px] text-gray-400 font-mono">{t.projectKey}</span>
                    {t.isCustom && <span className="text-[9px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded ml-auto">custom</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quick JQL templates */}
          <div>
            <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-medium bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
              Quick Filters
            </div>
            <div className="p-2 grid grid-cols-2 gap-1">
              {[
                { label: "My Open Issues", jql: "assignee = currentUser() AND resolution = Unresolved ORDER BY priority DESC" },
                { label: "Updated Today", jql: "updated >= startOfDay() ORDER BY updated DESC" },
                { label: "Created This Week", jql: "created >= startOfWeek() ORDER BY created DESC" },
                { label: "High Priority Open", jql: "priority in (Highest, High) AND resolution = Unresolved ORDER BY priority DESC" },
                { label: "Bugs Only", jql: "issuetype = Bug AND resolution = Unresolved ORDER BY priority DESC" },
                { label: "Stale (30+ days)", jql: "updated <= \"-30d\" AND resolution = Unresolved ORDER BY updated ASC" },
                { label: "No Assignee", jql: "assignee is EMPTY AND resolution = Unresolved ORDER BY priority DESC" },
                { label: "Due This Week", jql: "due >= startOfWeek() AND due <= endOfWeek() ORDER BY due ASC" },
              ].map((q) => (
                <button
                  key={q.label}
                  onClick={() => selectJql(q.jql)}
                  className="text-left px-3 py-2 text-xs rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400">
            Select a query to load it, or type your own JQL above. Click &#9733; to bookmark the current query.
          </div>
        </div>
      )}
    </div>
  );
}
