"use client";

const SEVERITY_STYLES = {
  critical: "bg-red-100 text-red-800 border-red-200",
  warning: "bg-amber-100 text-amber-800 border-amber-200",
  info: "bg-blue-100 text-blue-700 border-blue-200",
};

const TYPE_ICONS = {
  overdue: "!!",
  due_soon: "~",
  stale: "zzz",
  priority: "^",
  blocked: "x",
  unassigned: "?",
};

export default function UrgencyBadge({ flag }) {
  const style = SEVERITY_STYLES[flag.severity] || SEVERITY_STYLES.info;

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${style}`}
    >
      <span className="opacity-60">{TYPE_ICONS[flag.type]}</span>
      {flag.label}
    </span>
  );
}
