"use client";

import { useState, useEffect, useMemo } from "react";
import { fetchPiOverview, fetchPiFollowUps, fetchProgramBoard, fetchConfig, updateConfig, fetchPiCompliance } from "../../lib/api";
import IssueHoverCard from "../../components/IssueHoverCard";
import JqlBar from "../../components/JqlBar";
import AiCoachPanel from "../../components/AiCoachPanel";
import { toast } from "../../components/Toaster";

const SEVERITY_COLORS = {
  critical: "bg-red-50 border-red-200 text-red-700",
  warning: "bg-amber-50 border-amber-200 text-amber-700",
  info: "bg-blue-50 border-blue-200 text-blue-700",
};

function ProgressBar({ value, size = "md", color }) {
  const h = size === "sm" ? "h-1.5" : "h-3";
  const barColor = color || (value >= 80 ? "bg-green-500" : value >= 50 ? "bg-blue-500" : value >= 25 ? "bg-amber-500" : "bg-red-500");
  return (
    <div className={`w-full bg-gray-100 rounded-full ${h} overflow-hidden`}>
      <div className={`${barColor} ${h} rounded-full transition-all`} style={{ width: `${Math.max(value, value > 0 ? 2 : 0)}%` }} />
    </div>
  );
}

function TeamCard({ team, onClick }) {
  const { stats } = team;
  const hasError = !!team.error;

  return (
    <div
      className={`bg-white rounded-xl border-2 p-5 cursor-pointer hover:shadow-md transition-shadow ${
        hasError ? "border-red-200 opacity-60" : "border-gray-200"
      }`}
      style={{ borderLeftColor: team.team.color, borderLeftWidth: "4px" }}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">{team.team.name}</h3>
          <span className="text-[10px] text-gray-400 font-mono">{team.team.projectKey}</span>
        </div>
        <span className="text-2xl font-bold text-gray-800">{team.progress}%</span>
      </div>

      {hasError ? (
        <p className="text-xs text-red-500">{team.error}</p>
      ) : (
        <>
          <ProgressBar value={team.progress} />

          <div className="grid grid-cols-4 gap-2 mt-3 text-center">
            <div>
              <div className="text-sm font-bold text-gray-700">{stats.total}</div>
              <div className="text-[10px] text-gray-400">Total</div>
            </div>
            <div>
              <div className="text-sm font-bold text-green-600">{stats.done}</div>
              <div className="text-[10px] text-gray-400">Done</div>
            </div>
            <div>
              <div className="text-sm font-bold text-blue-600">{stats.inProgress}</div>
              <div className="text-[10px] text-gray-400">WIP</div>
            </div>
            <div>
              <div className="text-sm font-bold text-red-600">{stats.overdue}</div>
              <div className="text-[10px] text-gray-400">Overdue</div>
            </div>
          </div>

          {team.crossTeamDeps?.length > 0 && (
            <div className="mt-3 text-[10px] text-indigo-600 bg-indigo-50 rounded px-2 py-1">
              {team.crossTeamDeps.length} cross-team dep{team.crossTeamDeps.length !== 1 ? "s" : ""}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function PiPlanningPage() {
  const [data, setData] = useState(null);
  const [followUps, setFollowUps] = useState(null);
  const [programBoard, setProgramBoard] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [filterMode, setFilterMode] = useState("pi"); // "pi" | "all" | "sprint"
  const [sprintFilter, setSprintFilter] = useState("");
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");

  // Config form state
  const [configForm, setConfigForm] = useState({ teams: [], piConfig: { enabled: false }, disabledPiChecks: [] });
  const [allPiChecks, setAllPiChecks] = useState([]);

  const loadData = async (filter) => {
    setLoading(true);
    setError(null);
    try {
      const f = filter || filterMode;
      const [piData, cfg, piCompliance] = await Promise.all([
        fetchPiOverview({ filter: f, sprint: f === "sprint" ? sprintFilter : undefined, jql: jql || undefined }),
        fetchConfig(),
        fetchPiCompliance().catch(() => null),
      ]);
      setData(piData);
      setConfig(cfg);
      setConfigForm({ teams: cfg.teams, piConfig: cfg.piConfig, disabledPiChecks: cfg.disabledPiChecks || [] });
      if (piCompliance?.allCheckIds) setAllPiChecks(piCompliance.allCheckIds);
      if (piData.filterMode) setFilterMode(piData.filterMode);
      toast.success(`PI data loaded — ${piData.teams?.length || 0} teams`);
    } catch (err) {
      setError(err.message);
      toast.error("Failed to load PI data: " + err.message);
    }
    setLoading(false);
  };

  const loadFollowUps = async () => {
    try {
      const fu = await fetchPiFollowUps();
      setFollowUps(fu);
    } catch {}
  };

  const loadProgramBoard = async () => {
    try {
      const pb = await fetchProgramBoard();
      setProgramBoard(pb);
    } catch {}
  };

  useEffect(() => { loadData(); }, [jql]);
  useEffect(() => { if (activeTab === "follow-ups") loadFollowUps(); }, [activeTab]);
  useEffect(() => { if (activeTab === "program-board") loadProgramBoard(); }, [activeTab]);

  const handleSaveConfig = async () => {
    try {
      const result = await updateConfig(configForm);
      if (result.piConfig) setConfigForm((f) => ({ ...f, piConfig: result.piConfig }));
      setShowConfig(false);
      toast.success("Configuration saved");
      loadData();
    } catch (err) {
      setError(err.message);
      toast.error("Failed to save configuration: " + err.message);
    }
  };

  const tabs = [
    { key: "program-board", label: "Program Board" },
    { key: "overview", label: "PI Overview" },
    { key: "epics", label: "Epic Board" },
    { key: "dependencies", label: "Dependencies" },
    { key: "follow-ups", label: "Follow-ups" },
    { key: "risks", label: "Risks & Warnings" },
  ];

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">PI Planning</h1>
            <div className="flex gap-2">
              <button onClick={() => setShowConfig(!showConfig)} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-md">
                {showConfig ? "Close Config" : "Configure Teams"}
              </button>
              <button onClick={loadData} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-md">
                Refresh
              </button>
            </div>
          </div>

          {/* PI Info + Filter */}
          <div className="flex items-center justify-between mb-2">
            {data?.piConfig && (
              <div className="text-xs text-gray-500">
                {data.piConfig.enabled === false ? (
                  <span className="text-amber-600 font-medium">JQL-Only Mode</span>
                ) : (
                  <>
                    <strong className="text-gray-700">{data.piConfig.name || "PI"}</strong>
                    {data.piConfig.startDate && ` | ${data.piConfig.startDate} → ${data.piConfig.endDate}`}
                    {` | ${data.piConfig.sprintCount} sprints of ${data.piConfig.sprintDuration}d`}
                  </>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400">Filter:</span>
              {[
                { key: "pi", label: "PI Window", title: "Only issues active during this PI (created, updated, or due within PI dates)" },
                { key: "all", label: "All Issues", title: "All issues in each project, no date filtering" },
                { key: "sprint", label: "Sprint", title: "Filter by specific sprint name" },
              ].map((f) => (
                <button
                  key={f.key}
                  title={f.title}
                  onClick={() => {
                    setFilterMode(f.key);
                    if (f.key !== "sprint") loadData(f.key);
                  }}
                  className={`text-[10px] px-2 py-1 rounded transition-colors ${
                    filterMode === f.key ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
              {filterMode === "sprint" && (
                <input
                  type="text"
                  placeholder="Sprint name..."
                  value={sprintFilter}
                  onChange={(e) => setSprintFilter(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadData("sprint")}
                  className="text-[10px] border border-gray-200 rounded px-2 py-1 w-32"
                />
              )}
            </div>
          </div>

          <div className="flex gap-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  activeTab === t.key ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {t.label}
              </button>
            ))}
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
        <div className="mb-4">
          <AiCoachPanel
            context="PI Planning"
            data={{ overview: data, followUps, programBoard }}
            prompts={[
              {
                label: "PI Health Analysis",
                primary: true,
                question:
                  "Analyze the PI plan across all teams. Assess: cross-team dependency risks, capacity vs commitment gaps for each team, teams that are overcommitted or undercommitted, and the overall PI feasibility. Reference specific teams and metrics.",
              },
              {
                label: "Cross-Team Dependencies",
                question:
                  "Identify all cross-team dependencies and their risks. Which dependencies are most likely to cause delays? Suggest mitigation strategies and communication plans for each high-risk dependency.",
              },
              {
                label: "PI Objectives Suggestion",
                question:
                  "Based on the planned work across all teams, suggest 3-5 measurable PI objectives. Each should be specific, achievable within the PI, and tied to business value.",
              },
              {
                label: "Feature Prioritization",
                question:
                  "Analyze the features and epics across teams. Which should be prioritized based on business value, dependencies, and risk? Suggest a WSJF (Weighted Shortest Job First) ranking.",
              },
              {
                label: "Capacity vs Commitment",
                question:
                  "For each team, compare their committed work against typical velocity/capacity. Highlight teams that are overcommitted and suggest what to descope. Highlight teams with slack and suggest what to pull in.",
              },
            ]}
          />
        </div>

        {/* ═══ TEAM CONFIGURATION PANEL ═══ */}
        {showConfig && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">PI Planning Configuration</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-xs text-gray-500">{configForm.piConfig.enabled !== false ? "PI Sprint Mode" : "JQL-Only Mode"}</span>
                <div
                  onClick={async () => {
                    const newEnabled = configForm.piConfig.enabled === false ? true : false;
                    const newPiConfig = { ...configForm.piConfig, enabled: newEnabled };
                    setConfigForm((f) => ({ ...f, piConfig: newPiConfig }));
                    try {
                      const result = await updateConfig({ piConfig: newPiConfig });
                      if (result.piConfig) setConfigForm((f) => ({ ...f, piConfig: result.piConfig }));
                      toast.success(newEnabled ? "PI Sprint Mode enabled" : "JQL-Only Mode enabled");
                      loadData();
                    } catch (err) {
                      setConfigForm((f) => ({ ...f, piConfig: { ...f.piConfig, enabled: !newEnabled } }));
                      toast.error("Failed to save mode: " + err.message);
                    }
                  }}
                  className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${configForm.piConfig.enabled !== false ? "bg-blue-600" : "bg-gray-300"}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${configForm.piConfig.enabled !== false ? "translate-x-5" : "translate-x-0.5"}`} />
                </div>
              </label>
            </div>

            {configForm.piConfig.enabled === false && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700">
                Sprint configuration is disabled. Each team will be analyzed using its custom JQL query (or default <code className="bg-amber-100 px-1 rounded">project = KEY</code>) without PI date filtering.
              </div>
            )}

            {/* PI Config */}
            <div className={`grid grid-cols-4 gap-3 transition-opacity ${configForm.piConfig.enabled === false ? "opacity-40 pointer-events-none" : ""}`}>
              <div>
                <label className="text-xs text-gray-500">PI Name</label>
                <input
                  type="text" value={configForm.piConfig.name || ""}
                  onChange={(e) => setConfigForm((f) => ({ ...f, piConfig: { ...f.piConfig, name: e.target.value } }))}
                  placeholder="PI 2026-Q1"
                  className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Start Date</label>
                <input
                  type="date" value={configForm.piConfig.startDate || ""}
                  onChange={(e) => setConfigForm((f) => ({ ...f, piConfig: { ...f.piConfig, startDate: e.target.value } }))}
                  className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">End Date</label>
                <input
                  type="date" value={configForm.piConfig.endDate || ""}
                  onChange={(e) => setConfigForm((f) => ({ ...f, piConfig: { ...f.piConfig, endDate: e.target.value } }))}
                  className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Sprint Count / Duration (days)</label>
                <div className="flex gap-2 mt-1">
                  <input
                    type="number" value={configForm.piConfig.sprintCount || 5}
                    onChange={(e) => setConfigForm((f) => ({ ...f, piConfig: { ...f.piConfig, sprintCount: parseInt(e.target.value) } }))}
                    className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5"
                  />
                  <input
                    type="number" value={configForm.piConfig.sprintDuration || 14}
                    onChange={(e) => setConfigForm((f) => ({ ...f, piConfig: { ...f.piConfig, sprintDuration: parseInt(e.target.value) } }))}
                    className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5"
                  />
                </div>
              </div>
            </div>

            {/* Teams */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-600">Teams</label>
                <button
                  onClick={() => setConfigForm((f) => ({
                    ...f,
                    teams: [...f.teams, { id: `team-${Date.now()}`, name: "", serverId: "primary", projectKey: "", boardId: null, color: "#6366F1", jql: "" }],
                  }))}
                  className="text-xs bg-blue-600 text-white px-2 py-1 rounded"
                >
                  + Add Team
                </button>
              </div>
              <div className="space-y-2">
                {configForm.teams.map((team, idx) => (
                  <div key={team.id} className="bg-gray-50 rounded-lg p-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        type="color" value={team.color || "#3B82F6"}
                        onChange={(e) => {
                          const teams = [...configForm.teams];
                          teams[idx] = { ...teams[idx], color: e.target.value };
                          setConfigForm((f) => ({ ...f, teams }));
                        }}
                        className="w-8 h-8 rounded border-0 cursor-pointer"
                      />
                      <input
                        type="text" value={team.name} placeholder="Team Name"
                        onChange={(e) => {
                          const teams = [...configForm.teams];
                          teams[idx] = { ...teams[idx], name: e.target.value };
                          setConfigForm((f) => ({ ...f, teams }));
                        }}
                        className="flex-1 text-sm bg-white border border-gray-200 rounded px-2 py-1"
                      />
                      <input
                        type="text" value={team.projectKey} placeholder="PROJECT_KEY"
                        onChange={(e) => {
                          const teams = [...configForm.teams];
                          teams[idx] = { ...teams[idx], projectKey: e.target.value.toUpperCase() };
                          setConfigForm((f) => ({ ...f, teams }));
                        }}
                        className="w-32 text-sm bg-white border border-gray-200 rounded px-2 py-1 font-mono"
                      />
                      <select
                        value={team.serverId}
                        onChange={(e) => {
                          const teams = [...configForm.teams];
                          teams[idx] = { ...teams[idx], serverId: e.target.value };
                          setConfigForm((f) => ({ ...f, teams }));
                        }}
                        className="text-xs bg-white border border-gray-200 rounded px-2 py-1"
                      >
                        {(config?.servers || []).map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => setConfigForm((f) => ({ ...f, teams: f.teams.filter((_, i) => i !== idx) }))}
                        className="text-xs text-red-500 hover:text-red-700 px-2"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="flex items-center gap-2 ml-10">
                      <label className="text-[10px] text-gray-400 shrink-0">JQL:</label>
                      <input
                        type="text" value={team.jql || ""} placeholder={`project = ${team.projectKey || "KEY"} ORDER BY status ASC, updated DESC`}
                        onChange={(e) => {
                          const teams = [...configForm.teams];
                          teams[idx] = { ...teams[idx], jql: e.target.value };
                          setConfigForm((f) => ({ ...f, teams }));
                        }}
                        className="flex-1 text-[11px] bg-white border border-gray-200 rounded px-2 py-1 font-mono text-gray-600"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* PI Compliance Checks Toggle */}
            {allPiChecks.length > 0 && (
              <div>
                <label className="text-xs font-medium text-gray-600">PI Compliance Checks</label>
                <p className="text-[10px] text-gray-400 mb-2">Disable checks to exclude them from the PI compliance score.</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {allPiChecks.map((check) => {
                    const disabled = (configForm.disabledPiChecks || []).includes(check.id);
                    return (
                      <label key={check.id} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        disabled ? "bg-gray-50 border-gray-200 text-gray-400" : "bg-green-50 border-green-200 text-gray-700"
                      }`}>
                        <input
                          type="checkbox"
                          checked={!disabled}
                          onChange={() => {
                            setConfigForm((f) => ({
                              ...f,
                              disabledPiChecks: disabled
                                ? (f.disabledPiChecks || []).filter((id) => id !== check.id)
                                : [...(f.disabledPiChecks || []), check.id],
                            }));
                          }}
                          className="rounded border-gray-300"
                        />
                        {check.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={handleSaveConfig} className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg">
                Save Configuration
              </button>
              <button onClick={() => setShowConfig(false)} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2 rounded-lg">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ═══ PROGRAM BOARD — always available ═══ */}
        {activeTab === "program-board" && (
          <div className="space-y-6">
            {!programBoard ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin h-8 w-8 border-4 border-blue-200 border-t-blue-600 rounded-full" />
              </div>
            ) : !programBoard.configured ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
                <h3 className="text-sm font-semibold text-amber-800 mb-2">Program Board Not Configured</h3>
                <p className="text-xs text-amber-600 mb-4">
                  Set the <code className="bg-amber-100 px-1.5 py-0.5 rounded">PROGRAM_PROJECT</code> environment variable
                  to your parent Jira project key (e.g., PROG), or configure it in Settings.
                </p>
                <p className="text-xs text-amber-500">
                  The Program Board holds high-level Features that flow down to team boards as Stories and Tasks.
                </p>
              </div>
            ) : (
              <>
                {/* Agile Coach: Program Board Best Practices */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-slate-800 mb-3">Program Board — SAFe Best Practices</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-600">
                    <div className="bg-white/70 rounded-lg p-3">
                      <strong>Feature → Team Traceability:</strong> Every program feature should link to at least one team story/task.
                      Orphaned features indicate teams may not be aware of requirements.
                    </div>
                    <div className="bg-white/70 rounded-lg p-3">
                      <strong>Bidirectional Flow:</strong> Requirements flow down (Feature → Stories).
                      Progress and risks flow up (Team → Program). Keep links updated.
                    </div>
                    <div className="bg-white/70 rounded-lg p-3">
                      <strong>Feature Sizing:</strong> Each feature should be completable within one PI.
                      If not, split into smaller features across PIs.
                    </div>
                  </div>
                </div>

                {/* Warnings */}
                {programBoard.warnings?.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Agile Coach — Program Warnings</h3>
                    {programBoard.warnings.map((w, i) => (
                      <div key={i} className={`px-4 py-3 rounded-xl border ${SEVERITY_COLORS[w.severity]}`}>
                        <p className="text-sm font-medium">{w.title}</p>
                        <p className="text-xs mt-1 opacity-80">{w.detail}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* KPI Stats */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {[
                    { label: "Features", value: programBoard.stats.totalFeatures, color: "text-gray-800" },
                    { label: "Done", value: programBoard.stats.featuresDone, color: "text-green-600" },
                    { label: "With Teams", value: programBoard.stats.featuresWithTeams, color: "text-blue-600" },
                    { label: "Orphaned", value: programBoard.stats.featuresOrphaned, color: programBoard.stats.featuresOrphaned > 0 ? "text-red-600" : "text-gray-400" },
                    { label: "Avg Progress", value: `${programBoard.stats.avgProgress}%`, color: "text-indigo-600" },
                  ].map((kpi) => (
                    <div key={kpi.label} className="bg-white border border-gray-200 rounded-xl p-4 text-center">
                      <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
                      <div className="text-[10px] text-gray-400 mt-1">{kpi.label}</div>
                    </div>
                  ))}
                </div>

                {/* Team Coverage */}
                {programBoard.teamCoverage?.length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-gray-800 mb-3">Team Coverage — Who&apos;s Implementing What</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {programBoard.teamCoverage.map((tc) => (
                        <div key={tc.teamId} className="border border-gray-100 rounded-lg p-3" style={{ borderLeftColor: tc.teamColor, borderLeftWidth: "3px" }}>
                          <div className="text-sm font-medium text-gray-800">{tc.teamName}</div>
                          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                            <span>{tc.featureCount} feature{tc.featureCount !== 1 ? "s" : ""}</span>
                            <span>{tc.issueCount} issue{tc.issueCount !== 1 ? "s" : ""}</span>
                            <span className="text-green-600">{tc.doneCount} done</span>
                          </div>
                          <div className="mt-2">
                            <ProgressBar value={tc.issueCount > 0 ? Math.round((tc.doneCount / tc.issueCount) * 100) : 0} size="sm" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Features List */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-gray-800">Program Features — Requirement Traceability</h3>
                  {programBoard.features.map((feature) => (
                    <div key={feature.key} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      {/* Feature header */}
                      <div className="px-5 py-4 border-b border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <a href={`${programBoard.serverUrl}/browse/${feature.key}`} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded hover:underline">{feature.key}</a>
                            <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                              feature.statusCategory === "done" ? "bg-green-100 text-green-700"
                                : feature.statusCategory === "indeterminate" ? "bg-blue-100 text-blue-700"
                                : "bg-gray-100 text-gray-600"
                            }`}>{feature.status}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                              feature.priority === "Highest" ? "bg-red-100 text-red-700"
                                : feature.priority === "High" ? "bg-orange-100 text-orange-700"
                                : "bg-gray-100 text-gray-500"
                            }`}>{feature.priority}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-500">
                              {feature.implementationStats.done}/{feature.implementationStats.total} team issues done
                            </span>
                            <span className="text-sm font-bold text-gray-700">{feature.overallProgress}%</span>
                          </div>
                        </div>
                        <h4 className="text-sm font-semibold text-gray-900">{feature.summary}</h4>
                        {feature.description && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{feature.description}</p>
                        )}
                        <div className="mt-3">
                          <ProgressBar value={feature.overallProgress} />
                        </div>

                        {/* Feature-level warnings */}
                        {feature.warnings?.length > 0 && (
                          <div className="mt-3 space-y-1">
                            {feature.warnings.map((w, i) => (
                              <div key={i} className={`text-[10px] px-3 py-1.5 rounded border ${SEVERITY_COLORS[w.severity]}`}>
                                {w.message}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Team implementations */}
                      {feature.teamImplementations.length > 0 ? (
                        <div className="px-5 py-3 bg-gray-50">
                          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Team Implementations</div>
                          <div className="space-y-3">
                            {feature.teamImplementations.map((impl) => (
                              <div key={impl.teamId}>
                                <div className="flex items-center gap-2 mb-1.5">
                                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: impl.teamColor }} />
                                  <span className="text-xs font-medium text-gray-700">{impl.teamName}</span>
                                  <span className="text-[10px] text-gray-400 font-mono">{impl.projectKey}</span>
                                  <span className="text-[10px] text-gray-400 ml-auto">
                                    {impl.issues.filter((i) => i.statusCategory === "done").length}/{impl.issues.length} done
                                  </span>
                                </div>
                                <div className="space-y-1 ml-5">
                                  {impl.issues.map((issue, idx) => (
                                    <div key={idx} className="flex items-center gap-2 text-xs">
                                      <IssueHoverCard issue={issue} jiraBaseUrl={programBoard.serverUrl}>
                                        <a href={`${programBoard.serverUrl}/browse/${issue.key}`} target="_blank" rel="noopener noreferrer" className="font-mono text-blue-600 shrink-0 hover:underline">{issue.key}</a>
                                      </IssueHoverCard>
                                      <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                                        issue.statusCategory === "done" ? "bg-green-500"
                                          : issue.statusCategory === "indeterminate" ? "bg-blue-500"
                                          : "bg-gray-300"
                                      }`} />
                                      <span className="text-gray-600 truncate">{issue.summary}</span>
                                      <span className="text-[10px] text-gray-400 shrink-0">{issue.status}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="px-5 py-3 bg-amber-50 text-xs text-amber-600">
                          No team implementations linked — teams may not be aware of this feature.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {!loading && data && (
          <>
            {/* ═══ PI OVERVIEW ═══ */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                {/* Agile Coach Warnings */}
                {data.piWarnings?.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Agile Coach — PI Health</h3>
                    {data.piWarnings.map((w, i) => (
                      <div key={i} className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${SEVERITY_COLORS[w.severity]}`}>
                        <span className="text-xs font-bold uppercase shrink-0">
                          {w.severity === "critical" ? "\u26D4" : "\u26A0\uFE0F"} {w.category}
                        </span>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{w.title}</p>
                          <p className="text-xs mt-1 opacity-80">{w.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* PI KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-center">
                    <div className="text-2xl font-bold text-gray-800">{data.piStats.totalTeams}</div>
                    <div className="text-xs text-gray-500">Teams</div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-center">
                    <div className="text-2xl font-bold text-gray-800">{data.piStats.totalIssues}</div>
                    <div className="text-xs text-gray-500">Total Tickets</div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-center">
                    <div className="text-2xl font-bold text-green-600">{data.piStats.progress}%</div>
                    <div className="text-xs text-gray-500">PI Progress</div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-center">
                    <div className="text-2xl font-bold text-green-600">{data.piStats.totalDone}</div>
                    <div className="text-xs text-gray-500">Done</div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-center">
                    <div className="text-2xl font-bold text-indigo-600">{data.piStats.totalCrossTeamDeps}</div>
                    <div className="text-xs text-gray-500">Cross-Team Deps</div>
                  </div>
                </div>

                {/* PI Progress */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">PI Progress</h3>
                  <ProgressBar value={data.piStats.progress} />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>{data.piStats.totalDone} / {data.piStats.totalIssues} done</span>
                    <span>{data.piStats.progress}%</span>
                  </div>
                </div>

                {/* Team Cards */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">Teams</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {data.teams.map((team) => (
                      <TeamCard key={team.team.id} team={team} onClick={() => setSelectedTeam(team)} />
                    ))}
                  </div>
                </div>

                {/* Per-team epic progress comparison */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-4">Epic Progress by Team</h3>
                  <div className="space-y-3">
                    {data.teams.flatMap((t) =>
                      t.epics.map((epic) => (
                        <div key={`${t.team.id}-${epic.key}`} className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.team.color }} />
                          <a href={`${t.team.serverUrl}/browse/${epic.key}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-gray-400 w-16 shrink-0 font-mono hover:text-blue-600 hover:underline">{epic.key}</a>
                          <span className="text-xs text-gray-700 w-48 truncate">{epic.summary}</span>
                          <div className="flex-1">
                            <ProgressBar value={epic.progress} size="sm" />
                          </div>
                          <span className="text-[10px] text-gray-500 w-20 text-right">
                            {epic.childDone}/{epic.childCount} ({epic.progress}%)
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ═══ EPIC BOARD (all teams' epics side by side) ═══ */}
            {activeTab === "epics" && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-gray-800">Epic Board — All Teams</h2>
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-xs text-indigo-800">
                  <strong>Best Practice:</strong> Epics should be sized to complete within a single PI. If an epic spans multiple PIs, consider splitting it.
                  Each team should own 3-7 epics per PI for manageable scope.
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                  {data.teams.map((t) => (
                    <div key={t.team.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2" style={{ borderLeftColor: t.team.color, borderLeftWidth: "3px" }}>
                        <h4 className="text-sm font-semibold text-gray-800">{t.team.name}</h4>
                        <span className="text-[10px] text-gray-400 font-mono">{t.team.projectKey}</span>
                        <span className="text-[10px] text-gray-500 ml-auto">{t.epics.length} epics</span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {t.epics.map((epic) => {
                          const progressColor = epic.progress >= 80 ? "text-green-600"
                            : epic.progress >= 40 ? "text-blue-600"
                            : epic.progress > 0 ? "text-amber-600" : "text-gray-400";
                          return (
                            <div key={epic.key} className="px-4 py-3">
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                  <a href={`${t.team.serverUrl}/browse/${epic.key}`} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-blue-600 hover:underline">{epic.key}</a>
                                  <span className="text-xs text-gray-800 truncate max-w-[200px]">{epic.summary}</span>
                                </div>
                                <span className={`text-xs font-bold ${progressColor}`}>{epic.progress}%</span>
                              </div>
                              <ProgressBar value={epic.progress} size="sm" />
                              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-400">
                                <span>{epic.childDone}/{epic.childCount} done</span>
                                {epic.dueDate && <span>Due: {epic.dueDate}</span>}
                                {epic.assigneeName && <span>{epic.assigneeName}</span>}
                              </div>
                            </div>
                          );
                        })}
                        {t.epics.length === 0 && (
                          <div className="px-4 py-6 text-center text-xs text-gray-400">No epics found</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ═══ DEPENDENCIES ═══ */}
            {activeTab === "dependencies" && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-gray-800">Cross-Team Dependencies</h2>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                  <strong>Agile Coach:</strong> Cross-team dependencies are the #1 cause of PI delivery failure.
                  Track them actively, assign owners, and schedule sync points.
                  Best practice: aim for &lt;5 cross-team dependencies per team per PI.
                </div>

                {data.crossTeamDeps?.length > 0 ? (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
                      <span className="w-24">From Team</span>
                      <span className="w-20">From Key</span>
                      <span className="flex-1">Summary</span>
                      <span className="w-20 text-center">Link Type</span>
                      <span className="w-20">To Key</span>
                      <span className="w-20">To Status</span>
                    </div>
                    {data.crossTeamDeps.map((dep, i) => {
                      const fromTeam = data.teams.find((t) => t.team.id === dep.fromTeam);
                      return (
                        <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/50 border-b border-gray-50">
                          <div className="w-24 flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: fromTeam?.team.color || "#888" }} />
                            <span className="text-xs text-gray-600 truncate">{fromTeam?.team.name || dep.fromTeam}</span>
                          </div>
                          <a href={`${fromTeam?.team.serverUrl}/browse/${dep.fromKey}`} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-blue-600 w-20 hover:underline">{dep.fromKey}</a>
                          <span className="text-xs text-gray-800 flex-1 truncate">{dep.fromSummary}</span>
                          <span className="text-[10px] text-gray-400 w-20 text-center">{dep.linkType} ({dep.direction})</span>
                          <a href={`${fromTeam?.team.serverUrl}/browse/${dep.toKey}`} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-indigo-600 w-20 hover:underline">{dep.toKey}</a>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 w-20 text-center truncate">
                            {dep.toStatus || "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
                    <p className="text-sm text-green-700">No cross-team dependencies detected</p>
                    <p className="text-xs text-green-500 mt-1">
                      Make sure teams use Jira issue links to track dependencies between projects
                    </p>
                  </div>
                )}

                {/* Bidirectional deps warning */}
                {data.bidirectionalDeps?.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-red-800 mb-2">
                      Bidirectional Dependencies ({data.bidirectionalDeps.length})
                    </h3>
                    <p className="text-xs text-red-600 mb-3">
                      These ticket pairs depend on each other in both directions — a potential deadlock risk.
                    </p>
                    <div className="space-y-1">
                      {data.bidirectionalDeps.map((pair, i) => (
                        <div key={i} className="text-xs font-mono text-red-700">
                          <span className="font-mono">{pair.a}</span> ↔ <span className="font-mono">{pair.b}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ═══ FOLLOW-UPS ═══ */}
            {activeTab === "follow-ups" && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-gray-800">
                  Cross-Team Follow-ups
                  {followUps && <span className="ml-2 text-sm font-normal text-gray-500">{followUps.total} tickets with external links</span>}
                </h2>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                  <strong>Best Practice:</strong> Review follow-ups in every Scrum-of-Scrums.
                  Every cross-team ticket needs: (1) an owner on each side, (2) a clear handoff date, (3) a definition of done both teams agree on.
                </div>

                {followUps?.followUps?.length > 0 ? (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
                      <span className="w-20">Team</span>
                      <span className="w-20">Key</span>
                      <span className="flex-1">Summary</span>
                      <span className="w-20 text-center">Status</span>
                      <span className="w-20">Priority</span>
                      <span className="w-32">Linked To</span>
                    </div>
                    {followUps.followUps.map((fu, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/50 border-b border-gray-50">
                        <span className="text-xs text-gray-600 w-20 truncate">{fu.teamName}</span>
                        <IssueHoverCard issue={fu} jiraBaseUrl={fu.serverUrl}>
                          <a
                            href={`${fu.serverUrl}/browse/${fu.key}`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-xs font-mono text-blue-600 hover:underline w-20"
                          >
                            {fu.key}
                          </a>
                        </IssueHoverCard>
                        <span className="text-xs text-gray-800 flex-1 truncate">{fu.summary}</span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full w-20 text-center truncate ${
                          fu.statusCategory === "done" ? "bg-green-100 text-green-700"
                            : fu.statusCategory === "indeterminate" ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-600"
                        }`}>
                          {fu.status}
                        </span>
                        <span className="text-xs text-gray-500 w-20">{fu.priority}</span>
                        <div className="w-32 flex flex-wrap gap-1">
                          {fu.externalLinks.slice(0, 2).map((link, j) => (
                            <a key={j} href={`${fu.serverUrl}/browse/${link.key}`} target="_blank" rel="noopener noreferrer" className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-mono hover:underline">
                              {link.key}
                            </a>
                          ))}
                          {fu.externalLinks.length > 2 && (
                            <span className="text-[10px] text-gray-400">+{fu.externalLinks.length - 2}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : followUps ? (
                  <div className="text-center py-8 text-gray-400 text-sm">No cross-team follow-ups found</div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin h-6 w-6 border-4 border-blue-200 border-t-blue-600 rounded-full" />
                  </div>
                )}
              </div>
            )}

            {/* ═══ RISKS & WARNINGS ═══ */}
            {activeTab === "risks" && (
              <div className="space-y-6">
                <h2 className="text-base font-semibold text-gray-800">PI Risk Register & Agile Coach Warnings</h2>

                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-indigo-800 mb-3">SAFe PI Planning Best Practices</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-indigo-700">
                    <div className="bg-white/70 rounded-lg p-3">
                      <strong>ROAM Risk Management:</strong> Classify each risk as Resolved, Owned, Accepted, or Mitigated.
                      Review risks at every PI sync.
                    </div>
                    <div className="bg-white/70 rounded-lg p-3">
                      <strong>Dependency Boards:</strong> Make dependencies visible. Use string diagrams in PI planning.
                      If two teams can&apos;t resolve a dependency, escalate to the RTE.
                    </div>
                    <div className="bg-white/70 rounded-lg p-3">
                      <strong>Capacity Planning:</strong> Each team should plan to 80% capacity. The remaining 20% is buffer for unplanned work and innovation.
                    </div>
                    <div className="bg-white/70 rounded-lg p-3">
                      <strong>Program Board:</strong> Visualize features, milestones, and dependencies across all teams.
                      Update it continuously, not just during PI planning events.
                    </div>
                  </div>
                </div>

                {/* All warnings */}
                {data.piWarnings?.length > 0 ? (
                  <div className="space-y-2">
                    {data.piWarnings.map((w, i) => (
                      <div key={i} className={`px-5 py-4 rounded-xl border ${SEVERITY_COLORS[w.severity]}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold uppercase">{w.severity}</span>
                          <span className="text-xs opacity-60">({w.category})</span>
                        </div>
                        <p className="text-sm font-medium">{w.title}</p>
                        <p className="text-xs mt-1 opacity-80">{w.detail}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
                    <p className="text-sm text-green-700 font-medium">No PI-level risks detected</p>
                    <p className="text-xs text-green-500 mt-1">All teams are within healthy parameters</p>
                  </div>
                )}

                {/* Per-team risk summary */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">Team Risk Summary</h3>
                  <div className="space-y-3">
                    {data.teams.map((t) => {
                      const riskLevel = t.stats.overdue > 3 ? "high"
                        : t.stats.overdue > 0 || t.stats.blocked > 0 ? "medium" : "low";
                      return (
                        <div key={t.team.id} className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.team.color }} />
                          <span className="text-sm text-gray-700 w-32">{t.team.name}</span>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                            riskLevel === "high" ? "bg-red-100 text-red-700"
                              : riskLevel === "medium" ? "bg-amber-100 text-amber-700"
                              : "bg-green-100 text-green-700"
                          }`}>
                            {riskLevel} risk
                          </span>
                          <span className="text-xs text-gray-500 flex-1">
                            {t.stats.overdue > 0 ? `${t.stats.overdue} overdue` : "No overdue"}
                            {t.stats.blocked > 0 ? ` | ${t.stats.blocked} blocked` : ""}
                            {` | ${t.crossTeamDeps?.length || 0} deps`}
                          </span>
                          <span className="text-xs font-medium">{t.progress}% done</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Team detail modal */}
        {selectedTeam && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedTeam(null)}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-[800px] w-full max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: selectedTeam.team.color }} />
                  <h3 className="text-lg font-semibold text-gray-900">{selectedTeam.team.name}</h3>
                  <span className="text-xs text-gray-400 font-mono">{selectedTeam.team.projectKey}</span>
                </div>
                <button onClick={() => setSelectedTeam(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
              </div>
              <div className="p-6 space-y-4">
                {/* Team stats */}
                <div className="grid grid-cols-5 gap-3 text-center">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xl font-bold">{selectedTeam.stats.total}</div>
                    <div className="text-[10px] text-gray-500">Total</div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3">
                    <div className="text-xl font-bold text-green-600">{selectedTeam.stats.done}</div>
                    <div className="text-[10px] text-gray-500">Done</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3">
                    <div className="text-xl font-bold text-blue-600">{selectedTeam.stats.inProgress}</div>
                    <div className="text-[10px] text-gray-500">In Progress</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xl font-bold">{selectedTeam.stats.todo}</div>
                    <div className="text-[10px] text-gray-500">To Do</div>
                  </div>
                  <div className="bg-red-50 rounded-lg p-3">
                    <div className="text-xl font-bold text-red-600">{selectedTeam.stats.overdue}</div>
                    <div className="text-[10px] text-gray-500">Overdue</div>
                  </div>
                </div>

                {/* Epics */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-800 mb-2">Epics</h4>
                  {selectedTeam.epics.map((epic) => (
                    <div key={epic.key} className="flex items-center gap-3 py-2 border-b border-gray-50">
                      <IssueHoverCard issue={epic} jiraBaseUrl={selectedTeam.team.serverUrl}>
                        <a href={`${selectedTeam.team.serverUrl}/browse/${epic.key}`} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-blue-600 w-20 hover:underline">{epic.key}</a>
                      </IssueHoverCard>
                      <span className="text-xs text-gray-700 flex-1 truncate">{epic.summary}</span>
                      <ProgressBar value={epic.progress} size="sm" />
                      <span className="text-xs text-gray-500 w-16 text-right">{epic.progress}%</span>
                    </div>
                  ))}
                </div>

                {/* Cross-team deps */}
                {selectedTeam.crossTeamDeps?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-800 mb-2">Cross-Team Dependencies</h4>
                    {selectedTeam.crossTeamDeps.map((dep, i) => (
                      <div key={i} className="flex items-center gap-2 py-1.5 text-xs">
                        <a href={`${selectedTeam.team.serverUrl}/browse/${dep.fromKey}`} target="_blank" rel="noopener noreferrer" className="font-mono text-blue-600 hover:underline">{dep.fromKey}</a>
                        <span className="text-gray-400">{dep.direction === "inward" ? "←" : "→"}</span>
                        <a href={`${selectedTeam.team.serverUrl}/browse/${dep.toKey}`} target="_blank" rel="noopener noreferrer" className="font-mono text-indigo-600 hover:underline">{dep.toKey}</a>
                        <span className="text-gray-500 truncate">{dep.toSummary}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
