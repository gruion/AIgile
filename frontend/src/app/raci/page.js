"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchRaciMatrices, saveRaciMatrix, deleteRaciMatrix, validateRaciMatrix, suggestRaci } from "../../lib/api";
import AiCoachPanel from "../../components/AiCoachPanel";
import { toast } from "../../components/Toaster";
import { useAppConfig } from "../../context/AppConfigContext";

// ─── Constants ──────────────────────────────────────────

const RACI_VALUES = ["R", "A", "C", "I"];
const RACI_COLORS = {
  R: { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-300", label: "Responsible" },
  A: { bg: "bg-red-100", text: "text-red-800", border: "border-red-300", label: "Accountable" },
  C: { bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-300", label: "Consulted" },
  I: { bg: "bg-green-100", text: "text-green-800", border: "border-green-300", label: "Informed" },
};

const AI_PROMPTS = [
  { label: "Suggest assignments", primary: true, question: "Based on the team structure and RACI best practices, suggest appropriate RACI assignments for each activity. For each suggestion, explain your reasoning. Remember: each activity must have exactly one Accountable (A) and at least one Responsible (R)." },
  { label: "Find gaps & conflicts", question: "Analyze this RACI matrix for issues: activities without clear accountability, roles overloaded with too many A/R assignments, activities with no one Responsible, and any RACI anti-patterns. Suggest specific fixes." },
  { label: "Audit accountability", question: "Review the Accountable (A) assignments. Is accountability appropriately distributed? Are there single points of failure? Does the accountability pattern align with agile best practices?" },
  { label: "Compare declared vs actual", question: "Compare this RACI matrix with what the Jira activity data shows. Who actually does what vs who is supposed to? Highlight mismatches." },
  { label: "Optimize for agile", question: "Review this RACI matrix through an agile lens. Are there activities where the team should be more self-organizing? Suggest a leaner RACI that empowers the team while maintaining accountability." },
];

// ─── RACI Cell ──────────────────────────────────────────

function RaciCell({ value, onChange, activityName, roleName }) {
  const cycle = () => {
    const idx = value ? RACI_VALUES.indexOf(value) : -1;
    const next = idx >= RACI_VALUES.length - 1 ? null : RACI_VALUES[idx + 1];
    onChange(next);
  };

  const style = value ? RACI_COLORS[value] : null;

  return (
    <button
      onClick={cycle}
      title={`${activityName} × ${roleName}: ${value ? style.label : "Click to assign"}`}
      className={`w-10 h-10 rounded-lg border-2 text-sm font-bold transition-all hover:scale-110 ${
        style
          ? `${style.bg} ${style.text} ${style.border}`
          : "bg-gray-50 text-gray-300 border-gray-200 hover:border-gray-300"
      }`}
    >
      {value || "·"}
    </button>
  );
}

// ─── Validation Panel ───────────────────────────────────

function ValidationPanel({ errors, warnings, score }) {
  if (errors.length === 0 && warnings.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 flex items-center gap-2">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        RACI matrix is valid! Score: {score}/100
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {errors.map((e, i) => (
        <div key={`e-${i}`} className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-xs text-red-700 flex items-center gap-2">
          <span className="font-bold shrink-0">ERROR</span>
          <span>{e.activity || e.role}: {e.message}</span>
        </div>
      ))}
      {warnings.map((w, i) => (
        <div key={`w-${i}`} className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs text-amber-700 flex items-center gap-2">
          <span className="font-bold shrink-0">WARN</span>
          <span>{w.activity || w.role}: {w.message}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Matrix Editor ──────────────────────────────────────

function MatrixEditor({ matrix, onSave, onBack, onValidate, validation }) {
  const [data, setData] = useState(matrix);
  const [saving, setSaving] = useState(false);
  const [editingActivity, setEditingActivity] = useState(null);
  const [editingRole, setEditingRole] = useState(null);
  const [newActivityName, setNewActivityName] = useState("");
  const [newRoleName, setNewRoleName] = useState("");

  const handleCellChange = (actId, roleId, value) => {
    setData((prev) => ({
      ...prev,
      assignments: { ...prev.assignments, [`${actId}:${roleId}`]: value },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await onSave(data);
      setData(saved);
      toast.success("RACI matrix saved");
    } catch (err) {
      toast.error("Failed to save: " + err.message);
    }
    setSaving(false);
  };

  const addActivity = () => {
    if (!newActivityName.trim()) return;
    const id = `act-${Date.now()}`;
    setData((prev) => ({
      ...prev,
      activities: [...prev.activities, { id, name: newActivityName.trim(), order: prev.activities.length }],
    }));
    setNewActivityName("");
  };

  const addRole = () => {
    if (!newRoleName.trim()) return;
    const id = `role-${Date.now()}`;
    setData((prev) => ({
      ...prev,
      roles: [...prev.roles, { id, name: newRoleName.trim(), order: prev.roles.length }],
    }));
    setNewRoleName("");
  };

  const removeActivity = (actId) => {
    setData((prev) => {
      const assignments = { ...prev.assignments };
      for (const key of Object.keys(assignments)) {
        if (key.startsWith(`${actId}:`)) delete assignments[key];
      }
      return { ...prev, activities: prev.activities.filter((a) => a.id !== actId), assignments };
    });
  };

  const removeRole = (roleId) => {
    setData((prev) => {
      const assignments = { ...prev.assignments };
      for (const key of Object.keys(assignments)) {
        if (key.endsWith(`:${roleId}`)) delete assignments[key];
      }
      return { ...prev, roles: prev.roles.filter((r) => r.id !== roleId), assignments };
    });
  };

  const renameActivity = (actId, newName) => {
    setData((prev) => ({
      ...prev,
      activities: prev.activities.map((a) => (a.id === actId ? { ...a, name: newName } : a)),
    }));
    setEditingActivity(null);
  };

  const renameRole = (roleId, newName) => {
    setData((prev) => ({
      ...prev,
      roles: prev.roles.map((r) => (r.id === roleId ? { ...r, name: newName } : r)),
    }));
    setEditingRole(null);
  };

  // Live validation: count errors per row
  const rowIssues = useMemo(() => {
    const issues = {};
    for (const act of data.activities) {
      const row = data.roles.map((r) => data.assignments[`${act.id}:${r.id}`]).filter(Boolean);
      const aCount = row.filter((v) => v === "A").length;
      const rCount = row.filter((v) => v === "R").length;
      const errs = [];
      if (aCount === 0) errs.push("No Accountable");
      if (aCount > 1) errs.push("Multiple Accountable");
      if (rCount === 0) errs.push("No Responsible");
      if (row.length === 0) errs.push("Empty row");
      if (errs.length > 0) issues[act.id] = errs;
    }
    return issues;
  }, [data]);

  const errorCount = Object.keys(rowIssues).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div>
            <h2 className="text-lg font-bold text-gray-900">{data.name}</h2>
            <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${
              data.type === "pi" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
            }`}>
              {data.type === "pi" ? "PI Level" : "Project Level"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {errorCount > 0 && (
            <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-1 rounded-full">
              {errorCount} issue{errorCount !== 1 ? "s" : ""}
            </span>
          )}
          <button
            onClick={() => onValidate(data.id)}
            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-md transition-colors"
          >
            Validate
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-1.5 rounded-md transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap">
        {RACI_VALUES.map((v) => {
          const s = RACI_COLORS[v];
          return (
            <span key={v} className={`text-[10px] font-bold px-2 py-1 rounded ${s.bg} ${s.text}`}>
              {v} = {s.label}
            </span>
          );
        })}
        <span className="text-[10px] text-gray-400 ml-2">Click cells to cycle through values</span>
      </div>

      {/* Validation results */}
      {validation && <ValidationPanel {...validation} />}

      {/* Matrix grid */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 min-w-[200px] sticky left-0 bg-gray-50 z-10">
                Activity
              </th>
              {data.roles.map((role) => (
                <th key={role.id} className="text-center px-2 py-3 min-w-[70px]">
                  {editingRole === role.id ? (
                    <input
                      autoFocus
                      defaultValue={role.name}
                      onBlur={(e) => renameRole(role.id, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && renameRole(role.id, e.target.value)}
                      className="text-[10px] text-center w-full px-1 py-0.5 border border-blue-300 rounded"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <span
                        className="text-[10px] font-semibold text-gray-700 cursor-pointer hover:text-blue-600"
                        onClick={() => setEditingRole(role.id)}
                        title="Click to rename"
                      >
                        {role.name}
                      </span>
                      <button
                        onClick={() => removeRole(role.id)}
                        className="text-[8px] text-gray-300 hover:text-red-500 transition-colors"
                        title="Remove role"
                      >
                        remove
                      </button>
                    </div>
                  )}
                </th>
              ))}
              {/* Add role column */}
              <th className="px-2 py-3 min-w-[100px]">
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addRole()}
                    placeholder="+ Role"
                    className="text-[10px] w-16 px-1.5 py-1 border border-gray-200 rounded focus:outline-none focus:border-blue-400"
                  />
                  <button onClick={addRole} disabled={!newRoleName.trim()} className="text-[10px] text-blue-600 hover:text-blue-800 disabled:text-gray-300">
                    +
                  </button>
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.activities.map((act) => {
              const hasIssue = rowIssues[act.id];
              return (
                <tr key={act.id} className={hasIssue ? "bg-red-50/30" : "hover:bg-gray-50/50"}>
                  <td className={`px-4 py-2 sticky left-0 z-10 ${hasIssue ? "bg-red-50/50" : "bg-white"}`}>
                    <div className="flex items-center gap-2">
                      {editingActivity === act.id ? (
                        <input
                          autoFocus
                          defaultValue={act.name}
                          onBlur={(e) => renameActivity(act.id, e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && renameActivity(act.id, e.target.value)}
                          className="text-xs w-full px-2 py-1 border border-blue-300 rounded"
                        />
                      ) : (
                        <>
                          <span
                            className="text-xs text-gray-800 cursor-pointer hover:text-blue-600 flex-1"
                            onClick={() => setEditingActivity(act.id)}
                            title="Click to rename"
                          >
                            {act.name}
                          </span>
                          {hasIssue && (
                            <span className="text-[8px] text-red-500 shrink-0" title={hasIssue.join(", ")}>
                              {hasIssue.length} issue{hasIssue.length > 1 ? "s" : ""}
                            </span>
                          )}
                          <button
                            onClick={() => removeActivity(act.id)}
                            className="text-[8px] text-gray-300 hover:text-red-500 shrink-0 transition-colors"
                            title="Remove activity"
                          >
                            x
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                  {data.roles.map((role) => (
                    <td key={role.id} className="text-center px-2 py-2">
                      <RaciCell
                        value={data.assignments[`${act.id}:${role.id}`] || null}
                        onChange={(val) => handleCellChange(act.id, role.id, val)}
                        activityName={act.name}
                        roleName={role.name}
                      />
                    </td>
                  ))}
                  <td />
                </tr>
              );
            })}
            {/* Add activity row */}
            <tr className="bg-gray-50/50">
              <td className="px-4 py-2 sticky left-0 bg-gray-50/50 z-10">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newActivityName}
                    onChange={(e) => setNewActivityName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addActivity()}
                    placeholder="+ Add activity..."
                    className="text-xs flex-1 px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:border-blue-400"
                  />
                  <button onClick={addActivity} disabled={!newActivityName.trim()} className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-300 font-medium">
                    Add
                  </button>
                </div>
              </td>
              {data.roles.map((r) => <td key={r.id} />)}
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {/* AI Coach */}
      <AiCoachPanel
        context="RACI Matrix Editor"
        data={{ matrix: data }}
        prompts={AI_PROMPTS}
        title="RACI Coach"
      />
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────

export default function RaciPage() {
  const { defaultJql } = useAppConfig();
  const [matrices, setMatrices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [validation, setValidation] = useState(null);
  const [suggesting, setSuggesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchRaciMatrices();
      setMatrices(list);
    } catch (err) {
      toast.error("Failed to load RACI matrices: " + err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedMatrix = useMemo(() => matrices.find((m) => m.id === selectedId), [matrices, selectedId]);

  const handleCreate = async (template) => {
    try {
      const created = await saveRaciMatrix({ template });
      setMatrices((prev) => [created, ...prev]);
      setSelectedId(created.id);
      toast.success(`Created ${created.name}`);
    } catch (err) {
      toast.error("Failed to create: " + err.message);
    }
  };

  const handleSave = async (matrix) => {
    const saved = await saveRaciMatrix(matrix);
    setMatrices((prev) => prev.map((m) => (m.id === saved.id ? saved : m)));
    return saved;
  };

  const handleDelete = async (id) => {
    try {
      await deleteRaciMatrix(id);
      setMatrices((prev) => prev.filter((m) => m.id !== id));
      if (selectedId === id) setSelectedId(null);
      toast.success("Matrix deleted");
    } catch (err) {
      toast.error("Failed to delete: " + err.message);
    }
  };

  const handleValidate = async (id) => {
    try {
      const result = await validateRaciMatrix(id);
      setValidation(result);
      if (result.valid) toast.success(`Valid! Score: ${result.score}/100`);
      else toast.error(`${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
    } catch (err) {
      toast.error("Validation failed: " + err.message);
    }
  };

  const handleSuggest = async () => {
    setSuggesting(true);
    try {
      const suggested = await suggestRaci(defaultJql);
      setMatrices((prev) => [suggested, ...prev]);
      setSelectedId(suggested.id);
      toast.success(`Suggested RACI from ${suggested.insights?.totalIssues || 0} Jira issues`);
    } catch (err) {
      toast.error("Failed to suggest: " + err.message);
    }
    setSuggesting(false);
  };

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900">RACI Matrix</h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Define who is Responsible, Accountable, Consulted, and Informed for each activity
              </p>
            </div>
            {!selectedId && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSuggest}
                  disabled={suggesting}
                  className="text-xs bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-3 py-1.5 rounded-md transition-colors"
                >
                  {suggesting ? "Analyzing Jira..." : "Suggest from Jira"}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-6 space-y-6">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-blue-200 border-t-blue-600 rounded-full" />
          </div>
        )}

        {/* Matrix Editor */}
        {selectedMatrix && (
          <MatrixEditor
            key={selectedMatrix.id}
            matrix={selectedMatrix}
            onSave={handleSave}
            onBack={() => { setSelectedId(null); setValidation(null); }}
            onValidate={handleValidate}
            validation={validation}
          />
        )}

        {/* List View */}
        {!loading && !selectedId && (
          <>
            {/* Create buttons */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleCreate("agile-default")}
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New Project RACI
              </button>
              {/* PI RACI template not available in opensource version */}
            </div>

            {/* Matrix cards */}
            {matrices.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {matrices.map((m) => {
                  const actCount = m.activities?.length || 0;
                  const roleCount = m.roles?.length || 0;
                  const assignCount = Object.values(m.assignments || {}).filter(Boolean).length;
                  const totalCells = actCount * roleCount;
                  const fillPct = totalCells > 0 ? Math.round((assignCount / totalCells) * 100) : 0;

                  return (
                    <div
                      key={m.id}
                      className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
                      onClick={() => setSelectedId(m.id)}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="text-sm font-bold text-gray-900">{m.name}</h3>
                          <span className={`text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded-full ${
                            m.type === "pi" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                          }`}>
                            {m.type === "pi" ? "PI Level" : "Project"}
                          </span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <span className="text-lg font-bold text-gray-800">{actCount}</span>
                          <p className="text-[9px] text-gray-500">Activities</p>
                        </div>
                        <div>
                          <span className="text-lg font-bold text-gray-800">{roleCount}</span>
                          <p className="text-[9px] text-gray-500">Roles</p>
                        </div>
                        <div>
                          <span className="text-lg font-bold" style={{ color: fillPct >= 80 ? "#22c55e" : fillPct >= 50 ? "#f59e0b" : "#ef4444" }}>
                            {fillPct}%
                          </span>
                          <p className="text-[9px] text-gray-500">Filled</p>
                        </div>
                      </div>

                      <div className="mt-3 w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-1.5 rounded-full transition-all"
                          style={{ width: `${fillPct}%`, backgroundColor: fillPct >= 80 ? "#22c55e" : fillPct >= 50 ? "#f59e0b" : "#ef4444" }}
                        />
                      </div>

                      <p className="text-[10px] text-gray-400 mt-2">
                        Updated {new Date(m.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Empty state */}
            {matrices.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <svg className="mx-auto w-16 h-16 mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M3 6h18M3 18h18" />
                </svg>
                <p className="text-lg font-medium text-gray-500 mb-2">No RACI matrices yet</p>
                <p className="text-sm mb-4">Create a project or PI-level RACI matrix to define team accountability.</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
