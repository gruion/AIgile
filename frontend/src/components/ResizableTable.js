"use client";

import { useState, useRef, useCallback, useMemo } from "react";

/**
 * ResizableTable — a reusable table with sortable + resizable columns.
 *
 * Props:
 *   columns: [{ key, label, sortable?, defaultWidth?, minWidth?, className?, headerClassName?, render(row,i) }]
 *   data: array of row objects
 *   getRowKey: (row, index) => unique key
 *   rowClassName?: (row, index) => className string
 *   defaultSort?: { key, dir: "asc"|"desc" }
 *   sortFn?: (a, b, key, dir) => number  — custom sort comparator; if omitted, uses generic compare
 *   onSort?: (sortedData, { key, dir }) => void
 *   emptyMessage?: string
 */

function genericCompare(a, b, key) {
  const va = a[key];
  const vb = b[key];
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  if (va instanceof Date && vb instanceof Date) return va.getTime() - vb.getTime();
  if (typeof va === "number" && typeof vb === "number") return va - vb;
  return String(va).localeCompare(String(vb));
}

export default function ResizableTable({
  columns,
  data,
  getRowKey,
  rowClassName,
  defaultSort,
  sortFn,
  emptyMessage = "No data",
}) {
  const [sortKey, setSortKey] = useState(defaultSort?.key || null);
  const [sortDir, setSortDir] = useState(defaultSort?.dir || "asc");
  const [colWidths, setColWidths] = useState(() => {
    const w = {};
    for (const col of columns) {
      if (col.defaultWidth) w[col.key] = col.defaultWidth;
    }
    return w;
  });

  const dragRef = useRef(null);

  // Sort
  const sorted = useMemo(() => {
    if (!sortKey) return data;
    const list = [...data];
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortable) return data;
    list.sort((a, b) => {
      const cmp = sortFn ? sortFn(a, b, sortKey, sortDir) : genericCompare(a, b, sortKey);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [data, sortKey, sortDir, columns, sortFn]);

  const toggleSort = (key) => {
    const col = columns.find((c) => c.key === key);
    if (!col?.sortable) return;
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Resize handler
  const startResize = useCallback((e, colKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const th = e.target.closest("th");
    const startWidth = th?.getBoundingClientRect().width || 100;
    const minW = columns.find((c) => c.key === colKey)?.minWidth || 50;

    const onMove = (ev) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(minW, startWidth + delta);
      setColWidths((prev) => ({ ...prev, [colKey]: newWidth }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [columns]);

  const SortArrow = ({ colKey }) => {
    if (sortKey !== colKey) return <span className="text-gray-300 ml-0.5 text-[10px]">{"\u2195"}</span>;
    return <span className="text-blue-500 ml-0.5 text-[10px]">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>;
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ tableLayout: Object.keys(colWidths).length > 0 ? "fixed" : "auto" }}>
          <colgroup>
            {columns.map((col) => (
              <col
                key={col.key}
                style={colWidths[col.key] ? { width: `${colWidths[col.key]}px` } : undefined}
              />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`text-left px-3 py-2.5 font-semibold text-gray-500 select-none relative group ${
                    col.sortable ? "cursor-pointer hover:text-gray-700" : ""
                  } ${col.headerClassName || ""}`}
                  onClick={() => toggleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {col.label}
                    {col.sortable && <SortArrow colKey={col.key} />}
                  </span>
                  {/* Resize handle */}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-400/30 transition-colors"
                    onMouseDown={(e) => startResize(e, col.key)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-8 text-gray-400">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => (
                <tr
                  key={getRowKey ? getRowKey(row, i) : i}
                  className={`border-b border-gray-100 hover:bg-gray-50/50 ${
                    rowClassName ? rowClassName(row, i) : ""
                  }`}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={`px-3 py-2 ${col.className || ""}`}>
                      {col.render ? col.render(row, i) : row[col.key] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
