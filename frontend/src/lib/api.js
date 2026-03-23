const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3011";

// ─── Simple fetch wrapper (no auth) ─────────────────────
export async function apiFetch(url, opts = {}) {
  return fetch(url, opts);
}

// Helper: read error detail from API JSON response body
async function throwApiError(res, fallback) {
  let detail = fallback;
  try {
    const body = await res.json();
    const parts = [body.error || fallback];
    if (body.server) parts.push(`Server: ${body.server}`);
    if (body.serverUrl) parts.push(`URL: ${body.serverUrl}`);
    if (body.jql) parts.push(`JQL: ${body.jql}`);
    detail = parts.join(" | ");
  } catch {
    // response wasn't JSON — use fallback
  }
  throw new Error(detail);
}

export async function testConnection({ url, username, token, serverId }) {
  const res = await apiFetch(`${API_URL}/config/test-connection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, username, token, serverId }),
  });
  if (!res.ok) await throwApiError(res, "Failed to reach API");
  return res.json();
}

export async function fetchConfigStatus() {
  const res = await apiFetch(`${API_URL}/config/status`);
  if (!res.ok) await throwApiError(res, "Failed to fetch config status");
  return res.json();
}

export async function fetchIssues(jql, serverId) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  if (serverId) params.set("serverId", serverId);
  const res = await apiFetch(`${API_URL}/issues?${params}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch issues");
  return res.json();
}

export async function fetchEpicDetail(epicKey) {
  const res = await apiFetch(`${API_URL}/epic/${encodeURIComponent(epicKey)}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch epic details");
  return res.json();
}

export async function fetchIssueDetail(issueKey) {
  const res = await apiFetch(`${API_URL}/issue/${encodeURIComponent(issueKey)}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch issue details");
  return res.json();
}

export async function fetchFilters() {
  const res = await apiFetch(`${API_URL}/filters`);
  if (!res.ok) await throwApiError(res, "Failed to fetch filters");
  return res.json();
}

export async function fetchAnalytics(jql) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  const res = await apiFetch(`${API_URL}/analytics?${params}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch analytics");
  return res.json();
}

export async function fetchSettings() {
  const res = await apiFetch(`${API_URL}/settings`);
  if (!res.ok) await throwApiError(res, "Failed to fetch settings");
  return res.json();
}

export async function updateSettings(settings) {
  const res = await apiFetch(`${API_URL}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) await throwApiError(res, "Failed to update settings");
  return res.json();
}

export async function fetchHierarchy(jql) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  const res = await apiFetch(`${API_URL}/hierarchy?${params}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch hierarchy");
  return res.json();
}

export async function fetchRetroSessions() {
  const res = await apiFetch(`${API_URL}/retro/sessions`);
  if (!res.ok) await throwApiError(res, "Failed to fetch retro sessions");
  return res.json();
}

export async function createRetroSession(title) {
  const res = await apiFetch(`${API_URL}/retro/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) await throwApiError(res, "Failed to create retro session");
  return res.json();
}

export async function fetchRetroSession(id) {
  const res = await apiFetch(`${API_URL}/retro/sessions/${id}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch retro session");
  return res.json();
}

export async function addRetroEntry(sessionId, entry) {
  const res = await apiFetch(`${API_URL}/retro/sessions/${sessionId}/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  if (!res.ok) await throwApiError(res, "Failed to add retro entry");
  return res.json();
}

export async function voteRetroEntry(sessionId, entryId) {
  const res = await apiFetch(`${API_URL}/retro/sessions/${sessionId}/entries/${entryId}/vote`, {
    method: "POST",
  });
  if (!res.ok) await throwApiError(res, "Failed to vote");
  return res.json();
}

export async function deleteRetroSession(id) {
  const res = await apiFetch(`${API_URL}/retro/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) await throwApiError(res, "Failed to delete retro session");
  return res.json();
}

export async function fetchConfig() {
  const res = await apiFetch(`${API_URL}/config`);
  if (!res.ok) await throwApiError(res, "Failed to fetch config");
  return res.json();
}

export async function updateConfig(config) {
  const res = await apiFetch(`${API_URL}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) await throwApiError(res, "Failed to update config");
  return res.json();
}

export async function importConfig(configJson) {
  const res = await apiFetch(`${API_URL}/config/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(configJson),
  });
  if (!res.ok) await throwApiError(res, "Failed to import config");
  return res.json();
}

export async function fetchProjectCompliance(jql) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  const res = await apiFetch(`${API_URL}/compliance/projects?${params}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch project compliance");
  return res.json();
}

export async function fetchQuickQueries() {
  const res = await apiFetch(`${API_URL}/quick-queries`);
  if (!res.ok) await throwApiError(res, "Failed to fetch quick queries");
  return res.json();
}

export async function fetchBookmarks() {
  const res = await apiFetch(`${API_URL}/bookmarks`);
  if (!res.ok) await throwApiError(res, "Failed to fetch bookmarks");
  return res.json();
}

export async function createBookmark(name, jql) {
  const res = await apiFetch(`${API_URL}/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, jql }),
  });
  if (!res.ok) await throwApiError(res, "Failed to create bookmark");
  return res.json();
}

export async function deleteBookmark(id) {
  const res = await apiFetch(`${API_URL}/bookmarks/${id}`, { method: "DELETE" });
  if (!res.ok) await throwApiError(res, "Failed to delete bookmark");
  return res.json();
}

// ─── Sprint & Velocity ──────────────────────────────────

export async function fetchSprints() {
  const res = await apiFetch(`${API_URL}/sprints`);
  if (!res.ok) await throwApiError(res, "Failed to fetch sprints");
  return res.json();
}

export async function fetchBurndown(sprintId, jql) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  const res = await apiFetch(`${API_URL}/sprints/${sprintId}/burndown?${params}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch burndown");
  return res.json();
}

export async function fetchVelocity(jql) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  const res = await apiFetch(`${API_URL}/velocity?${params}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch velocity");
  return res.json();
}

// ─── Flow Metrics ────────────────────────────────────────

export async function fetchCFD(jql, days) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  if (days) params.set("days", days);
  const res = await apiFetch(`${API_URL}/flow/cfd?${params}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch CFD");
  return res.json();
}

export async function fetchCycleTime(jql) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  const res = await apiFetch(`${API_URL}/flow/cycle-time?${params}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch cycle time");
  return res.json();
}

export async function fetchFlowMetrics(jql) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  const res = await apiFetch(`${API_URL}/flow/metrics?${params}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch flow metrics");
  return res.json();
}

// ─── Standup ─────────────────────────────────────────────

export async function fetchStandup(hours, jql) {
  const params = new URLSearchParams();
  if (hours) params.set("hours", hours);
  if (jql) params.set("jql", jql);
  const res = await apiFetch(`${API_URL}/standup?${params}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch standup data");
  return res.json();
}

// ─── Sprint Review ───────────────────────────────────────

export async function fetchSprintReview(jql) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  const res = await apiFetch(`${API_URL}/sprint-review?${params}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch sprint review");
  return res.json();
}

// ─── Definition of Ready ─────────────────────────────────

export async function fetchDoR(jql) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  const res = await apiFetch(`${API_URL}/dor?${params}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch DoR");
  return res.json();
}

// ─── ROAM Risk Board ─────────────────────────────────────

export async function fetchRoamRisks() {
  const res = await apiFetch(`${API_URL}/roam/risks`);
  if (!res.ok) await throwApiError(res, "Failed to fetch risks");
  return res.json();
}

export async function saveRoamRisk(risk) {
  const res = await apiFetch(`${API_URL}/roam/risks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(risk),
  });
  if (!res.ok) await throwApiError(res, "Failed to save risk");
  return res.json();
}

export async function deleteRoamRisk(id) {
  const res = await apiFetch(`${API_URL}/roam/risks/${id}`, { method: "DELETE" });
  if (!res.ok) await throwApiError(res, "Failed to delete risk");
  return res.json();
}

// ─── Team Health Check ───────────────────────────────────

export async function fetchHealthCheckSessions() {
  const res = await apiFetch(`${API_URL}/health-check/sessions`);
  if (!res.ok) await throwApiError(res, "Failed to fetch health check sessions");
  return res.json();
}

export async function createHealthCheckSession(title) {
  const res = await apiFetch(`${API_URL}/health-check/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) await throwApiError(res, "Failed to create health check session");
  return res.json();
}

export async function fetchHealthCheckSession(id) {
  const res = await apiFetch(`${API_URL}/health-check/sessions/${id}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch health check session");
  return res.json();
}

export async function voteHealthCheck(sessionId, vote) {
  const res = await apiFetch(`${API_URL}/health-check/sessions/${sessionId}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(vote),
  });
  if (!res.ok) await throwApiError(res, "Failed to vote");
  return res.json();
}

export async function deleteHealthCheckSession(id) {
  const res = await apiFetch(`${API_URL}/health-check/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) await throwApiError(res, "Failed to delete health check session");
  return res.json();
}

// ─── Sprint Goals ────────────────────────────────────────

export async function fetchSprintGoals() {
  const res = await apiFetch(`${API_URL}/sprint-goals`);
  if (!res.ok) await throwApiError(res, "Failed to fetch sprint goals");
  return res.json();
}

export async function saveSprintGoals(goalSet) {
  const res = await apiFetch(`${API_URL}/sprint-goals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(goalSet),
  });
  if (!res.ok) await throwApiError(res, "Failed to save sprint goals");
  return res.json();
}

export async function deleteSprintGoals(id) {
  const res = await apiFetch(`${API_URL}/sprint-goals/${id}`, { method: "DELETE" });
  if (!res.ok) await throwApiError(res, "Failed to delete sprint goals");
  return res.json();
}

// ─── AI Provider Settings ────────────────────────────────

export async function fetchAiSettings() {
  const res = await apiFetch(`${API_URL}/settings/ai`);
  if (!res.ok) await throwApiError(res, "Failed to fetch AI settings");
  return res.json();
}

export async function updateAiSettings(settings) {
  const res = await apiFetch(`${API_URL}/settings/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) await throwApiError(res, "Failed to save AI settings");
  return res.json();
}

// ─── AI Coach ────────────────────────────────────────────

export async function askAiCoach(context, question, data) {
  const res = await apiFetch(`${API_URL}/ai/coach`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context, question, data }),
  });
  if (!res.ok) await throwApiError(res, "Failed to get AI coach response");
  return res.json();
}

// ─── Dependencies ────────────────────────────────────────

export async function fetchDependencies(jql) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  const res = await apiFetch(`${API_URL}/dependencies?${params}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch dependencies");
  return res.json();
}

export async function discoverDependencies(projects) {
  const res = await apiFetch(`${API_URL}/dependencies/discover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projects }),
  });
  if (!res.ok) await throwApiError(res, "Failed to discover dependencies");
  return res.json();
}
