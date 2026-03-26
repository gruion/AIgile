"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { testConnection, updateConfig, updateAiSettings } from "../../lib/api";
import { useAppConfig } from "../../context/AppConfigContext";
import { toast } from "../../components/Toaster";

const STEPS = ["Welcome", "Connect Jira", "Team", "AI Provider", "Done"];

const AI_PROVIDERS = [
  { value: "mock", label: "Mock (built-in)" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "ollama", label: "Ollama (local)" },
  { value: "custom", label: "Custom (OpenAI-compatible)" },
];

function StepIndicator({ current }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full transition-colors ${
              i === current
                ? "bg-blue-600 ring-4 ring-blue-100"
                : i < current
                ? "bg-blue-400"
                : "bg-gray-200"
            }`}
            title={label}
          />
          {i < STEPS.length - 1 && (
            <div className={`w-6 h-px ${i < current ? "bg-blue-300" : "bg-gray-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function SetupWizard() {
  const router = useRouter();
  const { refresh } = useAppConfig();
  const [step, setStep] = useState(0);

  // Step 1 state
  const [jiraUrl, setJiraUrl] = useState("");
  const [username, setUsername] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState("");

  // Step 2 state
  const [teamName, setTeamName] = useState("My Team");
  const [projectKey, setProjectKey] = useState("");
  const [projects, setProjects] = useState([]);

  // Step 3 state
  const [aiProvider, setAiProvider] = useState("mock");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("");

  // Step 4 state
  const [saving, setSaving] = useState(false);

  const defaultJql = projectKey
    ? `project = ${projectKey} ORDER BY status ASC, updated DESC`
    : "";

  async function handleTestConnection() {
    setTesting(true);
    setTestError("");
    setTestResult(null);
    try {
      const result = await testConnection({
        url: jiraUrl.replace(/\/+$/, ""),
        username,
        token: apiToken,
      });
      if (result.ok) {
        setTestResult(result);
        if (result.projects && result.projects.length > 0) {
          setProjects(result.projects);
          setProjectKey(result.projects[0].key);
        }
        toast("Connection successful!", "success");
      } else {
        setTestError(result.error || "Connection failed");
      }
    } catch (err) {
      setTestError(err.message || "Connection failed");
    } finally {
      setTesting(false);
    }
  }

  async function handleFinish() {
    setSaving(true);
    try {
      const serverId = `server-${Date.now()}`;
      await updateConfig({
        servers: [
          {
            id: serverId,
            name: teamName,
            url: jiraUrl.replace(/\/+$/, ""),
            browserUrl: jiraUrl.replace(/\/+$/, ""),
            username,
            token: apiToken,
            projects: projectKey ? [projectKey] : [],
          },
        ],
        teams: [
          {
            id: `team-${Date.now()}`,
            name: teamName,
            serverId,
            jql: defaultJql,
          },
        ],
      });

      if (aiProvider !== "mock") {
        await updateAiSettings({
          provider: aiProvider,
          apiKey: aiApiKey || undefined,
          baseUrl: aiBaseUrl || undefined,
        });
      }

      await refresh();
      toast("Setup complete! Welcome to AIgileCoach.", "success");
      router.replace("/");
    } catch (err) {
      toast(err.message || "Failed to save configuration", "error");
    } finally {
      setSaving(false);
    }
  }

  const showApiKey = aiProvider !== "mock" && aiProvider !== "ollama";
  const showBaseUrl = aiProvider === "ollama" || aiProvider === "custom";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-8">
        <StepIndicator current={step} />

        {/* Step 0 — Welcome */}
        {step === 0 && (
          <div className="text-center">
            <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-6 shadow-lg">
              <span className="text-3xl font-bold text-white">AI</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">Welcome to AIgileCoach</h1>
            <p className="text-sm text-gray-600 mb-8 max-w-md mx-auto">
              AI-powered agile coaching dashboard. Let&apos;s connect your Jira to get started.
            </p>
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Get Started
              </button>
              <button
                onClick={() => { sessionStorage.setItem("setup_skipped", "1"); router.push("/"); }}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                Skip — I&apos;ll configure in Settings
              </button>
            </div>
          </div>
        )}

        {/* Step 1 — Connect Jira */}
        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">Connect to Jira</h2>
            <p className="text-xs text-gray-500 mb-6">Enter your Jira Cloud or Server credentials.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Jira URL</label>
                <input
                  type="text"
                  placeholder="https://your-team.atlassian.net"
                  value={jiraUrl}
                  onChange={(e) => setJiraUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Username / Email</label>
                <input
                  type="text"
                  placeholder="you@company.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">API Token</label>
                <input
                  type="password"
                  placeholder="Your Jira API token"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                <p className="text-xs text-gray-400 mt-1">
                  You can find your API token at{" "}
                  <a
                    href="https://id.atlassian.com/manage-profile/security/api-tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    id.atlassian.com/manage-profile/security/api-tokens
                  </a>
                </p>
              </div>

              {testError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <p className="text-xs text-red-700">{testError}</p>
                </div>
              )}

              {testResult && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <div>
                    <p className="text-xs text-green-700 font-medium">
                      Connected as {testResult.displayName}
                    </p>
                    {testResult.emailAddress && (
                      <p className="text-xs text-green-600">{testResult.emailAddress}</p>
                    )}
                    {testResult.projects && testResult.projects.length > 0 && (
                      <p className="text-xs text-green-600 mt-0.5">
                        Found {testResult.projects.length} project{testResult.projects.length !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setStep(0)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Back
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={handleTestConnection}
                    disabled={!jiraUrl || !username || !apiToken || testing}
                    className="px-4 py-2 text-sm border border-blue-300 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testing ? "Testing..." : "Test Connection"}
                  </button>
                  {testResult && (
                    <button
                      onClick={() => setStep(2)}
                      className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      Next
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2 — Configure Team */}
        {step === 2 && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">Configure Team</h2>
            <p className="text-xs text-gray-500 mb-6">Set your team name and select a Jira project.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Team Name</label>
                <input
                  type="text"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Project</label>
                {projects.length > 0 ? (
                  <select
                    value={projectKey}
                    onChange={(e) => setProjectKey(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                  >
                    {projects.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.key} — {p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="e.g. PROJ"
                    value={projectKey}
                    onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                )}
              </div>

              {defaultJql && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Default JQL</label>
                  <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 font-mono">
                    {defaultJql}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setStep(1)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!teamName}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3 — AI Provider */}
        {step === 3 && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">AI Provider</h2>
            <p className="text-xs text-gray-500 mb-6">
              The AI Coach feature works with any OpenAI-compatible API. You can configure this later in Settings.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Provider</label>
                <select
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                >
                  {AI_PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {showApiKey && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">API Key</label>
                  <input
                    type="password"
                    placeholder={`Your ${aiProvider} API key`}
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
              )}

              {showBaseUrl && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Base URL</label>
                  <input
                    type="text"
                    placeholder={aiProvider === "ollama" ? "http://localhost:11434" : "https://api.example.com/v1"}
                    value={aiBaseUrl}
                    onChange={(e) => setAiBaseUrl(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setStep(2)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Back
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setAiProvider("mock");
                      setAiApiKey("");
                      setAiBaseUrl("");
                      setStep(4);
                    }}
                    className="px-4 py-2 text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => setStep(4)}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 4 — All Done */}
        {step === 4 && (
          <div>
            <div className="text-center mb-6">
              <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">All Done!</h2>
              <p className="text-xs text-gray-500">Here&apos;s a summary of your configuration.</p>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 space-y-3 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Jira Server</span>
                <span className="text-gray-900 font-medium">{jiraUrl}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Team Name</span>
                <span className="text-gray-900 font-medium">{teamName}</span>
              </div>
              {projectKey && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Project</span>
                  <span className="text-gray-900 font-medium">{projectKey}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">AI Provider</span>
                <span className="text-gray-900 font-medium">
                  {AI_PROVIDERS.find((p) => p.value === aiProvider)?.label || aiProvider}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep(3)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleFinish}
                disabled={saving}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Launch Dashboard"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
