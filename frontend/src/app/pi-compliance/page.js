"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { fetchPiCompliance } from "../../lib/api";
import JqlBar from "../../components/JqlBar";
import ComplianceStepper from "../../components/ComplianceStepper";
import { toast } from "../../components/Toaster";

function ScoreRing({ score, size = 80 }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#3b82f6" : score >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <span className="absolute text-lg font-bold" style={{ color }}>{score}%</span>
    </div>
  );
}

function PiCheckCard({ check }) {
  const [expanded, setExpanded] = useState(false);
  const statusStyles = {
    pass: "border-green-200 bg-green-50",
    warning: "border-amber-200 bg-amber-50",
    fail: "border-red-200 bg-red-50",
  };
  const statusBadge = {
    pass: "bg-green-100 text-green-700",
    warning: "bg-amber-100 text-amber-700",
    fail: "bg-red-100 text-red-700",
  };
  const iconMap = {
    "feature-traceability": "🔗",
    "dependency-tracking": "🔀",
    "bidirectional-deps": "🔄",
    "workload-balance": "⚖️",
    "pi-stale-tickets": "🕐",
    "pi-descriptions": "📝",
    "pi-on-track": "📊",
    "team-velocity": "🚀",
    "pi-config": "⚙️",
    "team-jql": "🔍",
    "pi-architecture": "🏗️",
    "pi-hierarchy": "🏛️",
    "pi-deadlines": "⏰",
    "dependency-risk": "🚨",
  };
  const scorePct = check.maxScore > 0 ? Math.round((check.score / check.maxScore) * 100) : 0;
  const barColor = scorePct >= 80 ? "bg-green-500" : scorePct >= 60 ? "bg-blue-500" : scorePct >= 40 ? "bg-amber-500" : "bg-red-500";

  // Route suggestions per check
  const routeMap = {
    "feature-traceability": { href: "/pi-planning", label: "Go to Program Board" },
    "dependency-tracking": { href: "/pi-planning", label: "Go to Dependencies" },
    "bidirectional-deps": { href: "/pi-planning", label: "Go to Dependencies" },
    "workload-balance": { href: "/pi-planning", label: "Go to PI Overview" },
    "pi-stale-tickets": { href: "/compliance", label: "Go to Project Compliance" },
    "pi-descriptions": { href: "/compliance", label: "Go to Project Compliance" },
    "pi-on-track": { href: "/pi-planning", label: "Go to PI Overview" },
    "team-velocity": { href: "/analytics", label: "Go to Analytics" },
    "pi-config": { href: "/pi-planning", label: "Open PI Config" },
    "team-jql": { href: "/pi-planning", label: "Open Team Config" },
    "pi-architecture": { href: "/compliance", label: "Go to Project Compliance" },
    "pi-deadlines": { href: "/compliance", label: "Go to Project Compliance" },
    "dependency-risk": { href: "/pi-planning", label: "Go to Dependencies" },
    "pi-hierarchy": { href: "/compliance", label: "Go to Project Compliance" },
  };
  const route = routeMap[check.id];

  return (
    <div className={`rounded-xl border-2 overflow-hidden transition-all ${statusStyles[check.status]}`}>
      <div className="px-5 py-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <span className="text-lg">{iconMap[check.id] || "📋"}</span>
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${statusBadge[check.status]}`}>
              {check.status}
            </span>
            <h4 className="text-sm font-semibold text-gray-800">{check.name}</h4>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-gray-700">{check.score}/{check.maxScore}</span>
            <span className="text-[10px] text-gray-400 w-10 text-right">{scorePct}%</span>
            <span className="text-gray-400 text-xs">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>
        <div className="w-full bg-white/60 rounded-full h-2.5 overflow-hidden">
          <div className={`${barColor} h-2.5 rounded-full transition-all duration-500`} style={{ width: `${scorePct}%` }} />
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-5 space-y-3 border-t border-white/50">
          <p className="text-sm text-gray-700 leading-relaxed mt-3">{check.description}</p>
          {check.detail && (
            <div className="text-xs text-gray-500 bg-white/60 rounded-lg px-4 py-2.5 font-mono">{check.detail}</div>
          )}
          {check.action && check.action.keys?.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{check.action.label}</div>
              <div className="flex flex-wrap gap-1.5">
                {check.action.keys.map((key) => (
                  <a
                    key={key}
                    href={`${check.action.serverUrl}/browse/${key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-blue-600 bg-white rounded px-2 py-1 hover:bg-blue-50 hover:underline border border-blue-200 transition-colors"
                  >
                    {key}
                  </a>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 mt-2">
            {route && (
              <Link href={route.href} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-md transition-colors">
                {route.label}
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PiCompliancePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showStepper, setShowStepper] = useState(false);
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPiCompliance(jql || undefined);
      setData(result);
      toast.success("PI compliance data loaded");
    } catch (err) {
      setError(err.message);
      toast.error("Failed to load PI compliance data");
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [jql]);

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">PI Compliance</h1>
            <button onClick={load} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-md">
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            <strong>Error:</strong> {error}
          </div>
        )}

        <JqlBar value={inputJql} onChange={setInputJql} onSubmit={(q) => setJql(q)} />

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-blue-200 border-t-blue-600 rounded-full" />
          </div>
        )}

        {!loading && data && (
          <>
            {/* Header with overall PI score */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center gap-6">
                <ScoreRing score={data.score} size={110} />
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-gray-900">PI Planning Compliance</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Cross-project assessment of your PI planning health. These checks evaluate whether your teams are aligned,
                    dependencies are tracked, and the PI is on course for delivery.
                  </p>
                  <div className="flex items-center gap-4 mt-3">
                    {data.piConfig?.name && (
                      <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded font-medium">{data.piConfig.name}</span>
                    )}
                    <span className="text-xs text-gray-500">{data.teamCount} teams</span>
                    <span className="text-xs text-gray-500">{data.totalIssues} total issues</span>
                    <span className="text-xs text-gray-500">{data.crossTeamDeps} cross-team deps</span>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                    <span>Score: {data.totalScore}/{data.maxPossible} points</span>
                    {data.piConfig?.startDate && (
                      <span>PI: {data.piConfig.startDate} → {data.piConfig.endDate}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {data.checks.some((c) => c.status !== "pass") && (
                    <button
                      onClick={() => setShowStepper(!showStepper)}
                      className={`text-sm px-4 py-2 rounded-lg transition-colors ${
                        showStepper ? "bg-gray-200 text-gray-600" : "bg-orange-500 hover:bg-orange-600 text-white"
                      }`}
                    >
                      {showStepper ? "Show All" : "Fix Issues"}
                    </button>
                  )}
                  <Link href="/compliance" className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors text-center">
                    &larr; Project Compliance
                  </Link>
                </div>
              </div>
            </div>

            {/* Score breakdown bar */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Score Breakdown</h3>
              <div className="flex h-8 rounded-lg overflow-hidden">
                {data.checks.map((check) => {
                  const widthPct = (check.maxScore / data.maxPossible) * 100;
                  const fillPct = check.maxScore > 0 ? (check.score / check.maxScore) * 100 : 0;
                  const bg = fillPct >= 80 ? "bg-green-500" : fillPct >= 60 ? "bg-blue-500" : fillPct >= 40 ? "bg-amber-500" : "bg-red-500";
                  return (
                    <div key={check.id} className="relative group" style={{ width: `${widthPct}%` }} title={`${check.name}: ${check.score}/${check.maxScore}`}>
                      <div className="absolute inset-0 bg-gray-100 border-r border-white" />
                      <div className={`absolute inset-y-0 left-0 ${bg} transition-all duration-500`} style={{ width: `${fillPct}%` }} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[9px] font-bold text-white drop-shadow-sm truncate px-1">
                          {check.name.split(" ").slice(0, 2).join(" ")}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                <span>0</span>
                <span>{data.maxPossible} pts</span>
              </div>
            </div>

            {/* Checks list or Stepper */}
            {showStepper ? (
              <ComplianceStepper
                checks={data.checks}
                onReload={load}
                loading={loading}
              />
            ) : (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-800">PI Planning Checks ({data.checks.length})</h3>
                {data.checks.map((check) => (
                  <PiCheckCard key={check.id} check={check} />
                ))}
              </div>
            )}

            {/* Action plan summary */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-indigo-800 mb-3">Recommended Actions</h3>
              <div className="space-y-2">
                {data.checks
                  .filter((c) => c.status !== "pass")
                  .sort((a, b) => (a.score / a.maxScore) - (b.score / b.maxScore))
                  .map((check) => (
                    <div key={check.id} className="flex items-start gap-3 text-xs">
                      <span className={`shrink-0 w-2 h-2 rounded-full mt-1 ${check.status === "fail" ? "bg-red-500" : "bg-amber-500"}`} />
                      <div>
                        <span className="font-medium text-indigo-900">{check.name}:</span>{" "}
                        <span className="text-indigo-700">{check.description.split(".")[0]}.</span>
                      </div>
                    </div>
                  ))}
                {data.checks.every((c) => c.status === "pass") && (
                  <p className="text-sm text-green-700 font-medium">All checks pass! Your PI planning is fully compliant.</p>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
