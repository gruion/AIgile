"use client";

import { useState, useEffect } from "react";
import { fetchRoamRisks, saveRoamRisk, deleteRoamRisk, fetchIssues } from "../../lib/api";
import AiCoachPanel from "../../components/AiCoachPanel";
import JqlBar from "../../components/JqlBar";
import { toast } from "../../components/Toaster";
import { useAppConfig } from "../../context/AppConfigContext";

const CATEGORIES = [
  { key: "resolved", label: "Resolved", color: "bg-green-100", headerColor: "bg-green-600", borderColor: "border-green-300", description: "Risks that have been resolved" },
  { key: "owned", label: "Owned", color: "bg-blue-100", headerColor: "bg-blue-600", borderColor: "border-blue-300", description: "Risks with a clear owner taking action" },
  { key: "accepted", label: "Accepted", color: "bg-yellow-100", headerColor: "bg-yellow-500", borderColor: "border-yellow-300", description: "Risks accepted by the team" },
  { key: "mitigated", label: "Mitigated", color: "bg-purple-100", headerColor: "bg-purple-600", borderColor: "border-purple-300", description: "Risks with mitigation plans" },
];

const SEVERITIES = [
  { key: "low", label: "Low", color: "bg-gray-200 text-gray-700" },
  { key: "medium", label: "Medium", color: "bg-yellow-200 text-yellow-800" },
  { key: "high", label: "High", color: "bg-orange-200 text-orange-800" },
  { key: "critical", label: "Critical", color: "bg-red-200 text-red-800" },
];

const EMPTY_FORM = { title: "", description: "", category: "owned", severity: "medium", owner: "", linkedIssues: "" };

const AI_PROMPTS = [
  {
    label: "Full Risk Assessment",
    primary: true,
    question: "As an Agile Coach, perform a comprehensive risk assessment. Analyze: 1) Overall risk posture (how exposed are we?), 2) Risk concentration (too many in one category?), 3) Cross-reference risks with ticket data — are there blocked or overdue tickets that correspond to untracked risks?, 4) Missing risks — based on the ticket data, what risks should we be tracking that we're not?, 5) Top 3 actions to reduce risk exposure.",
  },
  { label: "Mitigation strategies", question: "For each owned and accepted risk, suggest specific, actionable mitigation strategies. Include: who should own the mitigation, what the first step is, and how we'll know the risk is mitigated. Reference linked Jira tickets where applicable." },
  { label: "Priority risks", question: "Rank all risks by a combined impact x probability score. For the top 5, explain why they're highest priority and what happens if we don't address them this sprint." },
  { label: "Dependency risk analysis", question: "Analyze the dependencies in the ticket data alongside the ROAM board. Identify: cross-team dependency risks, single-point-of-failure risks (one person owns too many critical items), and timeline risks where dependencies create critical path issues." },
  { label: "Risk discovery from tickets", question: "Analyze the ticket data to discover risks we may not have tracked yet. Look for: blocked items, overdue items, items with no assignee on the critical path, high-priority items with no progress, and any patterns suggesting systemic risks." },
];

function SeverityBadge({ severity }) {
  const sev = SEVERITIES.find((s) => s.key === severity) || SEVERITIES[0];
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${sev.color}`}>
      {sev.label}
    </span>
  );
}

function LinkedIssueBadges({ issues, jiraBaseUrl }) {
  if (!issues || issues.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {issues.map((key) => (
        <a
          key={key}
          href={`${jiraBaseUrl}/browse/${key}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-xs font-mono hover:bg-blue-100 transition-colors"
        >
          {key}
        </a>
      ))}
    </div>
  );
}

export default function RoamPage() {
  const { defaultJql, jiraBaseUrl } = useAppConfig();
  const [risks, setRisks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");
  const [ticketData, setTicketData] = useState(null);

  useEffect(() => {
    loadRisks();
  }, []);

  useEffect(() => {
    if (defaultJql) {
      setJql((prev) => prev || defaultJql);
      setInputJql((prev) => prev || defaultJql);
    }
  }, [defaultJql]);

  // Load ticket context for AI analysis
  useEffect(() => {
    if (jql) fetchIssues(jql).then(setTicketData).catch(() => {});
  }, [jql]);

  async function loadRisks() {
    setLoading(true);
    try {
      const data = await fetchRoamRisks();
      setRisks(data || []);
    } catch (err) {
      toast.error("Failed to load risks: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  function openNewForm() {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
    setShowForm(true);
  }

  function openEditForm(risk) {
    setForm({
      title: risk.title || "",
      description: risk.description || "",
      category: risk.category || "owned",
      severity: risk.severity || "medium",
      owner: risk.owner || "",
      linkedIssues: (risk.linkedIssues || []).join(", "),
    });
    setEditingId(risk.id);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    try {
      const payload = {
        ...form,
        linkedIssues: form.linkedIssues
          ? form.linkedIssues.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
      };
      if (editingId) payload.id = editingId;
      await saveRoamRisk(payload);
      toast.success(editingId ? "Risk updated" : "Risk created");
      closeForm();
      await loadRisks();
    } catch (err) {
      toast.error("Failed to save risk: " + err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this risk?")) return;
    try {
      await deleteRoamRisk(id);
      toast.success("Risk deleted");
      await loadRisks();
    } catch (err) {
      toast.error("Failed to delete risk: " + err.message);
    }
  }

  async function handleMove(risk, newCategory) {
    try {
      await saveRoamRisk({ ...risk, category: newCategory });
      toast.success(`Moved to ${newCategory}`);
      await loadRisks();
    } catch (err) {
      toast.error("Failed to move risk: " + err.message);
    }
  }

  // Summary counts
  const categoryCounts = CATEGORIES.map((cat) => ({
    ...cat,
    count: risks.filter((r) => r.category === cat.key).length,
  }));
  const severityCounts = SEVERITIES.map((sev) => ({
    ...sev,
    count: risks.filter((r) => r.severity === sev.key).length,
  }));

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ROAM Board</h1>
          <p className="text-sm text-gray-500 mt-1">Track and manage risks &amp; dependencies</p>
        </div>
        <button
          onClick={openNewForm}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
        >
          + Add Risk
        </button>
      </div>

      {/* JQL Bar for ticket context */}
      <div className="mb-6">
        <JqlBar
          value={inputJql}
          onChange={setInputJql}
          onSubmit={(q) => setJql(q)}
          placeholder="Load ticket context for risk analysis..."
        />
        {ticketData && (
          <p className="text-xs text-gray-400 mt-1">{ticketData.total} tickets loaded for AI context</p>
        )}
      </div>

      {/* AI Coach Panel */}
      <div className="mb-4">
        <AiCoachPanel
          context="ROAM Risk Board"
          data={{ risks, categoryCounts, severityCounts, ticketContext: ticketData ? { total: ticketData.total, epicCount: ticketData.epics?.length } : null }}
          prompts={AI_PROMPTS}
        />
      </div>

      {/* Summary Bar */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-600">By Category:</span>
          {categoryCounts.map((cat) => (
            <span key={cat.key} className={`px-3 py-1 rounded-full text-xs font-medium ${cat.color} ${cat.borderColor} border`}>
              {cat.label}: {cat.count}
            </span>
          ))}
        </div>
        <div className="h-6 w-px bg-gray-200" />
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-600">By Severity:</span>
          {severityCounts.map((sev) => (
            <span key={sev.key} className={`px-3 py-1 rounded-full text-xs font-medium ${sev.color}`}>
              {sev.label}: {sev.count}
            </span>
          ))}
        </div>
        <div className="h-6 w-px bg-gray-200" />
        <span className="text-sm font-semibold text-gray-700">Total: {risks.length}</span>
      </div>

      {/* Inline Form */}
      {showForm && (
        <form onSubmit={handleSave} className="bg-white rounded-lg border border-gray-200 p-5 mb-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">
            {editingId ? "Edit Risk" : "Add New Risk"}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Risk title"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
              <input
                type="text"
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Risk owner"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                rows={3}
                placeholder="Describe the risk or dependency"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.key} value={cat.key}>{cat.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Severity</label>
              <select
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                {SEVERITIES.map((sev) => (
                  <option key={sev.key} value={sev.key}>{sev.label}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Linked Issues</label>
              <input
                type="text"
                value={form.linkedIssues}
                onChange={(e) => setForm({ ...form, linkedIssues: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="TEAM-123, TEAM-456 (comma-separated Jira keys)"
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              {editingId ? "Update" : "Save"}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {!loading && risks.length === 0 && !ticketData && !jql && (
        <div className="text-center py-20 text-gray-400">
          <svg className="mx-auto w-12 h-12 mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <p className="text-lg font-medium text-gray-500 mb-2">Enter a JQL query to get started</p>
          <p className="text-sm mb-4">Type a query in the search bar above, for example:</p>
          <code className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-md">project = MYPROJECT ORDER BY status ASC, updated DESC</code>
          <p className="text-xs text-gray-400 mt-4">
            Or set a default JQL in <a href="/settings" className="text-blue-500 hover:underline font-medium">Settings</a> so pages load automatically.
          </p>
        </div>
      )}

      {/* Kanban Board */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading risks...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          {CATEGORIES.map((cat) => {
            const columnRisks = risks.filter((r) => r.category === cat.key);
            const otherCategories = CATEGORIES.filter((c) => c.key !== cat.key);
            return (
              <div key={cat.key} className={`rounded-lg border ${cat.borderColor} bg-white overflow-hidden`}>
                {/* Column Header */}
                <div className={`${cat.headerColor} text-white px-4 py-3`}>
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-sm">{cat.label}</h2>
                    <span className="bg-white/20 rounded-full px-2 py-0.5 text-xs font-medium">
                      {columnRisks.length}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5 opacity-80">{cat.description}</p>
                </div>

                {/* Cards */}
                <div className="p-3 space-y-3 min-h-[200px]">
                  {columnRisks.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-8">No risks</p>
                  )}
                  {columnRisks.map((risk) => (
                    <div
                      key={risk.id}
                      className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow"
                    >
                      {/* Title + Severity */}
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="text-sm font-bold text-gray-900 leading-tight">{risk.title}</h3>
                        <SeverityBadge severity={risk.severity} />
                      </div>

                      {/* Description (truncated) */}
                      {risk.description && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{risk.description}</p>
                      )}

                      {/* Owner */}
                      {risk.owner && (
                        <p className="text-xs text-gray-600 mt-2">
                          <span className="font-medium">Owner:</span> {risk.owner}
                        </p>
                      )}

                      {/* Linked Issues */}
                      <LinkedIssueBadges issues={risk.linkedIssues} jiraBaseUrl={jiraBaseUrl} />

                      {/* Actions */}
                      <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
                        <div className="flex gap-1">
                          <button
                            onClick={() => openEditForm(risk)}
                            className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                            title="Edit"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(risk.id)}
                            className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                            title="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>

                        {/* Move To dropdown */}
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) handleMove(risk, e.target.value);
                          }}
                          className="text-xs border border-gray-200 rounded px-1 py-0.5 text-gray-500 bg-white hover:border-gray-400 outline-none"
                        >
                          <option value="">Move to...</option>
                          {otherCategories.map((oc) => (
                            <option key={oc.key} value={oc.key}>{oc.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
