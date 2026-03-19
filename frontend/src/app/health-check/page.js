"use client";

import { useState, useEffect } from "react";
import { fetchHealthCheckSessions, createHealthCheckSession, fetchHealthCheckSession, voteHealthCheck, deleteHealthCheckSession, fetchIssues } from "../../lib/api";
import AiCoachPanel from "../../components/AiCoachPanel";
import JqlBar from "../../components/JqlBar";
import { toast } from "../../components/Toaster";

const DEFAULT_JQL = process.env.NEXT_PUBLIC_DEFAULT_JQL || "project = TEAM ORDER BY status ASC, updated DESC";

const SCORE_COLORS = {
  1: { bg: "bg-red-500", text: "text-white", label: "Bad" },
  2: { bg: "bg-red-300", text: "text-white", label: "Poor" },
  3: { bg: "bg-yellow-400", text: "text-gray-900", label: "OK" },
  4: { bg: "bg-green-300", text: "text-gray-900", label: "Good" },
  5: { bg: "bg-green-500", text: "text-white", label: "Great" },
};

function getBarColor(avg) {
  if (avg < 2.5) return "bg-red-500";
  if (avg <= 3.5) return "bg-yellow-400";
  return "bg-green-500";
}

function getBarTextColor(avg) {
  if (avg < 2.5) return "text-red-700";
  if (avg <= 3.5) return "text-yellow-700";
  return "text-green-700";
}

function getOverallColor(avg) {
  if (avg < 2.5) return "bg-red-50 border-red-300 text-red-800";
  if (avg <= 3.5) return "bg-yellow-50 border-yellow-300 text-yellow-800";
  return "bg-green-50 border-green-300 text-green-800";
}

const AI_PROMPTS = [
  {
    label: "Full Health Analysis",
    primary: true,
    question: "As an Agile Coach, perform a comprehensive team health analysis. Cross-reference the health check scores with ticket data to validate perceptions vs reality. For each low-scoring category: 1) What the score tells us, 2) What evidence from the ticket data supports or contradicts this, 3) Root cause hypothesis, 4) Specific improvement action. Also identify: strongest areas to celebrate, biggest risks, and a 30-day improvement plan.",
  },
  {
    label: "Action plan",
    question: "For the 3 lowest-scoring categories, create a detailed action plan: specific actions, owners, timelines, and success metrics. Each action should be concrete enough to start this sprint.",
  },
  {
    label: "Discussion topics",
    question: "Generate 5 facilitation-ready discussion topics for a team meeting. For each, provide: the topic, why it matters (reference health check scores), a coaching question to open the discussion, and expected outcomes.",
  },
  {
    label: "Score interpretation",
    question: "Interpret these scores with coaching expertise: What do the patterns reveal about team dynamics? Which scores correlate with each other? What's the 'silent signal' behind low scores in specific areas? Provide benchmarks and suggest what 'good' looks like for each category.",
  },
  {
    label: "Team coaching advice",
    question: "Based on the health check results and ticket data, provide personalized coaching advice: What leadership behaviors would improve the lowest scores? What team practices should change? What systemic issues need escalation? Frame advice as supportive coaching, not criticism.",
  },
];

export default function HealthCheckPage() {
  const [view, setView] = useState("sessions"); // "sessions" | "session"
  const [sessions, setSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [newTitle, setNewTitle] = useState("");
  const [voter, setVoter] = useState("");
  const [votes, setVotes] = useState({}); // { [categoryId]: { score, comment } }
  const [loading, setLoading] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [jql, setJql] = useState(DEFAULT_JQL);
  const [inputJql, setInputJql] = useState(DEFAULT_JQL);
  const [ticketData, setTicketData] = useState(null);

  // Load voter name from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("health-check-voter");
    if (saved) setVoter(saved);
  }, []);

  useEffect(() => {
    if (voter) localStorage.setItem("health-check-voter", voter);
  }, [voter]);

  // Load sessions
  const loadSessions = async () => {
    try {
      const data = await fetchHealthCheckSessions();
      setSessions(data);
    } catch (err) {
      toast.error("Failed to load sessions: " + err.message);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  // Load ticket context for AI analysis
  useEffect(() => {
    fetchIssues(jql).then(setTicketData).catch(() => {});
  }, [jql]);

  // Create session
  const handleCreateSession = async () => {
    if (!newTitle.trim()) return;
    setLoading(true);
    try {
      const session = await createHealthCheckSession(newTitle.trim());
      setCurrentSession(session);
      setView("session");
      setNewTitle("");
      setHasVoted(false);
      setVotes({});
      loadSessions();
      toast.success("Session created!");
    } catch (err) {
      toast.error("Failed to create session: " + err.message);
    }
    setLoading(false);
  };

  // Open session
  const handleOpenSession = async (id) => {
    setLoading(true);
    try {
      const session = await fetchHealthCheckSession(id);
      setCurrentSession(session);
      setView("session");
      setHasVoted(session.responses?.length > 0);
      setVotes({});
    } catch (err) {
      toast.error("Failed to load session: " + err.message);
    }
    setLoading(false);
  };

  // Delete session
  const handleDeleteSession = async (e, id) => {
    e.stopPropagation();
    if (!confirm("Delete this health check session?")) return;
    try {
      await deleteHealthCheckSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      toast.success("Session deleted");
    } catch (err) {
      toast.error("Failed to delete session: " + err.message);
    }
  };

  // Set vote for a category
  const handleSetScore = (categoryId, score) => {
    setVotes((prev) => ({
      ...prev,
      [categoryId]: { ...prev[categoryId], score },
    }));
  };

  const handleSetComment = (categoryId, comment) => {
    setVotes((prev) => ({
      ...prev,
      [categoryId]: { ...prev[categoryId], comment },
    }));
  };

  // Submit all votes
  const handleSubmitVotes = async () => {
    if (!voter.trim()) {
      toast.error("Please enter your name before voting");
      return;
    }
    const categories = currentSession?.categories || [];
    const incomplete = categories.filter((cat) => !votes[cat.id]?.score);
    if (incomplete.length > 0) {
      toast.error(`Please rate all categories. Missing: ${incomplete.map((c) => c.label).join(", ")}`);
      return;
    }

    setLoading(true);
    try {
      for (const cat of categories) {
        const v = votes[cat.id];
        await voteHealthCheck(currentSession.id, {
          voter: voter.trim(),
          categoryId: cat.id,
          score: v.score,
          comment: v.comment || "",
        });
      }
      // Reload session to get aggregated results
      const updated = await fetchHealthCheckSession(currentSession.id);
      setCurrentSession(updated);
      setHasVoted(true);
      toast.success("Votes submitted!");
    } catch (err) {
      toast.error("Failed to submit votes: " + err.message);
    }
    setLoading(false);
  };

  // Build AI data context
  const buildAiData = () => {
    if (!currentSession?.aggregated) return currentSession;
    return {
      sessionTitle: currentSession.title,
      responseCount: currentSession.responses?.length || 0,
      categories: Object.values(currentSession.aggregated).map((cat) => ({
        label: cat.label,
        emoji: cat.emoji,
        averageScore: cat.avg,
        totalVotes: cat.count,
        distribution: cat.distribution,
      })),
    };
  };

  // Compute overall health score
  const overallScore = (() => {
    if (!currentSession?.aggregated) return null;
    const cats = Object.values(currentSession.aggregated);
    if (cats.length === 0) return null;
    const sum = cats.reduce((acc, c) => acc + (c.avg || 0), 0);
    return (sum / cats.length).toFixed(1);
  })();

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-900">Team Health Check</h1>
            {view === "session" && (
              <button
                onClick={() => { setView("sessions"); setCurrentSession(null); setHasVoted(false); setVotes({}); }}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                &larr; Back to Sessions
              </button>
            )}
            {view === "sessions" && (
              <button
                onClick={() => document.getElementById("new-session-input")?.focus()}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg"
              >
                New Session
              </button>
            )}
          </div>
          <div className="mt-2">
            <JqlBar
              value={inputJql}
              onChange={setInputJql}
              onSubmit={(q) => setJql(q)}
              placeholder="Load ticket context for health check AI analysis..."
            />
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">

        {/* AI Coach Panel */}
        {currentSession?.aggregated && (
          <div className="mb-4">
            <AiCoachPanel
              context="Team Health Check"
              data={{ ...buildAiData(), ticketContext: ticketData ? { total: ticketData.total, epicCount: ticketData.epics?.length } : null }}
              prompts={AI_PROMPTS}
              title="Health Check AI Coach"
            />
          </div>
        )}

        {/* ═══ SESSION LIST VIEW ═══ */}
        {view === "sessions" && (
          <div className="space-y-6">
            {/* Create new session */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Start a New Health Check</h3>
              <div className="flex gap-2">
                <input
                  id="new-session-input"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={`Team Health Check — ${new Date().toISOString().split("T")[0]}`}
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
                Based on the Spotify Squad Health Check model. Each team member rates 8 health categories on a 1-5 scale.
              </p>
            </div>

            {/* Session list */}
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
                        <p className="text-xs text-gray-500">
                          {new Date(s.createdAt).toLocaleString()} &mdash; {s.responseCount || 0} responses
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => handleDeleteSession(e, s.id)}
                          className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                        >
                          Delete
                        </button>
                        <span className="text-xs text-blue-600">Open &rarr;</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400 text-sm">
                  No health check sessions yet. Create one to get started.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ SESSION DETAIL VIEW ═══ */}
        {view === "session" && currentSession && (
          <div className="space-y-6">
            {/* Session header */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-base font-semibold text-gray-900">{currentSession.title}</h2>
              <p className="text-xs text-gray-500 mt-1">
                Created {new Date(currentSession.createdAt).toLocaleString()}
                {currentSession.responses?.length > 0 && (
                  <> &mdash; {currentSession.responses.length} response(s)</>
                )}
              </p>
            </div>

            {/* ─── VOTING SECTION ─── */}
            {!hasVoted && (
              <div className="space-y-4">
                {/* Voter name */}
                <div className="flex items-center gap-3">
                  <label className="text-xs text-gray-500 whitespace-nowrap">Your name:</label>
                  <input
                    type="text"
                    value={voter}
                    onChange={(e) => setVoter(e.target.value)}
                    placeholder="Enter your name..."
                    className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>

                {/* Category voting grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  {(currentSession.categories || []).map((cat) => {
                    const currentScore = votes[cat.id]?.score;
                    return (
                      <div
                        key={cat.id}
                        className={`bg-white rounded-xl border-2 p-4 transition-colors ${
                          currentScore ? "border-blue-200" : "border-gray-200"
                        }`}
                      >
                        <div className="text-center mb-3">
                          <span className="text-2xl">{cat.emoji}</span>
                          <h4 className="text-sm font-semibold text-gray-800 mt-1">{cat.label}</h4>
                        </div>

                        {/* Score buttons (traffic light 1-5) */}
                        <div className="flex justify-center gap-1.5 mb-3">
                          {[1, 2, 3, 4, 5].map((score) => {
                            const colors = SCORE_COLORS[score];
                            const isSelected = currentScore === score;
                            return (
                              <button
                                key={score}
                                onClick={() => handleSetScore(cat.id, score)}
                                className={`w-9 h-9 rounded-lg text-sm font-bold transition-all ${
                                  isSelected
                                    ? `${colors.bg} ${colors.text} ring-2 ring-offset-1 ring-blue-500 scale-110`
                                    : `bg-gray-100 text-gray-500 hover:${colors.bg} hover:${colors.text}`
                                }`}
                                title={colors.label}
                              >
                                {score}
                              </button>
                            );
                          })}
                        </div>
                        {currentScore && (
                          <p className="text-center text-[10px] text-gray-400 mb-2">
                            {SCORE_COLORS[currentScore].label}
                          </p>
                        )}

                        {/* Optional comment */}
                        <textarea
                          value={votes[cat.id]?.comment || ""}
                          onChange={(e) => handleSetComment(cat.id, e.target.value)}
                          placeholder="Optional comment..."
                          rows={2}
                          className="w-full text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500/30 resize-none"
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Submit button */}
                <button
                  onClick={handleSubmitVotes}
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-3 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {loading ? "Submitting..." : "Submit Health Check Votes"}
                </button>
              </div>
            )}

            {/* ─── RESULTS SECTION ─── */}
            {(hasVoted || (currentSession.responses && currentSession.responses.length > 0)) && currentSession.aggregated && (
              <div className="space-y-6">
                {/* Overall health score */}
                {overallScore && (
                  <div className={`rounded-xl border-2 p-6 text-center ${getOverallColor(parseFloat(overallScore))}`}>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-1 opacity-70">Overall Team Health</p>
                    <p className="text-4xl font-bold">{overallScore}</p>
                    <p className="text-sm mt-1">
                      {parseFloat(overallScore) < 2.5 ? "Needs urgent attention" :
                       parseFloat(overallScore) <= 3.5 ? "Room for improvement" :
                       "Healthy team!"}
                    </p>
                    {/* Trend placeholder */}
                    <p className="text-xs mt-2 opacity-60">
                      Trend analysis available after multiple sessions
                    </p>
                  </div>
                )}

                {/* Category results — horizontal bar chart */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-4">Health by Category</h3>
                  <div className="space-y-4">
                    {Object.entries(currentSession.aggregated).map(([catId, cat]) => {
                      const avg = cat.avg || 0;
                      const pct = (avg / 5) * 100;
                      return (
                        <div key={catId}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-700">
                              {cat.emoji} {cat.label}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-bold ${getBarTextColor(avg)}`}>
                                {avg.toFixed(1)}
                              </span>
                              <span className="text-[10px] text-gray-400">
                                ({cat.count} vote{cat.count !== 1 ? "s" : ""})
                              </span>
                            </div>
                          </div>
                          {/* Bar */}
                          <div className="w-full bg-gray-100 rounded-full h-4 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${getBarColor(avg)}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          {/* Traffic light distribution */}
                          {cat.distribution && (
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-[10px] text-green-600">
                                {cat.distribution.green || 0} green
                              </span>
                              <span className="text-[10px] text-yellow-600">
                                {cat.distribution.yellow || 0} yellow
                              </span>
                              <span className="text-[10px] text-red-600">
                                {cat.distribution.red || 0} red
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Vote again option */}
                {hasVoted && (
                  <button
                    onClick={() => { setHasVoted(false); setVotes({}); }}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    Submit another vote
                  </button>
                )}

              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
