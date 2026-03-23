"use client";

import { useState, useEffect, useRef } from "react";
import { askAiCoach } from "../lib/api";

/**
 * TicketDiffModal — GitHub-style side-by-side diff view.
 *
 * Shows current ticket fields on the left and suggested updates on the right.
 * Additions are green with (+), removals are red with (-), unchanged fields are gray.
 *
 * Works in two modes:
 * 1. With AI provider: calls AI for rich suggestions, shows diff
 * 2. Without AI provider: generates diff locally from ticket checks/missingItems, shows diff immediately
 */
export default function TicketDiffModal({ ticket, onClose, jiraBaseUrl }) {
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);
  const [aiMode, setAiMode] = useState(false); // true = AI-generated, false = local
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!ticket) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const result = await askAiCoach(
          "Ticket Field Improvement — suggest specific field updates",
          buildDiffPrompt(ticket),
          { ticket }
        );
        if (cancelled) return;

        if (result.answer) {
          const parsed = parseDiffResponse(result.answer);
          if (parsed) {
            setDiff(parsed);
            setAiMode(true);
            setLoading(false);
            return;
          }
        }
      } catch {
        // AI call failed — fall through to local generation
      }

      if (cancelled) return;

      // No AI answer — generate diff locally from ticket data
      setDiff(buildLocalDiff(ticket));
      setAiMode(false);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [ticket]);

  if (!ticket) return null;

  const changedCount = diff ? diff.filter((d) => d.type !== "unchanged").length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-200 w-[95vw] max-w-5xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50 rounded-t-xl shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[9px] font-bold shrink-0">
              AI
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-900">
                Suggested Changes
                <span className="ml-2 font-mono text-blue-600">{ticket.key}</span>
              </h2>
              <p className="text-[11px] text-gray-500 truncate">{ticket.summary}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!aiMode && !loading && (
              <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                Local analysis
              </span>
            )}
            {jiraBaseUrl && (
              <a
                href={`${jiraBaseUrl}/browse/${ticket.key}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-blue-600 hover:text-blue-800 hover:underline"
              >
                Open in Jira
              </a>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg hover:bg-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="animate-spin h-8 w-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full" />
              <span className="text-sm text-gray-500">Analyzing ticket fields...</span>
            </div>
          )}

          {error && (
            <div className="m-5 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <strong>Error:</strong> {error}
            </div>
          )}

          {!loading && diff && diff.length > 0 && (
            <div className="p-5">
              {/* Legend */}
              <div className="flex items-center gap-4 mb-4 text-[11px] flex-wrap">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-red-100 border border-red-300" />
                  <span className="text-gray-600">Current (remove)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-green-100 border border-green-300" />
                  <span className="text-gray-600">Suggested (add)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-gray-50 border border-gray-200" />
                  <span className="text-gray-600">Unchanged</span>
                </span>
                <span className="ml-auto text-gray-400">
                  {changedCount} field{changedCount !== 1 ? "s" : ""} to update
                </span>
              </div>

              {/* Diff table */}
              <div className="border border-gray-200 rounded-lg overflow-hidden text-xs">
                <div className="grid grid-cols-[160px_1fr_1fr] bg-gray-100 border-b border-gray-200">
                  <div className="px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Field</div>
                  <div className="px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-l border-gray-200">Current</div>
                  <div className="px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-l border-gray-200">Suggested</div>
                </div>

                {diff.map((field, i) => (
                  <DiffRow key={i} field={field} onCopy={(text) => handleCopy(text, field.name)} copied={copied === field.name} />
                ))}
              </div>

              {/* Actions */}
              <div className="mt-4 flex items-center justify-between">
                {!aiMode && (
                  <p className="text-[10px] text-gray-400">
                    Configure an AI provider in <a href="/settings" className="text-indigo-500 underline">Settings</a> for richer suggestions.
                  </p>
                )}
                <div className="flex gap-2 ml-auto">
                  <button
                    onClick={() => handleCopyAll(diff)}
                    className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {copied === "__all__" ? "Copied!" : "Copy All Suggestions"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {!loading && (!diff || diff.length === 0) && !error && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <svg className="w-10 h-10 mb-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-green-600">This ticket looks good!</p>
              <p className="text-xs text-gray-400 mt-1">No field improvements needed.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  async function handleCopy(text, name) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(name);
      setTimeout(() => setCopied(null), 2000);
    } catch {}
  }

  async function handleCopyAll(diffRows) {
    const lines = diffRows
      .filter((d) => d.type !== "unchanged")
      .map((d) => `${d.name}:\n${d.suggested}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(lines);
      setCopied("__all__");
      setTimeout(() => setCopied(null), 2000);
    } catch {}
  }
}

// ─── Diff Row ───────────────────────────────────────────

function DiffRow({ field, onCopy, copied }) {
  const isAdd = field.type === "added";
  const isRemove = field.type === "removed";
  const isModify = field.type === "modified";
  const isUnchanged = field.type === "unchanged";

  return (
    <div className={`grid grid-cols-[160px_1fr_1fr] border-b border-gray-100 last:border-b-0 ${isUnchanged ? "bg-white" : ""}`}>
      {/* Field name */}
      <div className={`px-3 py-2.5 flex items-start gap-1.5 ${isUnchanged ? "text-gray-400" : "text-gray-700 font-medium"}`}>
        {isAdd && <span className="text-green-600 font-bold shrink-0">+</span>}
        {isRemove && <span className="text-red-600 font-bold shrink-0">-</span>}
        {isModify && <span className="text-amber-600 font-bold shrink-0">~</span>}
        <span className="text-[11px]">{field.name}</span>
      </div>

      {/* Current value */}
      <div className={`px-3 py-2.5 border-l border-gray-200 ${(isRemove || isModify) ? "bg-red-50" : ""}`}>
        {field.current ? (
          <pre className={`text-[11px] whitespace-pre-wrap break-words leading-relaxed font-mono ${(isRemove || isModify) ? "text-red-800" : "text-gray-600"}`}>
            {(isRemove || isModify)
              ? field.current.split("\n").map((line, j) => (
                  <span key={j} className="block"><span className="text-red-400 select-none mr-1.5">-</span>{line}</span>
                ))
              : field.current
            }
          </pre>
        ) : (
          <span className="text-[11px] text-gray-300 italic">empty</span>
        )}
      </div>

      {/* Suggested value */}
      <div className={`px-3 py-2.5 border-l border-gray-200 ${(isAdd || isModify) ? "bg-green-50" : ""}`}>
        {field.suggested ? (
          <div className="relative group">
            <pre className={`text-[11px] whitespace-pre-wrap break-words leading-relaxed font-mono ${(isAdd || isModify) ? "text-green-800" : "text-gray-600"}`}>
              {(isAdd || isModify)
                ? field.suggested.split("\n").map((line, j) => (
                    <span key={j} className="block"><span className="text-green-500 select-none mr-1.5">+</span>{line}</span>
                  ))
                : field.suggested
              }
            </pre>
            {(isAdd || isModify) && (
              <button
                onClick={() => onCopy(field.suggested)}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-[9px] bg-white border border-gray-200 text-gray-500 hover:text-gray-700 px-1.5 py-0.5 rounded transition-opacity"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-gray-300 italic">{isRemove ? "removed" : "—"}</span>
        )}
      </div>
    </div>
  );
}

// ─── Local Diff Builder (no AI needed) ──────────────────

function buildLocalDiff(ticket) {
  const fields = [];

  // Summary
  const summary = ticket.summary || "";
  if (summary.length < 15 || /^fix |^update |^change /i.test(summary)) {
    fields.push({
      name: "Summary",
      current: summary || "",
      suggested: summary
        ? `${summary}\n\n(Suggestion: Make the summary more specific — include what, where, and why. E.g. "Fix login timeout error when session expires after 30min")`
        : "(Add a clear, specific summary)",
      type: "modified",
    });
  } else {
    fields.push({ name: "Summary", current: summary, suggested: summary, type: "unchanged" });
  }

  // Description
  const desc = ticket.description || "";
  const isMissingDesc = !desc || desc.trim().length < 30;
  const missingList = ticket.missingItems || [];
  const failingChecks = (ticket.checks || []).filter((c) => !c.pass).map((c) => c.label || c.id);

  if (isMissingDesc || missingList.includes("Description")) {
    fields.push({
      name: "Description",
      current: desc || "",
      suggested: desc
        ? `${desc}\n\n## Additional Context\n(Add background information, user impact, and technical details)`
        : "## Summary\n(Describe the problem or feature request)\n\n## Context\n(Why is this needed? What is the user impact?)\n\n## Technical Notes\n(Any implementation details or constraints)",
      type: desc ? "modified" : "added",
    });
  } else {
    fields.push({ name: "Description", current: desc.slice(0, 200) + (desc.length > 200 ? "..." : ""), suggested: desc.slice(0, 200) + (desc.length > 200 ? "..." : ""), type: "unchanged" });
  }

  // Acceptance Criteria
  const hasAC = desc && (/acceptance criteria/i.test(desc) || /given .* when .* then/i.test(desc) || /\[.\]/.test(desc));
  if (!hasAC && (missingList.includes("Acceptance Criteria") || failingChecks.some((c) => /acceptance|criteria|ac/i.test(c)))) {
    fields.push({
      name: "Acceptance Criteria",
      current: "",
      suggested: "## Acceptance Criteria\n\nGiven (precondition)\nWhen (action)\nThen (expected result)\n\n- [ ] Criteria 1\n- [ ] Criteria 2\n- [ ] Edge cases handled",
      type: "added",
    });
  }

  // Story Points / Estimate
  const sp = ticket.storyPoints || ticket.originalEstimate;
  if (!sp && (missingList.includes("Estimate") || failingChecks.some((c) => /estimate|point|size/i.test(c)))) {
    fields.push({
      name: "Story Points",
      current: "",
      suggested: "3\n\n(Suggestion: Estimate based on complexity. Use 1-2 for trivial, 3-5 for medium, 8-13 for large. If >13, consider splitting.)",
      type: "added",
    });
  } else if (sp) {
    const spVal = String(sp);
    if (parseInt(spVal) >= 13) {
      fields.push({
        name: "Story Points",
        current: spVal,
        suggested: `${spVal}\n\n(Warning: This ticket is large (${spVal} pts). Consider splitting into smaller stories.)`,
        type: "modified",
      });
    } else {
      fields.push({ name: "Story Points", current: spVal, suggested: spVal, type: "unchanged" });
    }
  }

  // Priority
  const priority = ticket.priority || "";
  if (priority) {
    fields.push({ name: "Priority", current: priority, suggested: priority, type: "unchanged" });
  }

  // Assignee
  const assignee = ticket.assigneeName || ticket.assignee || "";
  if (!assignee && (missingList.includes("Assignee") || failingChecks.some((c) => /assign/i.test(c)))) {
    fields.push({
      name: "Assignee",
      current: "",
      suggested: "(Assign to a team member before sprint planning)",
      type: "added",
    });
  } else if (assignee) {
    fields.push({ name: "Assignee", current: assignee, suggested: assignee, type: "unchanged" });
  }

  // Due Date
  const dueDate = ticket.dueDate || "";
  if (!dueDate && (missingList.includes("Due Date") || failingChecks.some((c) => /due|date|deadline/i.test(c)))) {
    fields.push({
      name: "Due Date",
      current: "",
      suggested: "(Set a target date based on sprint end date or business deadline)",
      type: "added",
    });
  } else if (dueDate) {
    fields.push({ name: "Due Date", current: dueDate, suggested: dueDate, type: "unchanged" });
  }

  // Labels
  const labels = ticket.labels?.length ? ticket.labels.join(", ") : "";
  if (!labels && failingChecks.some((c) => /label/i.test(c))) {
    fields.push({
      name: "Labels",
      current: "",
      suggested: "(Add labels for categorization: e.g. frontend, backend, bug, tech-debt)",
      type: "added",
    });
  }

  // Too Large (from missingItems)
  if (missingList.includes("Too Large")) {
    fields.push({
      name: "Sizing",
      current: "Oversized — too large for a single sprint",
      suggested: "Split into 2-3 smaller stories:\n- Story 1: (core functionality)\n- Story 2: (edge cases / validation)\n- Story 3: (UI polish / tests)",
      type: "modified",
    });
  }

  // Add any remaining failing checks not covered above
  const coveredPatterns = /description|summary|acceptance|criteria|estimate|point|size|assign|due|date|deadline|label/i;
  for (const check of failingChecks) {
    if (!coveredPatterns.test(check)) {
      fields.push({
        name: check,
        current: "Not met",
        suggested: "(Action needed — review and fix this check)",
        type: "added",
      });
    }
  }

  return fields;
}

// ─── AI Prompt Builder ──────────────────────────────────

function buildDiffPrompt(ticket) {
  const fields = [];
  fields.push(`Ticket: ${ticket.key} — ${ticket.summary}`);
  if (ticket.status) fields.push(`Status: ${ticket.status}`);
  if (ticket.priority) fields.push(`Priority: ${ticket.priority}`);
  if (ticket.assignee || ticket.assigneeName) fields.push(`Assignee: ${ticket.assigneeName || ticket.assignee}`);
  if (ticket.storyPoints) fields.push(`Story Points: ${ticket.storyPoints}`);
  if (ticket.originalEstimate) fields.push(`Estimate: ${ticket.originalEstimate}`);
  if (ticket.dueDate) fields.push(`Due Date: ${ticket.dueDate}`);
  if (ticket.labels?.length) fields.push(`Labels: ${ticket.labels.join(", ")}`);
  fields.push(`Description: ${ticket.description || "(empty)"}`);

  if (ticket.checks) {
    const failing = ticket.checks.filter((c) => !c.pass);
    if (failing.length > 0) fields.push(`Failing checks: ${failing.map((c) => c.label).join(", ")}`);
  }
  if (ticket.missingItems?.length) fields.push(`Missing: ${ticket.missingItems.join(", ")}`);

  return `Analyze this Jira ticket and suggest specific field improvements.

${fields.join("\n")}

Return ONLY valid JSON (no markdown, no fences) with this exact structure:
{
  "fields": [
    {
      "name": "field name (e.g. Summary, Description, Acceptance Criteria, Story Points, Labels, Priority, Due Date)",
      "current": "current value or empty string if missing",
      "suggested": "your suggested value",
      "type": "added | modified | removed | unchanged"
    }
  ]
}

Rules:
- "added" = field was empty/missing and you're adding content
- "modified" = field has content but you're improving it
- "removed" = field should be cleared (rare)
- "unchanged" = field is fine as-is
- For Description: keep existing content, add what's missing
- For Summary: make it more specific and actionable if vague
- For Story Points: suggest a reasonable estimate if missing
- For Acceptance Criteria: add Given/When/Then format
- Include ALL major fields even if unchanged
- Be specific and practical — suggestions should be copy-pasteable into Jira`;
}

// ─── AI Response Parser ─────────────────────────────────

function parseDiffResponse(text) {
  if (!text) return null;
  try {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.fields && Array.isArray(parsed.fields)) {
      return parsed.fields.map((f) => ({
        name: f.name || "Unknown",
        current: f.current || "",
        suggested: f.suggested || "",
        type: f.type || "unchanged",
      }));
    }
    return null;
  } catch {
    return null;
  }
}
