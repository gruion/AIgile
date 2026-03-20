"use client";

import { useState, useEffect } from "react";
import { fetchSprintGoals, saveSprintGoals, deleteSprintGoals, fetchSprints } from "../../lib/api";
import AiCoachPanel from "../../components/AiCoachPanel";
import JqlBar from "../../components/JqlBar";
import { toast } from "../../components/Toaster";

const GOAL_STATUSES = [
  { value: "not_started", label: "Not Started", color: "bg-gray-100 text-gray-600", ring: "#9ca3af" },
  { value: "in_progress", label: "In Progress", color: "bg-blue-100 text-blue-700", ring: "#3b82f6" },
  { value: "achieved", label: "Achieved", color: "bg-green-100 text-green-700", ring: "#22c55e" },
  { value: "missed", label: "Missed", color: "bg-red-100 text-red-700", ring: "#ef4444" },
];

function getStatusMeta(status) {
  return GOAL_STATUSES.find((s) => s.value === status) || GOAL_STATUSES[0];
}

function ProgressRing({ achieved, total, size = 56 }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const pct = total > 0 ? achieved / total : 0;
  const offset = circ - pct * circ;
  const color = pct >= 0.8 ? "#22c55e" : pct >= 0.5 ? "#3b82f6" : pct >= 0.25 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth="4" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700"
        />
      </svg>
      <span className="absolute text-xs font-bold" style={{ color }}>
        {achieved}/{total}
      </span>
    </div>
  );
}

function GoalForm({ sprints, initialData, onSave, onCancel, saving }) {
  const [sprintName, setSprintName] = useState(initialData?.sprintName || "");
  const [goals, setGoals] = useState(
    initialData?.goals?.map((g) => ({ ...g })) || [{ id: crypto.randomUUID(), text: "", status: "not_started", linkedIssues: "", notes: "" }]
  );

  const addGoal = () => {
    setGoals([...goals, { id: crypto.randomUUID(), text: "", status: "not_started", linkedIssues: "", notes: "" }]);
  };

  const removeGoal = (idx) => {
    if (goals.length <= 1) return;
    setGoals(goals.filter((_, i) => i !== idx));
  };

  const updateGoal = (idx, field, value) => {
    const updated = [...goals];
    updated[idx] = { ...updated[idx], [field]: value };
    setGoals(updated);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!sprintName.trim()) {
      toast.error("Please enter a sprint name");
      return;
    }
    if (goals.every((g) => !g.text.trim())) {
      toast.error("Add at least one goal");
      return;
    }
    const cleaned = goals
      .filter((g) => g.text.trim())
      .map((g) => ({
        ...g,
        text: g.text.trim(),
        linkedIssues: typeof g.linkedIssues === "string"
          ? g.linkedIssues.split(",").map((s) => s.trim()).filter(Boolean)
          : g.linkedIssues || [],
      }));
    onSave({ id: initialData?.id, sprintName: sprintName.trim(), goals: cleaned });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">
        {initialData?.id ? "Edit Goal Set" : "New Goal Set"}
      </h3>

      {/* Sprint selector */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Sprint</label>
        <input
          type="text"
          list="sprint-options"
          value={sprintName}
          onChange={(e) => setSprintName(e.target.value)}
          placeholder="Type or select a sprint name..."
          className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        {sprints.length > 0 && (
          <datalist id="sprint-options">
            {sprints.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name} {s.state === "active" ? "(Active)" : s.state === "closed" ? "(Closed)" : ""}
              </option>
            ))}
          </datalist>
        )}
      </div>

      {/* Goals list */}
      <div className="space-y-3">
        <label className="text-xs text-gray-500 block">Goals</label>
        {goals.map((goal, idx) => (
          <div key={goal.id} className="flex items-start gap-2 bg-gray-50 rounded-lg p-3 border border-gray-100">
            <span className="text-xs text-gray-400 font-mono mt-2">{idx + 1}.</span>
            <div className="flex-1 space-y-2">
              <input
                type="text"
                value={goal.text}
                onChange={(e) => updateGoal(idx, "text", e.target.value)}
                placeholder="Goal description..."
                className="text-sm bg-white border border-gray-200 rounded-lg px-3 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <input
                type="text"
                value={typeof goal.linkedIssues === "string" ? goal.linkedIssues : (goal.linkedIssues || []).join(", ")}
                onChange={(e) => updateGoal(idx, "linkedIssues", e.target.value)}
                placeholder="Linked issues (comma-separated, e.g. PROJ-1, PROJ-2)"
                className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-gray-500"
              />
            </div>
            <button
              type="button"
              onClick={() => removeGoal(idx)}
              className="text-xs text-red-400 hover:text-red-600 mt-2 px-1"
              title="Remove goal"
            >
              &times;
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addGoal}
          className="text-xs text-blue-600 hover:text-blue-800 px-1"
        >
          + Add goal
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function GoalCard({ goalSet, onEdit, onDelete, onStatusChange, deleting }) {
  const achievedCount = goalSet.goals.filter((g) => g.status === "achieved").length;
  const totalCount = goalSet.goals.length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-gray-800">{goalSet.sprintName}</h4>
          {goalSet.createdAt && (
            <p className="text-[10px] text-gray-400 mt-0.5">
              Created {new Date(goalSet.createdAt).toLocaleDateString()}
              {goalSet.updatedAt && goalSet.updatedAt !== goalSet.createdAt && (
                <> &middot; Updated {new Date(goalSet.updatedAt).toLocaleDateString()}</>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ProgressRing achieved={achievedCount} total={totalCount} />
          <div className="flex items-center gap-1">
            <button
              onClick={() => onEdit(goalSet)}
              className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50"
            >
              Edit
            </button>
            <button
              onClick={() => onDelete(goalSet.id)}
              disabled={deleting}
              className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Goals */}
      <div className="px-5 py-3 space-y-2.5">
        {goalSet.goals.map((goal) => {
          const meta = getStatusMeta(goal.status);
          return (
            <div key={goal.id} className="flex items-start gap-3 py-1.5">
              {/* Status indicator dot */}
              <div
                className="w-3 h-3 rounded-full mt-0.5 shrink-0"
                style={{ backgroundColor: meta.ring }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800">{goal.text}</p>
                {/* Linked issues */}
                {goal.linkedIssues && goal.linkedIssues.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(Array.isArray(goal.linkedIssues) ? goal.linkedIssues : [goal.linkedIssues]).map((issue, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-mono text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 cursor-pointer hover:bg-blue-100"
                      >
                        {issue}
                      </span>
                    ))}
                  </div>
                )}
                {goal.notes && (
                  <p className="text-[10px] text-gray-400 mt-1">{goal.notes}</p>
                )}
              </div>
              {/* Status dropdown */}
              <select
                value={goal.status}
                onChange={(e) => onStatusChange(goalSet.id, goal.id, e.target.value)}
                className={`text-[10px] font-medium px-2 py-1 rounded-lg border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${meta.color}`}
              >
                {GOAL_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SprintGoalsPage() {
  const [goalSets, setGoalSets] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingGoalSet, setEditingGoalSet] = useState(null);
  const [jql, setJql] = useState("");
  const [inputJql, setInputJql] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const goalsData = await fetchSprintGoals();
      setGoalSets(goalsData);
      toast.success("Sprint goals loaded");
    } catch (err) {
      setError(err.message);
      toast.error("Failed to load sprint goals");
    }
    // Sprints fetch is optional — board may not support sprints
    try {
      const sprintsData = await fetchSprints();
      setSprints(sprintsData.sprints || []);
    } catch {
      setSprints([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async (formData) => {
    setSaving(true);
    try {
      await saveSprintGoals(formData);
      toast.success(formData.id ? "Goal set updated" : "Goal set created");
      setShowForm(false);
      setEditingGoalSet(null);
      await load();
    } catch (err) {
      toast.error("Failed to save: " + err.message);
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this goal set?")) return;
    setDeleting(true);
    try {
      await deleteSprintGoals(id);
      toast.success("Goal set deleted");
      await load();
    } catch (err) {
      toast.error("Failed to delete: " + err.message);
    }
    setDeleting(false);
  };

  const handleEdit = (goalSet) => {
    setEditingGoalSet(goalSet);
    setShowForm(true);
  };

  const handleStatusChange = async (goalSetId, goalId, newStatus) => {
    // Optimistic update
    setGoalSets((prev) =>
      prev.map((gs) => {
        if (gs.id !== goalSetId) return gs;
        return {
          ...gs,
          goals: gs.goals.map((g) => (g.id === goalId ? { ...g, status: newStatus } : g)),
        };
      })
    );
    try {
      const goalSet = goalSets.find((gs) => gs.id === goalSetId);
      if (!goalSet) return;
      const updatedGoals = goalSet.goals.map((g) =>
        g.id === goalId ? { ...g, status: newStatus } : g
      );
      await saveSprintGoals({ ...goalSet, goals: updatedGoals });
    } catch (err) {
      toast.error("Failed to update status");
      await load();
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingGoalSet(null);
  };

  const aiPrompts = [
    {
      label: "Goal assessment",
      question:
        "Assess our sprint goal achievement rate. Are we setting the right goals?",
    },
    {
      label: "Goal quality",
      question:
        "Are these sprint goals well-formed? Rate them using SMART criteria.",
    },
    {
      label: "Improvement plan",
      question:
        "How can we improve our goal-setting and achievement process?",
    },
    {
      label: "Missed goals analysis",
      question:
        "Analyze missed goals. What patterns do you see and how do we address them?",
    },
  ];

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-900">Sprint Goals</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={load}
                disabled={loading}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-md disabled:opacity-50"
              >
                Refresh
              </button>
              <button
                onClick={() => {
                  setEditingGoalSet(null);
                  setShowForm(true);
                }}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md"
              >
                New Goal Set
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-4 pt-4">
        <JqlBar value={inputJql} onChange={setInputJql} onSubmit={(q) => setJql(q)} />
      </div>

      <main className="max-w-[1600px] mx-auto px-4 py-6 space-y-6">
        {/* AI Coach */}
        {!loading && goalSets.length > 0 && (
          <div className="mb-4">
            <AiCoachPanel
              context="Sprint Goal Tracker"
              data={goalSets}
              prompts={aiPrompts}
            />
          </div>
        )}

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

        {/* Create / Edit form */}
        {showForm && (
          <GoalForm
            sprints={sprints}
            initialData={editingGoalSet}
            onSave={handleSave}
            onCancel={handleCancel}
            saving={saving}
          />
        )}

        {/* Goal Status Legend */}
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="font-medium text-gray-600">Status:</span>
          {GOAL_STATUSES.map((s) => (
            <span key={s.value} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.ring }} />
              {s.label}
            </span>
          ))}
        </div>

        {/* Goal sets */}
        {!loading && (
          <div className="space-y-4">
            {goalSets.length > 0 ? (
              goalSets.map((gs) => (
                <GoalCard
                  key={gs.id}
                  goalSet={gs}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onStatusChange={handleStatusChange}
                  deleting={deleting}
                />
              ))
            ) : (
              !showForm && (
                <div className="text-center py-12 text-gray-400 text-sm">
                  No sprint goals yet. Click &quot;New Goal Set&quot; to get started.
                </div>
              )
            )}
          </div>
        )}

      </main>
    </div>
  );
}
