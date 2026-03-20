"use client";

import { useState, useEffect } from "react";
import { fetchSettings, updateSettings, fetchConfig, updateConfig, fetchPiCompliance, testConnection, importConfig } from "../../lib/api";
import { toast } from "../../components/Toaster";

const EXAMPLE_TEMPLATES = [
  {
    label: "Auto-detect (default)",
    value: "",
    desc: "Uses 'Epic Link' or 'parent' based on Jira version",
  },
  {
    label: "Parent field (Jira 10+)",
    value: 'parent = {EPIC_KEY} ORDER BY status ASC, priority DESC',
    desc: "Uses the built-in parent hierarchy",
  },
  {
    label: "Epic Link (classic)",
    value: '"Epic Link" = {EPIC_KEY} ORDER BY status ASC, priority DESC',
    desc: "Classic Jira Server/Data Center with Software",
  },
  {
    label: "Label-based",
    value: 'labels = "{EPIC_KEY}" ORDER BY status ASC, priority DESC',
    desc: "Find issues labeled with the epic key",
  },
  {
    label: "Component-based",
    value: 'component = "{EPIC_KEY}" ORDER BY status ASC, priority DESC',
    desc: "Find issues in a component named after the epic",
  },
  {
    label: "Custom field",
    value: 'cf[10014] = {EPIC_KEY} ORDER BY status ASC, priority DESC',
    desc: "Use a specific custom field ID for epic linking",
  },
];

const DEFAULT_MISSING_INFO = `A ticket is considered to have missing information if ANY of the following are true:
- No description or description is less than 30 characters
- No acceptance criteria (description does not contain "acceptance criteria", "AC:", "given/when/then", or a checklist)
- No due date set
- No assignee
- No story points or time estimate`;

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [template, setTemplate] = useState("");
  const [missingInfoCriteria, setMissingInfoCriteria] = useState("");
  const [promptSettings, setPromptSettings] = useState({
    maxTickets: 100,
    maxPromptChars: 40000,
    includeDescriptions: true,
    includeComments: true,
    includeEstimates: true,
    includeDoneTickets: false,
    wipLimitPerPerson: 3,
    wipLimitBoard: 0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  // Multi-server / team config
  const [piConfig, setPiConfig] = useState({ name: "", startDate: "", endDate: "", sprintCount: 5, sprintDuration: 14, enabled: false });
  const [teams, setTeams] = useState([]);
  const [servers, setServers] = useState([]);
  const [configSource, setConfigSource] = useState("");
  const [defaultTeamId, setDefaultTeamId] = useState("");
  const [programBoard, setProgramBoard] = useState({ projectKey: "", serverId: "primary" });
  const [disabledPiChecks, setDisabledPiChecks] = useState([]);
  const [allPiChecks, setAllPiChecks] = useState([]);
  const [complianceResult, setComplianceResult] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [configJsonText, setConfigJsonText] = useState("");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    Promise.all([fetchSettings(), fetchConfig(), fetchPiCompliance().catch(() => null)])
      .then(([s, cfg, piCompliance]) => {
        setSettings(s);
        setTemplate(s.epicChildrenJqlTemplate || "");
        setMissingInfoCriteria(s.missingInfoCriteria || DEFAULT_MISSING_INFO);
        if (s.promptSettings) setPromptSettings((prev) => ({ ...prev, ...s.promptSettings }));
        if (cfg.piConfig) setPiConfig(cfg.piConfig);
        if (cfg.teams) setTeams(cfg.teams);
        if (cfg.servers) setServers(cfg.servers.map((s, i) => ({ ...s, _key: `srv-${i}-${Date.now()}` })));
        if (cfg.configSource) setConfigSource(cfg.configSource);
        if (cfg.defaultTeamId !== undefined) setDefaultTeamId(cfg.defaultTeamId);
        if (cfg.programBoard) setProgramBoard(cfg.programBoard);
        if (cfg.disabledPiChecks) setDisabledPiChecks(cfg.disabledPiChecks);
        if (piCompliance?.allCheckIds) setAllPiChecks(piCompliance.allCheckIds);
        if (piCompliance) setComplianceResult(piCompliance);
      })
      .catch((err) => { setError(err.message); toast.error("Failed to load settings"); })
      .finally(() => setLoading(false));
  }, []);

  const updatePromptField = (key, value) => {
    setPromptSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      // Build server payloads: only send credentials if user typed new ones
      const serverPayloads = servers.map((s) => ({
        id: s.id, name: s.name, url: s.url, browserUrl: s.browserUrl || "",
        projects: s.projects || [],
        ...(s._username ? { username: s._username } : {}),
        ...(s._token ? { token: s._token } : {}),
      }));
      const [result, cfgResult] = await Promise.all([
        updateSettings({ epicChildrenJqlTemplate: template, missingInfoCriteria, promptSettings }),
        updateConfig({ teams, piConfig, servers: serverPayloads, programBoard, defaultTeamId, disabledPiChecks }),
      ]);
      setSettings((prev) => ({ ...prev, ...result }));
      if (cfgResult.servers) setServers(cfgResult.servers);
      if (cfgResult.piConfig) setPiConfig(cfgResult.piConfig);
      if (cfgResult.configSource) setConfigSource(cfgResult.configSource);
      setSaved(true);
      toast.success("Settings saved successfully");
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.message);
      toast.error("Failed to save settings: " + err.message);
    }
    setSaving(false);
  };

  const testJql = template
    ? template.replace(/\{EPIC_KEY\}/g, "PROJ-123")
    : "(auto-detected based on Jira version)";

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 py-3">
          <h1 className="text-lg font-bold text-gray-900">Settings</h1>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-4 py-8 space-y-8">
        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">Settings</h2>
          <p className="text-sm text-gray-500">Configure how the dashboard connects to your Jira instance</p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-blue-200 border-t-blue-600 rounded-full" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            <strong>Error:</strong> {error}
          </div>
        )}

        {!loading && settings && (
          <>
            {/* Detection Status */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Jira Detection Status</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Epic Link JQL:</span>{" "}
                  <span className={settings.hasEpicLinkJql ? "text-green-600 font-medium" : "text-red-500 font-medium"}>
                    {settings.hasEpicLinkJql ? "Supported" : "Not Available"}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Epic Fields:</span>{" "}
                  <span className="font-mono text-xs text-gray-700">
                    {settings.epicLinkFields?.join(", ") || "none"}
                  </span>
                </div>
              </div>
            </div>

            {/* Epic Children JQL Template */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                Epic Children JQL Template
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                Define how to find issues belonging to an epic. Use <code className="bg-gray-100 px-1 rounded">{"{EPIC_KEY}"}</code> as
                a placeholder for the epic key (e.g. PROJ-42). Leave empty for auto-detection.
              </p>

              {/* Quick templates */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {EXAMPLE_TEMPLATES.map((ex) => (
                  <button
                    key={ex.label}
                    onClick={() => setTemplate(ex.value)}
                    className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                      template === ex.value
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                    }`}
                    title={ex.desc}
                  >
                    {ex.label}
                  </button>
                ))}
              </div>

              {/* Template input */}
              <textarea
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                placeholder='e.g. "Epic Link" = {EPIC_KEY} ORDER BY status ASC'
                rows={3}
                className="w-full text-sm font-mono bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 resize-none"
              />

              {/* Preview */}
              <div className="mt-3 bg-gray-50 rounded-lg p-3 border border-gray-100">
                <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                  Preview (for PROJ-123):
                </span>
                <p className="text-xs font-mono text-gray-600 mt-1">{testJql}</p>
              </div>

              {/* Save */}
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                {saved && (
                  <span className="text-sm text-green-600 font-medium">Saved!</span>
                )}
              </div>
            </div>

            {/* Missing Info Criteria */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                Missing Info Audit Criteria
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                Define what makes a ticket &quot;incomplete&quot; for the Analyze and Architecture pages.
                This prompt is included in AI analysis to flag tickets with missing information.
                Edit to match your team&apos;s definition of done.
              </p>

              {/* Quick presets */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                <button
                  onClick={() => setMissingInfoCriteria(DEFAULT_MISSING_INFO)}
                  className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                    missingInfoCriteria === DEFAULT_MISSING_INFO
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                  }`}
                >
                  Default (description + AC + due date)
                </button>
                <button
                  onClick={() => setMissingInfoCriteria(`A ticket is considered to have missing information if ANY of the following are true:
- No description or description is less than 30 characters
- No due date set
- No assignee`)}
                  className="text-xs px-2.5 py-1.5 rounded-md border bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                >
                  Minimal (description + due date + assignee)
                </button>
                <button
                  onClick={() => setMissingInfoCriteria(`A ticket is considered to have missing information if ANY of the following are true:
- No description or description is less than 50 characters
- No acceptance criteria (description does not contain "acceptance criteria", "AC:", "given/when/then", or a checklist/bullet points)
- No due date set
- No assignee
- No story points or time estimate
- No labels or components assigned
- No priority explicitly set (still on default "Medium")
- Epic/Story type tickets have no linked child tasks`)}
                  className="text-xs px-2.5 py-1.5 rounded-md border bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                >
                  Strict (all fields)
                </button>
              </div>

              <textarea
                value={missingInfoCriteria}
                onChange={(e) => setMissingInfoCriteria(e.target.value)}
                rows={8}
                className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 resize-y"
              />
              <p className="text-[10px] text-gray-400 mt-2">
                This criteria is embedded into the AI prompts on the Analyze and Architecture pages.
                Changes are saved together with the other settings.
              </p>
            </div>

            {/* Prompt Control Settings */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                Prompt Control
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                Control prompt size and cost for the Analyze and Architecture pages.
                Limits prevent sending too many tokens to your AI provider.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-600 font-medium">Max tickets in prompt</label>
                  <input
                    type="number"
                    min={10}
                    max={500}
                    value={promptSettings.maxTickets}
                    onChange={(e) => updatePromptField("maxTickets", parseInt(e.target.value) || 100)}
                    className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Prioritizes flagged, in-progress, and orphan tickets when trimming</p>
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-medium">Max prompt size (chars)</label>
                  <input
                    type="number"
                    min={5000}
                    max={200000}
                    step={5000}
                    value={promptSettings.maxPromptChars}
                    onChange={(e) => updatePromptField("maxPromptChars", parseInt(e.target.value) || 40000)}
                    className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">~4 chars per token. 40K chars ≈ 10K tokens</p>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <label className="text-xs text-gray-600 font-medium block">Fields to include in prompts</label>
                {[
                  { key: "includeDescriptions", label: "Descriptions", desc: "Ticket descriptions (biggest size impact)" },
                  { key: "includeComments", label: "Last comments", desc: "Most recent comment per ticket" },
                  { key: "includeEstimates", label: "Time estimates", desc: "Original estimate, time spent, remaining" },
                  { key: "includeDoneTickets", label: "Done tickets", desc: "Include completed tickets (off = smaller prompt)" },
                ].map((field) => (
                  <label key={field.key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={promptSettings[field.key]}
                      onChange={(e) => updatePromptField(field.key, e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-xs text-gray-700">{field.label}</span>
                    <span className="text-[10px] text-gray-400">— {field.desc}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* WIP Limits */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                WIP Limits
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                Work-in-progress limits for the Analytics dashboard alerts.
                Exceeding these triggers warnings in the team workload view.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-600 font-medium">WIP limit per person</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={promptSettings.wipLimitPerPerson}
                    onChange={(e) => updatePromptField("wipLimitPerPerson", parseInt(e.target.value) || 3)}
                    className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Recommended: 2-3 for most teams</p>
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-medium">Board WIP limit (0 = auto)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={promptSettings.wipLimitBoard}
                    onChange={(e) => updatePromptField("wipLimitBoard", parseInt(e.target.value) || 0)}
                    className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">0 = team_size x 2. Set manually to override.</p>
                </div>
              </div>
            </div>

            {/* Config persistence status */}
            {configSource && (
              <div className={`rounded-lg border px-4 py-2.5 text-xs flex items-center justify-between ${
                configSource === "file" ? "bg-green-50 border-green-200 text-green-700" : "bg-amber-50 border-amber-200 text-amber-700"
              }`}>
                <span>
                  Config loaded from: <strong>{configSource}</strong>
                  {configSource !== "file" && " — Changes will be saved to a persistent config file on next Save."}
                </span>
              </div>
            )}

            {/* Jira Servers */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-gray-800">Jira Servers</h3>
                <button
                  onClick={() => setServers((s) => [...s, { id: `server-${Date.now()}`, name: "", url: "", browserUrl: "", projects: [], hasCredentials: false, _username: "", _token: "", _isNew: true, _showAdvanced: false, _key: `srv-new-${Date.now()}` }])}
                  className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                >
                  + Add Server
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                Configure Jira server connections. Use "Test Connection" to verify before saving.
              </p>
              <div className="space-y-3">
                {servers.map((srv, idx) => {
                  const referencedByTeams = teams.filter((t) => t.serverId === srv.id);
                  return (
                    <div key={srv._key || srv.id} className="bg-gray-50 rounded-lg p-3 space-y-2 border border-gray-100">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Server Name</label>
                            <input
                              type="text" value={srv.name} placeholder="My Jira"
                              onChange={(e) => { const s = [...servers]; s[idx] = { ...s[idx], name: e.target.value }; setServers(s); }}
                              className="w-full text-sm bg-white border border-gray-200 rounded px-2 py-1 mt-0.5"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Server ID</label>
                            <input
                              type="text" value={srv.id} disabled={!srv._isNew}
                              onChange={(e) => { const s = [...servers]; s[idx] = { ...s[idx], id: e.target.value.replace(/[^a-zA-Z0-9-_]/g, "") }; setServers(s); }}
                              className="w-full text-sm bg-white border border-gray-200 rounded px-2 py-1 mt-0.5 font-mono disabled:bg-gray-100 disabled:text-gray-400"
                            />
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 uppercase tracking-wider">Jira URL</label>
                        <input
                          type="text" value={srv.url || ""} placeholder="https://jira.example.com"
                          onChange={(e) => { const s = [...servers]; s[idx] = { ...s[idx], url: e.target.value }; setServers(s); }}
                          className="w-full text-sm bg-white border border-gray-200 rounded px-2 py-1 mt-0.5 font-mono"
                        />
                        <p className="text-[10px] text-gray-400 mt-0.5">The URL used to reach Jira from the API server (and browser, unless overridden below)</p>
                      </div>
                      <div>
                        <button
                          type="button"
                          onClick={() => { const s = [...servers]; s[idx] = { ...s[idx], _showAdvanced: !s[idx]._showAdvanced }; setServers(s); }}
                          className="text-[10px] text-blue-600 hover:text-blue-800"
                        >
                          {srv._showAdvanced ? "- Hide advanced" : "+ Browser URL override (advanced)"}
                        </button>
                        {srv._showAdvanced && (
                          <div className="mt-1">
                            <input
                              type="text" value={srv.browserUrl || ""} placeholder="Leave empty to use Jira URL above"
                              onChange={(e) => { const s = [...servers]; s[idx] = { ...s[idx], browserUrl: e.target.value }; setServers(s); }}
                              className="w-full text-sm bg-white border border-gray-200 rounded px-2 py-1 font-mono"
                            />
                            <p className="text-[10px] text-gray-400 mt-0.5">Only needed if the API reaches Jira on a different URL than the browser (e.g. Docker internal hostname vs public URL)</p>
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Username / Email</label>
                          <input
                            type="text" value={srv._username ?? ""} placeholder={srv.hasCredentials ? "(unchanged)" : "admin"}
                            onChange={(e) => { const s = [...servers]; s[idx] = { ...s[idx], _username: e.target.value }; setServers(s); }}
                            className="w-full text-sm bg-white border border-gray-200 rounded px-2 py-1 mt-0.5"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 uppercase tracking-wider">API Token / Password</label>
                          <input
                            type="password" value={srv._token ?? ""} placeholder={srv.hasCredentials ? "••••••••" : "token"}
                            onChange={(e) => { const s = [...servers]; s[idx] = { ...s[idx], _token: e.target.value }; setServers(s); }}
                            className="w-full text-sm bg-white border border-gray-200 rounded px-2 py-1 mt-0.5"
                          />
                        </div>
                      </div>
                      {/* Test result banner */}
                      {srv._testResult && (
                        <div className={`rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${
                          srv._testResult.ok
                            ? "bg-green-50 border border-green-200 text-green-700"
                            : "bg-red-50 border border-red-200 text-red-700"
                        }`}>
                          {srv._testResult.ok
                            ? <>Connected as <strong>{srv._testResult.displayName}</strong>{srv._testResult.emailAddress ? ` (${srv._testResult.emailAddress})` : ""}</>
                            : <>{srv._testResult.error}</>
                          }
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-2">
                          {srv.hasCredentials && !srv._testResult && <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">Credentials set</span>}
                          {srv._isNew && <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">New server</span>}
                          {referencedByTeams.length > 0 && (
                            <span className="text-[10px] text-gray-500">Used by: {referencedByTeams.map((t) => t.name).join(", ")}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={async () => {
                              const url = srv.url;
                              const username = srv._username || "";
                              const token = srv._token || "";
                              if (!url) { toast.error("Enter a Jira URL first"); return; }
                              if (!username && !srv.hasCredentials) { toast.error("Enter a username"); return; }
                              if (!token && !srv.hasCredentials) { toast.error("Enter an API token"); return; }
                              const s = [...servers]; s[idx] = { ...s[idx], _testing: true, _testResult: null }; setServers(s);
                              try {
                                const result = await testConnection({
                                  url,
                                  username: username || "__use_saved__",
                                  token: token || "__use_saved__",
                                  serverId: srv.id,
                                });
                                const s2 = [...servers]; s2[idx] = { ...s2[idx], _testing: false, _testResult: result }; setServers(s2);
                                if (result.ok) toast.success(`Connected as ${result.displayName}`);
                                else toast.error(result.error);
                              } catch (err) {
                                const s2 = [...servers]; s2[idx] = { ...s2[idx], _testing: false, _testResult: { ok: false, error: err.message } }; setServers(s2);
                                toast.error(err.message);
                              }
                            }}
                            disabled={srv._testing}
                            className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 bg-blue-50 px-2 py-0.5 rounded disabled:opacity-50"
                          >
                            {srv._testing ? "Testing..." : "Test Connection"}
                          </button>
                          <button
                            onClick={() => {
                              if (referencedByTeams.length > 0) { alert(`Cannot remove: used by ${referencedByTeams.map((t) => t.name).join(", ")}`); return; }
                              setServers((s) => s.filter((_, i) => i !== idx));
                            }}
                            className="text-xs text-red-500 hover:text-red-700 px-2"
                            title={referencedByTeams.length > 0 ? "Remove teams using this server first" : "Remove server"}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* PI Planning / Multi-Team Config */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                PI Planning Configuration
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                Configure your Program Increment, teams, and program board.
              </p>

              {/* PI Config */}
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs text-gray-600 font-medium">Sprint Configuration</label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-[10px] text-gray-400">{piConfig.enabled !== false ? "PI Sprint Mode" : "JQL-Only Mode"}</span>
                  <div
                    onClick={async () => {
                      const newEnabled = piConfig.enabled === false ? true : false;
                      const newPiConfig = { ...piConfig, enabled: newEnabled };
                      setPiConfig(newPiConfig);
                      try {
                        const result = await updateConfig({ piConfig: newPiConfig });
                        if (result.piConfig) setPiConfig(result.piConfig);
                        if (result.configSource) setConfigSource(result.configSource);
                        toast.success(newEnabled ? "PI Sprint Mode enabled" : "JQL-Only Mode enabled");
                      } catch (err) {
                        setPiConfig((p) => ({ ...p, enabled: !newEnabled }));
                        toast.error("Failed to save mode: " + err.message);
                      }
                    }}
                    className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${piConfig.enabled !== false ? "bg-blue-600" : "bg-gray-300"}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${piConfig.enabled !== false ? "translate-x-5" : "translate-x-0.5"}`} />
                  </div>
                </label>
              </div>
              {piConfig.enabled === false && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700 mb-3">
                  Sprint configuration disabled. Teams will be analyzed using their JQL queries without PI date filtering.
                </div>
              )}
              <div className={`grid grid-cols-4 gap-3 mb-6 transition-opacity ${piConfig.enabled === false ? "opacity-40 pointer-events-none" : ""}`}>
                <div>
                  <label className="text-xs text-gray-600 font-medium">PI Name</label>
                  <input
                    type="text" value={piConfig.name || ""}
                    onChange={(e) => setPiConfig((p) => ({ ...p, name: e.target.value }))}
                    placeholder="PI 2026-Q1"
                    className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-medium">Start Date</label>
                  <input
                    type="date" value={piConfig.startDate || ""}
                    onChange={(e) => setPiConfig((p) => ({ ...p, startDate: e.target.value }))}
                    className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-medium">End Date</label>
                  <input
                    type="date" value={piConfig.endDate || ""}
                    onChange={(e) => setPiConfig((p) => ({ ...p, endDate: e.target.value }))}
                    className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-medium">Sprints / Duration (days)</label>
                  <div className="flex gap-2 mt-1">
                    <input
                      type="number" value={piConfig.sprintCount || 5} min={1} max={20}
                      onChange={(e) => setPiConfig((p) => ({ ...p, sprintCount: parseInt(e.target.value) }))}
                      className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                    />
                    <input
                      type="number" value={piConfig.sprintDuration || 14} min={7} max={30}
                      onChange={(e) => setPiConfig((p) => ({ ...p, sprintDuration: parseInt(e.target.value) }))}
                      className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                    />
                  </div>
                </div>
              </div>

              {/* Program Board */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div>
                  <label className="text-xs text-gray-600 font-medium">Program Board Project Key</label>
                  <input
                    type="text" value={programBoard.projectKey || ""} placeholder="PROGRAM"
                    onChange={(e) => setProgramBoard((p) => ({ ...p, projectKey: e.target.value.toUpperCase() }))}
                    className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">The parent project with high-level Features that link to team work</p>
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-medium">Program Board Server</label>
                  <select
                    value={programBoard.serverId || "primary"}
                    onChange={(e) => setProgramBoard((p) => ({ ...p, serverId: e.target.value }))}
                    className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                  >
                    {servers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Teams */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">Teams</label>
                  <button
                    onClick={() => setTeams((t) => [...t, { id: `team-${Date.now()}`, name: "", serverId: servers[0]?.id || "primary", projectKey: "", boardId: null, color: "#6366F1", jql: "" }])}
                    className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                  >
                    + Add Team
                  </button>
                </div>
                <div className="space-y-2">
                  {teams.map((team, idx) => (
                    <div key={team.id} className="bg-gray-50 rounded-lg p-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="color" value={team.color || "#3B82F6"}
                          onChange={(e) => { const t = [...teams]; t[idx] = { ...t[idx], color: e.target.value }; setTeams(t); }}
                          className="w-8 h-8 rounded border-0 cursor-pointer shrink-0"
                        />
                        <input
                          type="text" value={team.name} placeholder="Team Name"
                          onChange={(e) => { const t = [...teams]; t[idx] = { ...t[idx], name: e.target.value }; setTeams(t); }}
                          className="flex-1 text-sm bg-white border border-gray-200 rounded px-2 py-1"
                        />
                        <input
                          type="text" value={team.projectKey} placeholder="PROJECT_KEY"
                          onChange={(e) => { const t = [...teams]; t[idx] = { ...t[idx], projectKey: e.target.value.toUpperCase() }; setTeams(t); }}
                          className="w-28 text-sm bg-white border border-gray-200 rounded px-2 py-1 font-mono"
                        />
                        <select
                          value={team.serverId}
                          onChange={(e) => { const t = [...teams]; t[idx] = { ...t[idx], serverId: e.target.value }; setTeams(t); }}
                          className="text-xs bg-white border border-gray-200 rounded px-2 py-1"
                        >
                          {servers.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => setTeams((t) => t.filter((_, i) => i !== idx))}
                          className="text-xs text-red-500 hover:text-red-700 px-2 shrink-0"
                        >
                          Remove
                        </button>
                      </div>
                      <input
                        type="text" value={team.jql || ""} placeholder="Custom JQL (optional) — e.g. project = KEY AND sprint in openSprints()"
                        onChange={(e) => { const t = [...teams]; t[idx] = { ...t[idx], jql: e.target.value }; setTeams(t); }}
                        className="w-full text-xs bg-white border border-gray-200 rounded px-2 py-1 font-mono text-gray-600"
                      />
                    </div>
                  ))}
                  {teams.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-3">No teams configured. Add a team to use PI Planning.</p>
                  )}
                </div>
              </div>

              {/* Default Team */}
              <div className="mb-4">
                <label className="text-xs font-medium text-gray-600 block mb-1">Default Team</label>
                <p className="text-[10px] text-gray-400 mb-1.5">When set, pages auto-load this team's issues if no JQL is entered.</p>
                <select
                  value={defaultTeamId}
                  onChange={(e) => setDefaultTeamId(e.target.value)}
                  className="w-full text-sm bg-white border border-gray-200 rounded px-2 py-1.5"
                >
                  <option value="">None (manual JQL only)</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name || t.projectKey || t.id}{t.projectKey ? ` (${t.projectKey})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* PI Compliance Checks */}
            {allPiChecks.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold text-gray-800">PI Compliance Checks</h3>
                  <button
                    onClick={async () => {
                      setVerifying(true);
                      try {
                        await updateConfig({ disabledPiChecks });
                        const result = await fetchPiCompliance();
                        setComplianceResult(result);
                        if (result.allCheckIds) setAllPiChecks(result.allCheckIds);
                        toast.success(`Compliance score: ${result.score}% (${result.checks?.length || 0} active checks)`);
                      } catch (err) {
                        toast.error("Failed to verify compliance: " + err.message);
                      }
                      setVerifying(false);
                    }}
                    disabled={verifying}
                    className="text-xs bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white px-3 py-1.5 rounded-md transition-colors"
                  >
                    {verifying ? "Verifying..." : "Reload & Verify"}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                  Disable checks to exclude them from the PI compliance score.
                </p>

                {/* Compliance score summary */}
                {complianceResult && (
                  <div className={`rounded-lg border px-4 py-3 mb-4 ${
                    complianceResult.score >= 80 ? "bg-green-50 border-green-200" :
                    complianceResult.score >= 50 ? "bg-amber-50 border-amber-200" :
                    "bg-red-50 border-red-200"
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-sm font-bold ${
                        complianceResult.score >= 80 ? "text-green-700" :
                        complianceResult.score >= 50 ? "text-amber-700" :
                        "text-red-700"
                      }`}>
                        Compliance Score: {complianceResult.score}%
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {complianceResult.totalScore}/{complianceResult.maxPossible} points
                        {" · "}{complianceResult.totalIssues} issues · {complianceResult.teamCount} teams
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          complianceResult.score >= 80 ? "bg-green-500" :
                          complianceResult.score >= 50 ? "bg-amber-500" :
                          "bg-red-500"
                        }`}
                        style={{ width: `${complianceResult.score}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Checks with toggle + score */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {allPiChecks.map((check) => {
                    const isDisabled = disabledPiChecks.includes(check.id);
                    const result = complianceResult?.checks?.find((c) => c.id === check.id);
                    const scoreBg = !result ? "" :
                      result.score >= 8 ? "bg-green-50 border-green-200" :
                      result.score >= 5 ? "bg-amber-50 border-amber-200" :
                      "bg-red-50 border-red-200";
                    return (
                      <label key={check.id} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        isDisabled ? "bg-gray-50 border-gray-200 text-gray-400" :
                        result ? scoreBg : "bg-green-50 border-green-200 text-gray-700"
                      }`}>
                        <input
                          type="checkbox"
                          checked={!isDisabled}
                          onChange={() => {
                            setDisabledPiChecks((prev) =>
                              isDisabled
                                ? prev.filter((id) => id !== check.id)
                                : [...prev, check.id]
                            );
                          }}
                          className="rounded border-gray-300 shrink-0"
                        />
                        <span className="flex-1 min-w-0 truncate">{check.name}</span>
                        {result && !isDisabled && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            {result.detail && <span className="text-[10px] text-gray-400 max-w-[150px] truncate hidden lg:inline">{result.detail}</span>}
                            <span className={`font-bold text-[11px] ${
                              result.score >= 8 ? "text-green-600" :
                              result.score >= 5 ? "text-amber-600" :
                              "text-red-600"
                            }`}>{result.score}/{result.maxScore}</span>
                          </div>
                        )}
                        {isDisabled && <span className="text-[10px] text-gray-400 shrink-0">off</span>}
                      </label>
                    );
                  })}
                </div>
                <p className="text-[10px] text-gray-400 mt-3">
                  Toggle checks on/off, then click "Reload & Verify" to save and re-score compliance against live Jira data.
                </p>
              </div>
            )}

            {/* Config Import / Export */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">Import / Export Configuration</h3>
              <p className="text-xs text-gray-500 mb-4">
                Paste a <code className="bg-gray-100 px-1 rounded">config.json</code> to override the current configuration.
                This replaces servers, teams, PI config, and all other settings.
              </p>

              {/* Export */}
              <div className="mb-4">
                <button
                  onClick={async () => {
                    try {
                      const cfg = await fetchConfig();
                      setConfigJsonText(JSON.stringify(cfg, null, 2));
                      toast.success("Current config loaded into editor");
                    } catch (err) {
                      toast.error("Failed to export config: " + err.message);
                    }
                  }}
                  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-md transition-colors"
                >
                  Load Current Config
                </button>
              </div>

              {/* Textarea */}
              <textarea
                value={configJsonText}
                onChange={(e) => setConfigJsonText(e.target.value)}
                placeholder='Paste config.json content here...'
                rows={12}
                className="w-full text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {/* Import button */}
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={async () => {
                    if (!configJsonText.trim()) {
                      toast.error("Paste a config.json first");
                      return;
                    }
                    let parsed;
                    try {
                      parsed = JSON.parse(configJsonText);
                    } catch {
                      toast.error("Invalid JSON — check syntax");
                      return;
                    }
                    setImporting(true);
                    try {
                      const result = await importConfig(parsed);
                      // Reload page state with imported config
                      if (result.servers) setServers(result.servers.map((s, i) => ({ ...s, _key: `srv-${i}-${Date.now()}` })));
                      if (result.teams) setTeams(result.teams);
                      if (result.piConfig) setPiConfig(result.piConfig);
                      if (result.programBoard) setProgramBoard(result.programBoard);
                      if (result.defaultTeamId !== undefined) setDefaultTeamId(result.defaultTeamId);
                      if (result.disabledPiChecks) setDisabledPiChecks(result.disabledPiChecks);
                      if (result.configSource) setConfigSource(result.configSource);
                      toast.success("Configuration imported successfully");
                      setConfigJsonText("");
                    } catch (err) {
                      toast.error("Import failed: " + err.message);
                    }
                    setImporting(false);
                  }}
                  disabled={importing || !configJsonText.trim()}
                  className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-1.5 rounded-md transition-colors font-medium"
                >
                  {importing ? "Importing..." : "Import Config"}
                </button>
                <span className="text-[10px] text-gray-400">
                  Warning: this will overwrite your current configuration
                </span>
              </div>
            </div>

            {/* Help */}
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-6">
              <h3 className="text-sm font-semibold text-amber-800 mb-2">
                How Epic Children Detection Works
              </h3>
              <ol className="text-xs text-amber-700 space-y-2 list-decimal list-inside">
                <li>
                  <strong>Custom JQL template</strong> (this setting) — If set, always used.
                  Use <code className="bg-amber-100 px-1 rounded">{"{EPIC_KEY}"}</code> as placeholder.
                </li>
                <li>
                  <strong>"Epic Link" JQL</strong> — Auto-detected at startup. Works on Jira Server/DC
                  with Jira Software installed.
                </li>
                <li>
                  <strong>parent = KEY</strong> — Always tried as fallback. Works on Jira 10.x,
                  next-gen, and team-managed projects.
                </li>
              </ol>
              <p className="text-xs text-amber-600 mt-3">
                If neither "Epic Link" nor "parent" works for your Jira, set a custom template above.
                Common alternatives: labels, components, or custom field IDs.
              </p>
            </div>
          </>
        )}
      </main>

      {/* Sticky Save Bar */}
      {!loading && settings && (
        <div className="sticky bottom-0 bg-white border-t border-gray-200 py-3 z-10">
          <div className="max-w-[900px] mx-auto px-4 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-6 py-2 rounded-lg transition-colors font-medium"
            >
              {saving ? "Saving..." : "Save All Settings"}
            </button>
            {saved && (
              <span className="text-sm text-green-600 font-medium">Saved!</span>
            )}
            {error && (
              <span className="text-sm text-red-600">{error}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
