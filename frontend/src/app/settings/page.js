"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { fetchSettings, updateSettings } from "../../lib/api";

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

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [template, setTemplate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setSettings(s);
        setTemplate(s.epicChildrenJqlTemplate || "");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const result = await updateSettings({ epicChildrenJqlTemplate: template });
      setSettings((prev) => ({ ...prev, ...result }));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.message);
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
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold text-gray-900">Jira Dashboard</h1>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/"
                className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/insights"
                className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
              >
                Insights
              </Link>
              <Link
                href="/gantt"
                className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
              >
                Gantt
              </Link>
              <Link
                href="/analyze"
                className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
              >
                Analyze
              </Link>
              <Link
                href="/analytics"
                className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
              >
                Analytics
              </Link>
              <span className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm">
                Settings
              </span>
            </nav>
          </div>
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
    </div>
  );
}
