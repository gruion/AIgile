"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchExpertise } from "../../lib/api";
import AiCoachPanel from "../../components/AiCoachPanel";
import JqlBar from "../../components/JqlBar";
import { toast } from "../../components/Toaster";
import { useAppConfig } from "../../context/AppConfigContext";

// ─── Helpers ────────────────────────────────────────────

function scoreColor(score) {
  if (score >= 20) return "text-green-700 bg-green-50";
  if (score >= 10) return "text-blue-700 bg-blue-50";
  if (score >= 5) return "text-amber-700 bg-amber-50";
  return "text-gray-500 bg-gray-50";
}

function riskBadge(risk) {
  if (risk === "critical") return "bg-red-100 text-red-800 border-red-200";
  return "bg-amber-100 text-amber-800 border-amber-200";
}

function daysAgoText(days) {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const AI_PROMPTS = [
  { label: "Knowledge gaps", primary: true, question: "Analyze the expertise data. Where are the critical knowledge gaps? Which domains have only 1 expert (bus factor risk)? What cross-training should we prioritize? Be specific with names and domains." },
  { label: "Succession planning", question: "Based on the expertise map, create a succession plan. For each critical domain, who is the backup if the primary expert leaves? Where do we need to invest in training?" },
  { label: "Team structure", question: "Does the expertise distribution suggest any team structure improvements? Are people spread too thin across too many domains? Should we specialize or cross-train more?" },
  { label: "Onboarding guide", question: "Based on this expertise map, create an onboarding guide for a new team member. Who should they talk to about each domain? What's the best learning path?" },
  { label: "RACI suggestions", question: "Based on expertise scores, suggest RACI assignments. The top expert per domain should typically be Accountable, secondary experts Responsible, and others Consulted or Informed." },
];

// ─── Main Page ──────────────────────────────────────────

export default function ExpertisePage() {
  const { defaultJql } = useAppConfig();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");
  const [view, setView] = useState("domains"); // domains | people | busFactor
  const [selectedDomain, setSelectedDomain] = useState(null);
  const [selectedPerson, setSelectedPerson] = useState(null);

  const load = useCallback(async (query) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchExpertise(query);
      setData(result);
      toast.success(`Analyzed ${result.totalIssuesAnalyzed} tickets — ${result.stats.totalPeople} people, ${result.stats.totalDomains} domains`);
    } catch (err) {
      setError(err.message);
      toast.error("Failed to analyze expertise");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (defaultJql) {
      setJql((prev) => prev || defaultJql);
      setInputJql((prev) => prev || defaultJql);
    }
  }, [defaultJql]);

  useEffect(() => {
    if (jql) load(jql);
  }, [jql, load]);

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Expertise Map</h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Who knows what — based on Jira activity analysis
              </p>
            </div>
            <button onClick={() => load(jql)} disabled={loading} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-md disabled:opacity-50">
              Refresh
            </button>
          </div>
          <JqlBar value={inputJql} onChange={setInputJql} onSubmit={(q) => setJql(q)} placeholder="JQL to select tickets for expertise analysis (default: all resolved)" />
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-6 space-y-6">
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
            {/* AI Coach */}
            <AiCoachPanel context="Expertise Map — SME Detection" data={data} prompts={AI_PROMPTS} title="Expertise Coach" />

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                <span className="text-2xl font-bold text-gray-900">{data.totalIssuesAnalyzed}</span>
                <p className="text-[10px] text-gray-500 mt-1">Tickets Analyzed</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                <span className="text-2xl font-bold text-blue-700">{data.stats.totalPeople}</span>
                <p className="text-[10px] text-gray-500 mt-1">Contributors</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                <span className="text-2xl font-bold text-green-700">{data.stats.totalDomains}</span>
                <p className="text-[10px] text-gray-500 mt-1">Domains Detected</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                <span className={`text-2xl font-bold ${data.stats.busFactorRisks > 0 ? "text-red-700" : "text-green-700"}`}>
                  {data.stats.busFactorRisks}
                </span>
                <p className="text-[10px] text-gray-500 mt-1">Bus Factor Risks</p>
              </div>
            </div>

            {/* View toggle */}
            <div className="flex items-center gap-2">
              {[
                { key: "domains", label: "By Domain" },
                { key: "people", label: "By Person" },
                { key: "busFactor", label: "Bus Factor" },
              ].map((v) => (
                <button
                  key={v.key}
                  onClick={() => { setView(v.key); setSelectedDomain(null); setSelectedPerson(null); }}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    view === v.key ? "bg-blue-50 text-blue-700 border-blue-200 font-medium" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {v.label}
                  {v.key === "busFactor" && data.stats.busFactorRisks > 0 && (
                    <span className="ml-1.5 bg-red-100 text-red-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{data.stats.busFactorRisks}</span>
                  )}
                </button>
              ))}
            </div>

            {/* ═══ Domains View ═══ */}
            {view === "domains" && (
              <div className="space-y-3">
                {data.topDomains.map((d) => (
                  <div
                    key={d.domain}
                    className={`bg-white rounded-xl border overflow-hidden transition-all ${
                      selectedDomain === d.domain ? "border-blue-400 ring-1 ring-blue-200" : "border-gray-200"
                    }`}
                  >
                    <button
                      onClick={() => setSelectedDomain(selectedDomain === d.domain ? null : d.domain)}
                      className="w-full px-5 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                    >
                      <span className="text-sm font-semibold text-gray-900 flex-1">{d.domain}</span>
                      <span className="text-[10px] text-gray-400">{d.totalTickets} tickets</span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${d.expertCount <= 1 ? "bg-red-100 text-red-700" : d.expertCount <= 2 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
                        {d.expertCount} expert{d.expertCount !== 1 ? "s" : ""}
                      </span>
                      {/* Top 3 expert badges */}
                      <div className="flex items-center gap-1">
                        {d.topExperts.map((e, i) => (
                          <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full border ${i === 0 ? "bg-yellow-50 border-yellow-300 text-yellow-800 font-bold" : "bg-gray-50 border-gray-200 text-gray-600"}`}>
                            {e.name.split(" ")[0]} ({e.score})
                          </span>
                        ))}
                      </div>
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${selectedDomain === d.domain ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {selectedDomain === d.domain && (
                      <div className="px-5 pb-4 border-t border-gray-100">
                        <div className="mt-3 space-y-2">
                          {(data.domainExperts[d.domain] || []).map((expert, i) => (
                            <div key={i} className="flex items-center gap-3 py-1.5">
                              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                i === 0 ? "bg-yellow-100 text-yellow-800" : i === 1 ? "bg-gray-200 text-gray-700" : i === 2 ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-500"
                              }`}>
                                {i + 1}
                              </span>
                              <span className="text-sm text-gray-800 font-medium w-40 truncate">{expert.person}</span>
                              <span className={`text-xs font-bold px-2 py-0.5 rounded ${scoreColor(expert.score)}`}>
                                {expert.score}
                              </span>
                              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-2 bg-blue-400 rounded-full" style={{ width: `${Math.min(100, (expert.score / (data.domainExperts[d.domain][0]?.score || 1)) * 100)}%` }} />
                              </div>
                              <span className="text-[10px] text-gray-400 w-20 text-right">
                                {expert.resolved} resolved
                              </span>
                              <span className="text-[10px] text-gray-400 w-16 text-right">
                                {daysAgoText(expert.daysSinceActive)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ═══ People View ═══ */}
            {view === "people" && (
              <div className="space-y-3">
                {data.people.map((p) => (
                  <div
                    key={p.name}
                    className={`bg-white rounded-xl border overflow-hidden transition-all ${
                      selectedPerson === p.name ? "border-blue-400 ring-1 ring-blue-200" : "border-gray-200"
                    }`}
                  >
                    <button
                      onClick={() => setSelectedPerson(selectedPerson === p.name ? null : p.name)}
                      className="w-full px-5 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">
                        {p.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-gray-900">{p.name}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          {p.topDomains.slice(0, 4).map((d, i) => (
                            <span key={i} className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{d.domain}</span>
                          ))}
                          {p.domainCount > 4 && <span className="text-[9px] text-gray-400">+{p.domainCount - 4} more</span>}
                        </div>
                      </div>
                      <span className="text-xs text-gray-500">{p.totalResolved} resolved</span>
                      <span className="text-xs text-gray-400">{p.totalActive} active</span>
                      <span className="text-[10px] text-gray-400">{p.domainCount} domains</span>
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${selectedPerson === p.name ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {selectedPerson === p.name && (
                      <div className="px-5 pb-4 border-t border-gray-100">
                        <div className="mt-3 space-y-2">
                          {p.topDomains.map((d, i) => (
                            <div key={i} className="flex items-center gap-3 py-1">
                              <span className="text-xs text-gray-700 w-40 truncate">{d.domain}</span>
                              <span className={`text-xs font-bold px-2 py-0.5 rounded ${scoreColor(d.score)}`}>{d.score}</span>
                              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-2 bg-blue-400 rounded-full" style={{ width: `${Math.min(100, (d.score / (p.topDomains[0]?.score || 1)) * 100)}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ═══ Bus Factor View ═══ */}
            {view === "busFactor" && (
              <div className="space-y-3">
                {data.busFactor.length === 0 ? (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
                    <svg className="w-12 h-12 mx-auto text-green-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-green-700 font-medium">No bus factor risks detected!</p>
                    <p className="text-green-600 text-sm mt-1">All domains with 3+ tickets have multiple contributors.</p>
                  </div>
                ) : (
                  data.busFactor.map((bf, i) => (
                    <div key={i} className={`rounded-xl border-2 p-4 ${riskBadge(bf.risk)}`}>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold ${bf.risk === "critical" ? "text-red-700" : "text-amber-700"}`}>
                          {bf.risk === "critical" ? "!!" : "!"}
                        </span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-gray-900">{bf.domain}</span>
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${bf.risk === "critical" ? "bg-red-200 text-red-800" : "bg-amber-200 text-amber-800"}`}>
                              {bf.risk}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 mt-1">
                            {bf.expertCount === 0
                              ? `${bf.totalTickets} tickets but NO contributor identified — orphaned knowledge.`
                              : `${bf.totalTickets} tickets, only 1 expert: ${bf.soloExpert}. If they leave, this knowledge is lost.`}
                          </p>
                        </div>
                        <span className="text-xs text-gray-400">{bf.totalTickets} tickets</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}

        {!loading && !data && !error && !jql && (
          <div className="text-center py-20 text-gray-400">
            <svg className="mx-auto w-12 h-12 mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <p className="text-lg font-medium text-gray-500 mb-2">Enter a JQL query to analyze expertise</p>
            <p className="text-sm mb-4">Tip: use resolved tickets for best results:</p>
            <code className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-md">statusCategory = Done ORDER BY resolved DESC</code>
          </div>
        )}
      </main>
    </div>
  );
}
