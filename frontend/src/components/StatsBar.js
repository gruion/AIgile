"use client";

export default function StatsBar({ stats }) {
  if (!stats) return null;

  const items = [
    { label: "Total", value: stats.total, color: "text-gray-800", bg: "bg-gray-100" },
    { label: "To Do", value: stats.todo, color: "text-gray-600", bg: "bg-gray-50" },
    { label: "In Progress", value: stats.inProgress, color: "text-blue-700", bg: "bg-blue-50" },
    { label: "Done", value: stats.done, color: "text-green-700", bg: "bg-green-50" },
    { label: "Overdue", value: stats.overdue, color: "text-red-700", bg: "bg-red-50" },
    { label: "Stale", value: stats.stale, color: "text-amber-700", bg: "bg-amber-50" },
    { label: "Unassigned", value: stats.unassigned, color: "text-purple-700", bg: "bg-purple-50" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className={`${item.bg} rounded-lg px-3 py-2 border border-gray-200/50`}
        >
          <span className={`text-lg font-bold ${item.color}`}>{item.value}</span>
          <span className="text-xs text-gray-500 ml-1.5">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
