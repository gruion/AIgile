"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  fetchRetroSessions,
  createRetroSession,
  fetchRetroSession,
  addRetroEntry,
  voteRetroEntry,
  deleteRetroSession,
  fetchAnalytics,
  fetchSettings,
} from "../../lib/api";
import { selectTicketsForPrompt, formatTicketForPrompt, trimPrompt } from "../../lib/prompt-utils";
import { fetchIssues } from "../../lib/api";

const DEFAULT_JQL = process.env.NEXT_PUBLIC_DEFAULT_JQL || "project = TEAM ORDER BY status ASC, updated DESC";

const CATEGORIES = [
  { key: "went_well", label: "Went Well", color: "bg-green-50 border-green-200", badge: "bg-green-100 text-green-700", icon: "\u2705" },
  { key: "to_improve", label: "To Improve", color: "bg-orange-50 border-orange-200", badge: "bg-orange-100 text-orange-700", icon: "\u26A0\uFE0F" },
  { key: "action_item", label: "Action Items", color: "bg-blue-50 border-blue-200", badge: "bg-blue-100 text-blue-700", icon: "\uD83D\uDE80" },
  { key: "question", label: "Questions", color: "bg-purple-50 border-purple-200", badge: "bg-purple-100 text-purple-700", icon: "\u2753" },
  { key: "shoutout", label: "Shoutouts", color: "bg-pink-50 border-pink-200", badge: "bg-pink-100 text-pink-700", icon: "\uD83C\uDF1F" },
];

const COACH_TIPS = [
  { title: "Psychological Safety First", detail: "Ensure everyone feels safe to speak openly. Use 'I noticed...' instead of 'You did...'. Focus on processes, not people." },
  { title: "Data Over Opinions", detail: "Ground discussions in metrics (cycle time, WIP, stale tickets) rather than gut feelings. Use the Analytics tab for evidence." },
  { title: "Action Items Need Owners", detail: "Every action item must have a single owner and a due date. Unowned actions never get done." },
  { title: "Limit to 3 Actions", detail: "Don't try to fix everything at once. Pick the 2-3 highest-impact improvements and commit to them fully." },
  { title: "Review Last Retro's Actions", detail: "Always start by reviewing whether previous action items were completed. Accountability drives improvement." },
  { title: "Timebox Strictly", detail: "Keep retros to 60 minutes max. Use a timer: 10min review, 15min went-well, 15min to-improve, 15min actions, 5min wrap." },
];

function buildRetroPrompt(analyticsData, entries, promptSettings) {
  const today = new Date().toISOString().split("T")[0];
  const lines = [];

  lines.push("You are a senior Agile Coach facilitating a sprint retrospective. Analyze the team's board data AND their own retrospective feedback to produce actionable insights.");
  lines.push("IMPORTANT: Return ONLY valid JSON, no markdown, no explanation, no code fences.");
  lines.push("");
  lines.push(`# Sprint Retrospective Analysis — ${today}`);
  lines.push("");

  // Board metrics
  if (analyticsData) {
    lines.push("## Board Metrics");
    lines.push(`- Total tickets: ${analyticsData.total}`);
    lines.push(`- In Progress (WIP): ${analyticsData.wipCount}`);
    lines.push(`- Average quality: ${analyticsData.avgQuality}%`);
    lines.push(`- Average cycle time: ${analyticsData.cycleTime?.avg}d (median: ${analyticsData.cycleTime?.median}d)`);
    lines.push(`- Stale tickets: ${analyticsData.staleIssues?.length || 0}`);
    lines.push(`- Overdue: ${analyticsData.dueDateCompliance?.overdueActive || 0}`);
    lines.push(`- Priority inflation: ${analyticsData.priorityInflation}%`);
    lines.push(`- Sprint health: ${analyticsData.sprintHealth?.score || "N/A"}/100 (${analyticsData.sprintHealth?.status || "unknown"})`);
    if (analyticsData.bottlenecks?.length > 0) {
      lines.push(`- Bottlenecks: ${analyticsData.bottlenecks.map((b) => `${b.status} (${b.count} items)`).join(", ")}`);
    }
    if (analyticsData.wipLimits?.violations?.length > 0) {
      lines.push(`- WIP violations: ${analyticsData.wipLimits.violations.map((v) => `${v.name}: ${v.current}/${v.limit}`).join(", ")}`);
    }
    lines.push("");
  }

  // Team feedback
  if (entries.length > 0) {
    lines.push("## Team Feedback");
    for (const cat of CATEGORIES) {
      const catEntries = entries.filter((e) => e.category === cat.key);
      if (catEntries.length > 0) {
        lines.push(`\n### ${cat.label}`);
        catEntries.forEach((e) => {
          lines.push(`- [${e.author}] ${e.text}${e.votes > 0 ? ` (${e.votes} votes)` : ""}`);
        });
      }
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("Based on BOTH the board metrics AND team feedback, return this JSON:");
  lines.push(`{
  "sprint_summary": "2-3 sentence summary of how the sprint went, referencing specific metrics",
  "health_assessment": {
    "score": 0-100,
    "status": "healthy | needs_attention | critical",
    "key_metrics": ["list of 3-5 key observations from the data"]
  },
  "themes": [
    {
      "title": "Theme name (e.g., 'WIP overload', 'Communication gaps')",
      "description": "What the data and feedback tell us",
      "evidence_from_data": "Specific metrics that support this theme",
      "evidence_from_team": "What team members said about this",
      "impact": "high | medium | low",
      "category": "process | technical | communication | planning | culture"
    }
  ],
  "action_items": [
    {
      "title": "Specific, actionable improvement",
      "description": "How to implement this change",
      "expected_impact": "What improvement we expect to see",
      "priority": 1,
      "category": "process | technical | communication | planning",
      "measurable_outcome": "How we'll know it worked (specific metric)"
    }
  ],
  "celebrations": ["List 2-3 things to celebrate based on the data and feedback"],
  "warning_signs": ["List potential risks or anti-patterns the coach spotted"],
  "next_sprint_focus": "One sentence describing the team's top priority for next sprint"
}`);

  return lines.join("\n");
}

export default function RetroPage() {
  const [view, setView] = useState("sessions"); // "sessions" | "session" | "prompt" | "paste" | "report"
  const [sessions, setSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [newTitle, setNewTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [entryText, setEntryText] = useState("");
  const [entryCategory, setEntryCategory] = useState("went_well");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [copied, setCopied] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [report, setReport] = useState(null);
  const [showCoachTips, setShowCoachTips] = useState(true);
  const [pollInterval, setPollInterval] = useState(null);

  // Load author from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("retro-author");
    if (saved) setAuthor(saved);
  }, []);

  useEffect(() => {
    if (author) localStorage.setItem("retro-author", author);
  }, [author]);

  // Load sessions
  const loadSessions = useCallback(async () => {
    try {
      const data = await fetchRetroSessions();
      setSessions(data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Load analytics for prompt building
  useEffect(() => {
    fetchAnalytics(DEFAULT_JQL).then(setAnalyticsData).catch(() => {});
  }, []);

  // Auto-refresh current session every 5 seconds (collaborative)
  useEffect(() => {
    if (!currentSession?.id) return;
    const interval = setInterval(async () => {
      try {
        const updated = await fetchRetroSession(currentSession.id);
        setCurrentSession(updated);
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [currentSession?.id]);

  const handleCreateSession = async () => {
    if (!newTitle.trim()) return;
    setLoading(true);
    try {
      const session = await createRetroSession(newTitle.trim());
      setCurrentSession(session);
      setView("session");
      setNewTitle("");
      loadSessions();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleOpenSession = async (id) => {
    setLoading(true);
    try {
      const session = await fetchRetroSession(id);
      setCurrentSession(session);
      setView("session");
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleAddEntry = async () => {
    if (!entryText.trim() || !currentSession) return;
    try {
      await addRetroEntry(currentSession.id, {
        author: author || "Anonymous",
        category: entryCategory,
        text: entryText.trim(),
      });
      setEntryText("");
      const updated = await fetchRetroSession(currentSession.id);
      setCurrentSession(updated);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleVote = async (entryId) => {
    if (!currentSession) return;
    try {
      await voteRetroEntry(currentSession.id, entryId);
      const updated = await fetchRetroSession(currentSession.id);
      setCurrentSession(updated);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleParseJson = () => {
    try {
      let cleaned = jsonInput.trim();
      if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      const parsed = JSON.parse(cleaned);
      setReport(parsed);
      localStorage.setItem(`retro-report-${currentSession?.id}`, JSON.stringify(parsed));
      setView("report");
    } catch {
      setError("Invalid JSON. Make sure you copied the complete AI response.");
    }
  };

  // Load saved report if exists
  useEffect(() => {
    if (currentSession?.id) {
      const saved = localStorage.getItem(`retro-report-${currentSession.id}`);
      if (saved) {
        try { setReport(JSON.parse(saved)); } catch {}
      }
    }
  }, [currentSession?.id]);

  const prompt = useMemo(() => {
    if (!currentSession) return "";
    return buildRetroPrompt(analyticsData, currentSession.entries || [], {});
  }, [analyticsData, currentSession]);

  const entriesByCategory = useMemo(() => {
    if (!currentSession?.entries) return {};
    const grouped = {};
    for (const cat of CATEGORIES) {
      grouped[cat.key] = (currentSession.entries || [])
        .filter((e) => e.category === cat.key)
        .sort((a, b) => b.votes - a.votes);
    }
    return grouped;
  }, [currentSession?.entries]);

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">Retrospective</h1>
          </div>

          {/* Breadcrumb navigation */}
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={() => { setView("sessions"); setCurrentSession(null); }}
              className={`px-3 py-1 rounded ${view === "sessions" ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100"}`}
            >
              Sessions
            </button>
            {currentSession && (
              <>
                <span className="text-gray-300">/</span>
                <button
                  onClick={() => setView("session")}
                  className={`px-3 py-1 rounded ${view === "session" ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100"}`}
                >
                  {currentSession.title}
                </button>
                <span className="text-gray-300">/</span>
                <button
                  onClick={() => setView("prompt")}
                  className={`px-3 py-1 rounded ${view === "prompt" ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100"}`}
                >
                  AI Prompt
                </button>
                <button
                  onClick={() => setView("paste")}
                  className={`px-3 py-1 rounded ${view === "paste" ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100"}`}
                >
                  Paste Response
                </button>
                {report && (
                  <button
                    onClick={() => setView("report")}
                    className={`px-3 py-1 rounded ${view === "report" ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100"}`}
                  >
                    AI Report
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-center justify-between">
            <span><strong>Error:</strong> {error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-xs">Dismiss</button>
          </div>
        )}

        {/* ═══ AGILE COACH TIPS ═══ */}
        {showCoachTips && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-indigo-800">Agile Coach Tips for Better Retrospectives</h3>
              <button onClick={() => setShowCoachTips(false)} className="text-xs text-indigo-500 hover:text-indigo-700">Hide</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {COACH_TIPS.map((tip, i) => (
                <div key={i} className="bg-white/70 rounded-lg p-3 border border-indigo-100">
                  <p className="text-xs font-semibold text-indigo-700">{tip.title}</p>
                  <p className="text-[11px] text-indigo-600 mt-1">{tip.detail}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {!showCoachTips && (
          <button onClick={() => setShowCoachTips(true)} className="text-xs text-indigo-500 hover:text-indigo-700">
            Show Agile Coach Tips
          </button>
        )}

        {/* ═══ SESSIONS LIST ═══ */}
        {view === "sessions" && (
          <div className="space-y-6">
            {/* Create new session */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Start a New Retrospective</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={`Sprint Retro — ${new Date().toISOString().split("T")[0]}`}
                  className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  onKeyDown={(e) => e.key === "Enter" && handleCreateSession()}
                />
                <button
                  onClick={handleCreateSession}
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50"
                >
                  Create Session
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Share the session URL with your team so everyone can add their feedback simultaneously.
              </p>
            </div>

            {/* Existing sessions */}
            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Previous Sessions</h3>
              {sessions.length > 0 ? (
                <div className="space-y-2">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleOpenSession(s.id)}
                    >
                      <div>
                        <h4 className="text-sm font-medium text-gray-800">{s.title}</h4>
                        <p className="text-xs text-gray-500">{new Date(s.createdAt).toLocaleString()} — {s.entryCount} entries</p>
                      </div>
                      <span className="text-xs text-blue-600">Open &rarr;</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400 text-sm">No retrospective sessions yet. Create one to get started.</div>
              )}
            </div>
          </div>
        )}

        {/* ═══ ACTIVE SESSION (Collaborative Board) ═══ */}
        {view === "session" && currentSession && (
          <div className="space-y-6">
            {/* Author name */}
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500">Your name:</label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Enter your name..."
                className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <span className="text-[10px] text-green-600 ml-auto">Auto-refreshing every 5s</span>
              <button
                onClick={() => setView("prompt")}
                className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg"
              >
                Generate AI Prompt &rarr;
              </button>
            </div>

            {/* Entry input */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex gap-2 mb-3">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    onClick={() => setEntryCategory(cat.key)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      entryCategory === cat.key
                        ? `${cat.badge} border-current font-medium`
                        : "text-gray-500 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {cat.icon} {cat.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={entryText}
                  onChange={(e) => setEntryText(e.target.value)}
                  placeholder={`Add a "${CATEGORIES.find((c) => c.key === entryCategory)?.label}" item...`}
                  className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  onKeyDown={(e) => e.key === "Enter" && handleAddEntry()}
                />
                <button
                  onClick={handleAddEntry}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Category columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {CATEGORIES.map((cat) => {
                const items = entriesByCategory[cat.key] || [];
                return (
                  <div key={cat.key} className={`rounded-xl border p-4 ${cat.color} min-h-[200px]`}>
                    <h4 className="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <span>{cat.icon}</span>
                      <span>{cat.label}</span>
                      <span className={`ml-auto px-1.5 py-0.5 rounded-full text-[10px] ${cat.badge}`}>
                        {items.length}
                      </span>
                    </h4>
                    <div className="space-y-2">
                      {items.map((entry) => (
                        <div key={entry.id} className="bg-white rounded-lg p-3 shadow-sm border border-white/50">
                          <p className="text-sm text-gray-800">{entry.text}</p>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-[10px] text-gray-400">{entry.author}</span>
                            <button
                              onClick={() => handleVote(entry.id)}
                              className="text-[10px] px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                            >
                              {"\uD83D\uDC4D"} {entry.votes}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ AI PROMPT ═══ */}
        {view === "prompt" && currentSession && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
              <strong>Step 1:</strong> This prompt combines your board metrics with your team&apos;s retro feedback.
              Copy it and paste into your corporate AI chatbot.
            </div>

            <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-300">Retro Analysis Prompt</span>
                  <span className="text-[10px] text-gray-500">{prompt.length.toLocaleString()} chars</span>
                  <span className="text-[10px] text-gray-500">~{Math.ceil(prompt.length / 4).toLocaleString()} tokens</span>
                </div>
                <button
                  onClick={() => handleCopy(prompt)}
                  className={`text-xs px-3 py-1 rounded transition-all ${
                    copied ? "bg-green-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-gray-200"
                  }`}
                >
                  {copied ? "Copied!" : "Copy to clipboard"}
                </button>
              </div>
              <pre className="p-4 text-xs text-gray-300 font-mono overflow-auto max-h-[500px] whitespace-pre-wrap leading-relaxed">
                {prompt}
              </pre>
            </div>

            <button
              onClick={() => { handleCopy(prompt); setTimeout(() => setView("paste"), 500); }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-lg"
            >
              Copy & Continue to Paste Response &rarr;
            </button>
          </div>
        )}

        {/* ═══ PASTE AI RESPONSE ═══ */}
        {view === "paste" && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
              <strong>Step 2:</strong> Paste the AI&apos;s JSON response below. The dashboard will visualize the insights.
            </div>

            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder="Paste the JSON response from your AI chatbot here..."
              className="w-full h-[400px] text-sm bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />

            <button
              onClick={handleParseJson}
              disabled={!jsonInput.trim()}
              className="w-full bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-2.5 rounded-lg disabled:opacity-50"
            >
              Parse & View Report
            </button>
          </div>
        )}

        {/* ═══ AI REPORT ═══ */}
        {view === "report" && report && (
          <div className="space-y-6">
            {/* Sprint summary */}
            <div className={`rounded-xl border-2 p-6 ${
              report.health_assessment?.status === "healthy" ? "bg-green-50 border-green-300"
                : report.health_assessment?.status === "needs_attention" ? "bg-amber-50 border-amber-300"
                : "bg-red-50 border-red-300"
            }`}>
              <div className="flex items-center gap-4 mb-3">
                <div className="text-3xl font-bold">
                  {report.health_assessment?.score || "—"}
                </div>
                <div>
                  <div className="text-lg font-semibold capitalize">
                    {(report.health_assessment?.status || "unknown").replace("_", " ")}
                  </div>
                  <p className="text-sm text-gray-700 mt-1">{report.sprint_summary}</p>
                </div>
              </div>
              {report.health_assessment?.key_metrics && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {report.health_assessment.key_metrics.map((m, i) => (
                    <span key={i} className="text-xs bg-white/60 rounded-full px-3 py-1 text-gray-700">{m}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Celebrations */}
            {report.celebrations?.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-green-800 mb-3">{"\uD83C\uDF89"} Celebrations</h3>
                <div className="space-y-2">
                  {report.celebrations.map((c, i) => (
                    <p key={i} className="text-sm text-green-700">{c}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Warning Signs (Coach) */}
            {report.warning_signs?.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-red-800 mb-3">{"\u26A0\uFE0F"} Agile Coach Warning Signs</h3>
                <div className="space-y-2">
                  {report.warning_signs.map((w, i) => (
                    <p key={i} className="text-sm text-red-700">{w}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Themes */}
            {report.themes?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-3">Identified Themes</h3>
                <div className="space-y-3">
                  {report.themes.map((theme, i) => {
                    const impactColor = theme.impact === "high" ? "bg-red-100 text-red-700"
                      : theme.impact === "medium" ? "bg-amber-100 text-amber-700"
                      : "bg-blue-100 text-blue-700";
                    return (
                      <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${impactColor}`}>
                            {theme.impact} impact
                          </span>
                          <span className="text-[10px] text-gray-400 px-2 py-0.5 rounded bg-gray-100">
                            {theme.category}
                          </span>
                          <h4 className="text-sm font-semibold text-gray-800">{theme.title}</h4>
                        </div>
                        <p className="text-sm text-gray-600 mb-3">{theme.description}</p>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="bg-gray-50 rounded-lg p-3">
                            <span className="font-medium text-gray-500">From Data:</span>
                            <p className="text-gray-700 mt-1">{theme.evidence_from_data}</p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-3">
                            <span className="font-medium text-gray-500">From Team:</span>
                            <p className="text-gray-700 mt-1">{theme.evidence_from_team}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Action Items */}
            {report.action_items?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-3">{"\uD83D\uDE80"} Action Items</h3>
                <div className="space-y-2">
                  {report.action_items.map((item, i) => (
                    <div key={i} className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold text-blue-700 bg-blue-200 rounded-full w-6 h-6 flex items-center justify-center">
                          {item.priority || i + 1}
                        </span>
                        <h4 className="text-sm font-semibold text-blue-900">{item.title}</h4>
                        <span className="text-[10px] text-blue-500 ml-auto">{item.category}</span>
                      </div>
                      <p className="text-sm text-blue-800">{item.description}</p>
                      <div className="flex gap-4 mt-2 text-xs text-blue-600">
                        <span><strong>Expected:</strong> {item.expected_impact}</span>
                        <span><strong>Measure:</strong> {item.measurable_outcome}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Next Sprint Focus */}
            {report.next_sprint_focus && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 text-center">
                <h3 className="text-xs font-semibold text-indigo-500 uppercase tracking-wider mb-2">Next Sprint Focus</h3>
                <p className="text-lg font-medium text-indigo-800">{report.next_sprint_focus}</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
