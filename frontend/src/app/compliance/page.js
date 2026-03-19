"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { fetchProjectCompliance } from "../../lib/api";
import JqlBar from "../../components/JqlBar";
import AiCoachPanel from "../../components/AiCoachPanel";
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

function CheckCard({ check }) {
  const [expanded, setExpanded] = useState(false);
  const statusStyles = {
    pass: "border-green-200 bg-green-50",
    warning: "border-amber-200 bg-amber-50",
    fail: "border-red-200 bg-red-50",
    critical: "border-red-300 bg-red-100",
  };
  const statusBadge = {
    pass: "bg-green-100 text-green-700",
    warning: "bg-amber-100 text-amber-700",
    fail: "bg-red-100 text-red-700",
    critical: "bg-red-200 text-red-800",
  };
  const scorePct = check.maxScore > 0 ? Math.round((check.score / check.maxScore) * 100) : 0;
  const barColor = scorePct >= 80 ? "bg-green-500" : scorePct >= 60 ? "bg-blue-500" : scorePct >= 40 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className={`rounded-xl border-2 overflow-hidden transition-all ${statusStyles[check.status]}`}>
      <div className="px-5 py-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${statusBadge[check.status]}`}>
              {check.status}
            </span>
            <h4 className="text-sm font-semibold text-gray-800">{check.name}</h4>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-700">{check.score}/{check.maxScore}</span>
            <span className="text-gray-400 text-xs">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>
        <div className="w-full bg-white/60 rounded-full h-2 overflow-hidden">
          <div className={`${barColor} h-2 rounded-full transition-all duration-500`} style={{ width: `${scorePct}%` }} />
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-4 space-y-3 border-t border-white/50">
          <p className="text-xs text-gray-700 leading-relaxed mt-3">{check.description}</p>
          {check.detail && (
            <div className="text-[11px] text-gray-500 bg-white/60 rounded-lg px-3 py-2 font-mono">{check.detail}</div>
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
        </div>
      )}
    </div>
  );
}

export default function CompliancePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stepperProject, setStepperProject] = useState(null); // team id of project in stepper mode
  const [expandedProjects, setExpandedProjects] = useState({}); // { teamId: true/false }
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");

  const toggleProject = (id) => setExpandedProjects((prev) => ({ ...prev, [id]: !prev[id] }));

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchProjectCompliance(jql || undefined);
      setData(result);
      toast.success("Compliance data loaded");
    } catch (err) {
      setError(err.message);
      toast.error("Failed to load compliance data");
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [jql]);

  const overallScore = data?.projects
    ? Math.round(data.projects.reduce((sum, p) => sum + p.score, 0) / Math.max(data.projects.length, 1))
    : 0;

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">Project Compliance</h1>
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

        {/* AI Coach */}
        {data && (
          <div className="mb-4">
            <AiCoachPanel
              context="Project Compliance Dashboard"
              data={{
                projects: (data.projects || []).map(p => ({
                  name: p.projectKey,
                  score: p.overallScore,
                  failedChecks: p.checks?.filter(c => c.status === "fail").map(c => c.name),
                  warningChecks: p.checks?.filter(c => c.status === "warning").map(c => c.name),
                })),
              }}
              prompts={[
                { label: "Compliance summary", question: "Summarize the project compliance status. What are the critical issues?" },
                { label: "Quick wins", question: "What are the easiest compliance checks to fix that would give the biggest score improvement?" },
                { label: "Action plan", question: "Create a prioritized action plan to improve compliance scores across all projects." },
                { label: "Best practices", question: "Which agile best practices are we missing? How do we compare to industry standards?" },
              ]}
            />
          </div>
        )}

        {!loading && data && (
          <>
            {/* Page header with overall score */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center gap-6">
                <ScoreRing score={overallScore} size={100} />
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-gray-900">Project Agile Compliance</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Each project is scored on {data.projects[0]?.checks?.length || 20} agile best practices. Fix the issues below to reach 100% compliance.
                    Expand any check to see details and quick-fix links.
                  </p>
                  <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                    <span>{data.projects.length} projects</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Pass (80%+)</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Warning (40-79%)</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Fail (&lt;40%)</span>
                  </div>
                </div>
                <Link href="/pi-compliance" className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors">
                  PI Compliance &rarr;
                </Link>
              </div>
            </div>

            {/* Project cards */}
            <div className="space-y-8">
              {data.projects.map((project) => {
                const hasFailing = project.checks.some((c) => c.status !== "pass");
                const inStepper = stepperProject === project.team.id;
                const isExpanded = expandedProjects[project.team.id] !== false; // default open
                return (
                  <div key={project.team.id} className="space-y-3">
                    {/* Project header — click to toggle */}
                    <button
                      onClick={() => toggleProject(project.team.id)}
                      className="w-full flex items-center gap-4 hover:bg-gray-50 rounded-lg p-2 -m-2 transition-colors cursor-pointer"
                    >
                      <svg className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: project.team.color }} />
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-3">
                          <h3 className="text-base font-bold text-gray-900">{project.team.name}</h3>
                          <span className="text-xs font-mono text-gray-400">{project.team.projectKey}</span>
                          {project.error && (
                            <span className="text-xs text-red-500 bg-red-50 px-2 py-0.5 rounded">{project.error}</span>
                          )}
                        </div>
                        {project.stats && (
                          <div className="flex items-center gap-4 mt-0.5 text-xs text-gray-500">
                            <span>{project.stats.total} issues</span>
                            <span className="text-green-600">{project.stats.done} done</span>
                            <span className="text-blue-600">{project.stats.inProgress} WIP</span>
                            <span>{project.stats.todo} to do</span>
                            {project.stats.stale > 0 && <span className="text-amber-600">{project.stats.stale} stale</span>}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <ScoreRing score={project.score} size={70} />
                      </div>
                    </button>

                    {/* Collapsible content */}
                    {isExpanded && (
                      <div className="ml-8">
                        {hasFailing && (
                          <div className="mb-3">
                            <button
                              onClick={() => setStepperProject(inStepper ? null : project.team.id)}
                              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                                inStepper
                                  ? "bg-gray-200 text-gray-600"
                                  : "bg-orange-500 hover:bg-orange-600 text-white"
                              }`}
                            >
                              {inStepper ? "Show All Checks" : "Fix Issues Step by Step"}
                            </button>
                          </div>
                        )}
                        {inStepper ? (
                          <ComplianceStepper
                            checks={project.checks}
                            onReload={load}
                            loading={loading}
                          />
                        ) : (
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            {project.checks.map((check) => (
                              <CheckCard key={check.id} check={check} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

      </main>
    </div>
  );
}
