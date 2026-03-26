"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchSettings, updateSettings, fetchConfig, updateConfig, testConnection, importConfig, fetchAiSettings, updateAiSettings } from "../../lib/api";
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
  const router = useRouter();
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
  const [storyPointSettings, setStoryPointSettings] = useState({ maxStoryPoints: 8 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  // Multi-server / team config
  const [teams, setTeams] = useState([]);
  const [servers, setServers] = useState([]);
  const [configSource, setConfigSource] = useState("");
  const [defaultTeamId, setDefaultTeamId] = useState("");
  const [configJsonText, setConfigJsonText] = useState("");
  const [importing, setImporting] = useState(false);

  // AI provider config
  const [aiConfig, setAiConfig] = useState({ provider: "", model: "", apiKey: "", baseUrl: "", enabled: false, hasApiKey: false });
  const [aiSaving, setAiSaving] = useState(false);
  const [aiSaved, setAiSaved] = useState(false);

  useEffect(() => {
    Promise.all([fetchSettings(), fetchConfig(), fetchAiSettings().catch(() => null)])
      .then(([s, cfg, ai]) => {
        setSettings(s);
        setTemplate(s.epicChildrenJqlTemplate || "");
        setMissingInfoCriteria(s.missingInfoCriteria || DEFAULT_MISSING_INFO);
        if (s.promptSettings) setPromptSettings((prev) => ({ ...prev, ...s.promptSettings }));
        if (s.storyPointSettings) setStoryPointSettings(s.storyPointSettings);
        if (cfg.teams) setTeams(cfg.teams);
        if (cfg.servers) setServers(cfg.servers.map((s, i) => ({ ...s, _key: `srv-${i}-${Date.now()}` })));
        if (cfg.configSource) setConfigSource(cfg.configSource);
        if (cfg.defaultTeamId !== undefined) setDefaultTeamId(cfg.defaultTeamId);
        if (ai) setAiConfig((prev) => ({ ...prev, ...ai, apiKey: "" }));
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
        updateSettings({ epicChildrenJqlTemplate: template, missingInfoCriteria, promptSettings, storyPointSettings }),
        updateConfig({ teams, servers: serverPayloads, defaultTeamId }),
      ]);
      setSettings((prev) => ({ ...prev, ...result }));
      if (cfgResult.servers) setServers(cfgResult.servers);
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

  const handleSaveAi = async () => {
    setAiSaving(true);
    setAiSaved(false);
    try {
      const payload = { provider: aiConfig.provider, model: aiConfig.model, baseUrl: aiConfig.baseUrl, enabled: aiConfig.enabled };
      if (aiConfig.apiKey) payload.apiKey = aiConfig.apiKey;
      const result = await updateAiSettings(payload);
      setAiConfig((prev) => ({ ...prev, ...result, apiKey: "" }));
      setAiSaved(true);
      toast.success("AI settings saved");
      setTimeout(() => setAiSaved(false), 3000);
    } catch (err) {
      toast.error("Failed to save AI settings: " + err.message);
    }
    setAiSaving(false);
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

        {/* Setup wizard banner when no servers configured */}
        {!loading && servers.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-amber-800">No Jira server configured</p>
              <p className="text-xs text-amber-600 mt-0.5">Use the setup wizard for a guided configuration, or add a server manually below.</p>
            </div>
            <button
              onClick={() => { sessionStorage.removeItem("setup_skipped"); router.push("/setup"); }}
              className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg transition-colors font-medium shrink-0"
            >
              Launch Setup Wizard
            </button>
          </div>
        )}

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

            {/* Story Point Limits */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                Story Point Limits
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                Tickets with story points above this limit will be flagged for splitting.
                Values follow the Fibonacci sequence.
              </p>
              <div>
                <label className="text-xs text-gray-600 font-medium">Maximum story points per ticket</label>
                <div className="flex items-center gap-2 mt-2">
                  {[1, 2, 3, 5, 8, 13, 21].map((v) => (
                    <button
                      key={v}
                      onClick={() => setStoryPointSettings((prev) => ({ ...prev, maxStoryPoints: v }))}
                      className={`w-10 h-10 rounded-lg border-2 text-sm font-bold transition-all ${
                        storyPointSettings.maxStoryPoints === v
                          ? "bg-blue-50 border-blue-500 text-blue-700 ring-2 ring-blue-200"
                          : v > storyPointSettings.maxStoryPoints
                            ? "bg-red-50 border-red-200 text-red-400"
                            : "bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-2">
                  Current: <span className="font-bold">{storyPointSettings.maxStoryPoints}</span> — tickets above this will show a split alert.
                  Values in <span className="text-red-400">red</span> exceed the limit.
                </p>
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

            {/* Teams Configuration */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                Teams Configuration
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                Configure your teams and default team settings.
              </p>

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
                    <p className="text-xs text-gray-400 text-center py-3">No teams configured. Add a team to get started.</p>
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

            {/* Config Import / Export */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">Import / Export Configuration</h3>
              <p className="text-xs text-gray-500 mb-4">
                Paste a <code className="bg-gray-100 px-1 rounded">config.json</code> to override the current configuration.
                This replaces servers, teams, and all other settings.
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
                      if (result.defaultTeamId !== undefined) setDefaultTeamId(result.defaultTeamId);
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

            {/* ─── AI Provider ─── */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">AI Provider</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Connect your own AI API key to power the AI Coach feature</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <span className="text-xs text-gray-600">{aiConfig.enabled ? "Enabled" : "Disabled"}</span>
                  <div
                    onClick={() => setAiConfig((p) => ({ ...p, enabled: !p.enabled }))}
                    className={`relative w-9 h-5 rounded-full cursor-pointer transition-colors ${aiConfig.enabled ? "bg-blue-600" : "bg-gray-300"}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${aiConfig.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs text-gray-600 font-medium">Provider</label>
                  <select
                    value={aiConfig.provider}
                    onChange={(e) => setAiConfig((p) => ({ ...p, provider: e.target.value, model: "" }))}
                    className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                  >
                    <option value="">— Select provider —</option>
                    <option value="openai">OpenAI (ChatGPT)</option>
                    <option value="anthropic">Anthropic (Claude)</option>
                    <option value="mistral">Mistral AI</option>
                    <option value="ollama">Ollama (local)</option>
                    <option value="custom">Custom / OpenAI-compatible</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-gray-600 font-medium">Model</label>
                  {aiConfig.provider === "openai" ? (
                    <select
                      value={aiConfig.model}
                      onChange={(e) => setAiConfig((p) => ({ ...p, model: e.target.value }))}
                      className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                    >
                      <option value="">Default (gpt-4o-mini)</option>
                      <option value="gpt-4o-mini">gpt-4o-mini</option>
                      <option value="gpt-4o">gpt-4o</option>
                      <option value="gpt-4-turbo">gpt-4-turbo</option>
                      <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                    </select>
                  ) : aiConfig.provider === "anthropic" ? (
                    <select
                      value={aiConfig.model}
                      onChange={(e) => setAiConfig((p) => ({ ...p, model: e.target.value }))}
                      className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                    >
                      <option value="">Default (claude-haiku)</option>
                      <option value="claude-haiku-4-5-20251001">claude-haiku-4-5 (fast)</option>
                      <option value="claude-sonnet-4-5">claude-sonnet-4-5</option>
                      <option value="claude-opus-4-5">claude-opus-4-5</option>
                    </select>
                  ) : aiConfig.provider === "mistral" ? (
                    <select
                      value={aiConfig.model}
                      onChange={(e) => setAiConfig((p) => ({ ...p, model: e.target.value }))}
                      className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                    >
                      <option value="">Default (mistral-small)</option>
                      <option value="mistral-small-latest">mistral-small</option>
                      <option value="mistral-medium-latest">mistral-medium</option>
                      <option value="mistral-large-latest">mistral-large</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={aiConfig.model}
                      onChange={(e) => setAiConfig((p) => ({ ...p, model: e.target.value }))}
                      placeholder={aiConfig.provider === "ollama" ? "llama3" : "model name"}
                      className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono"
                    />
                  )}
                </div>
              </div>

              <div className="mb-4">
                <label className="text-xs text-gray-600 font-medium">
                  API Key {aiConfig.hasApiKey && <span className="text-green-600 ml-1">✓ saved</span>}
                </label>
                <input
                  type="password"
                  value={aiConfig.apiKey}
                  onChange={(e) => setAiConfig((p) => ({ ...p, apiKey: e.target.value }))}
                  placeholder={aiConfig.hasApiKey ? "Leave blank to keep existing key" : "Paste your API key"}
                  className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  {aiConfig.provider === "openai" && <>Get your key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">platform.openai.com/api-keys</a></>}
                  {aiConfig.provider === "anthropic" && <>Get your key at <a href="https://console.anthropic.com/settings/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">console.anthropic.com</a></>}
                  {aiConfig.provider === "mistral" && <>Get your key at <a href="https://console.mistral.ai/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">console.mistral.ai</a></>}
                  {(aiConfig.provider === "ollama" || aiConfig.provider === "custom") && "Not required for local / custom providers"}
                  {!aiConfig.provider && "Your key is stored on the server and never exposed to the browser"}
                </p>
              </div>

              {(aiConfig.provider === "ollama" || aiConfig.provider === "custom") && (
                <div className="mb-4">
                  <label className="text-xs text-gray-600 font-medium">Base URL</label>
                  <input
                    type="url"
                    value={aiConfig.baseUrl}
                    onChange={(e) => setAiConfig((p) => ({ ...p, baseUrl: e.target.value }))}
                    placeholder={aiConfig.provider === "ollama" ? "http://localhost:11434" : "https://your-api.com/v1"}
                    className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono"
                  />
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveAi}
                  disabled={aiSaving}
                  className="text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-5 py-2 rounded-lg transition-colors font-medium"
                >
                  {aiSaving ? "Saving..." : "Save AI Settings"}
                </button>
                {aiSaved && <span className="text-sm text-green-600 font-medium">Saved!</span>}
                {!aiConfig.enabled && aiConfig.provider && (
                  <span className="text-xs text-amber-600">Provider configured but disabled — toggle to enable</span>
                )}
              </div>

              {!aiConfig.provider && (
                <p className="text-xs text-gray-400 mt-3 border-t border-gray-100 pt-3">
                  Without an AI provider, the AI Coach will return a formatted prompt you can paste into any AI chat tool (ChatGPT, Claude, etc.)
                </p>
              )}
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
