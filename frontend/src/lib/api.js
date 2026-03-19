const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3011";

export async function fetchIssues(jql) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  const res = await fetch(`${API_URL}/issues?${params}`);
  if (!res.ok) throw new Error("Failed to fetch issues");
  return res.json();
}

export async function fetchInsightsSummaries() {
  const res = await fetch(`${API_URL}/insights/summaries`);
  if (!res.ok) throw new Error("Failed to fetch AI summaries");
  return res.json();
}

export async function fetchBoardSummary() {
  const res = await fetch(`${API_URL}/insights/board-summary`);
  if (!res.ok) throw new Error("Failed to fetch board summary");
  return res.json();
}

export async function fetchEpicDetail(epicKey) {
  const res = await fetch(`${API_URL}/epic/${encodeURIComponent(epicKey)}`);
  if (!res.ok) throw new Error("Failed to fetch epic details");
  return res.json();
}

export async function fetchFilters() {
  const res = await fetch(`${API_URL}/filters`);
  if (!res.ok) throw new Error("Failed to fetch filters");
  return res.json();
}

export async function fetchAnalytics(jql) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  const res = await fetch(`${API_URL}/analytics?${params}`);
  if (!res.ok) throw new Error("Failed to fetch analytics");
  return res.json();
}

export async function fetchSettings() {
  const res = await fetch(`${API_URL}/settings`);
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export async function updateSettings(settings) {
  const res = await fetch(`${API_URL}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error("Failed to update settings");
  return res.json();
}

export async function fetchHierarchy(jql) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  const res = await fetch(`${API_URL}/hierarchy?${params}`);
  if (!res.ok) throw new Error("Failed to fetch hierarchy");
  return res.json();
}

export async function fetchRetroSessions() {
  const res = await fetch(`${API_URL}/retro/sessions`);
  if (!res.ok) throw new Error("Failed to fetch retro sessions");
  return res.json();
}

export async function createRetroSession(title) {
  const res = await fetch(`${API_URL}/retro/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to create retro session");
  return res.json();
}

export async function fetchRetroSession(id) {
  const res = await fetch(`${API_URL}/retro/sessions/${id}`);
  if (!res.ok) throw new Error("Failed to fetch retro session");
  return res.json();
}

export async function addRetroEntry(sessionId, entry) {
  const res = await fetch(`${API_URL}/retro/sessions/${sessionId}/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error("Failed to add retro entry");
  return res.json();
}

export async function voteRetroEntry(sessionId, entryId) {
  const res = await fetch(`${API_URL}/retro/sessions/${sessionId}/entries/${entryId}/vote`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to vote");
  return res.json();
}

export async function deleteRetroSession(id) {
  const res = await fetch(`${API_URL}/retro/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete retro session");
  return res.json();
}

export async function fetchConfig() {
  const res = await fetch(`${API_URL}/config`);
  if (!res.ok) throw new Error("Failed to fetch config");
  return res.json();
}

export async function updateConfig(config) {
  const res = await fetch(`${API_URL}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error("Failed to update config");
  return res.json();
}

export async function fetchPiOverview({ jql, filter, sprint } = {}) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  if (filter) params.set("filter", filter);
  if (sprint) params.set("sprint", sprint);
  const res = await fetch(`${API_URL}/pi/overview?${params}`);
  if (!res.ok) throw new Error("Failed to fetch PI overview");
  return res.json();
}

export async function fetchPiTeam(teamId, jql) {
  const params = new URLSearchParams();
  if (jql) params.set("jql", jql);
  const res = await fetch(`${API_URL}/pi/team/${teamId}?${params}`);
  if (!res.ok) throw new Error("Failed to fetch team data");
  return res.json();
}

export async function fetchPiFollowUps() {
  const res = await fetch(`${API_URL}/pi/follow-ups`);
  if (!res.ok) throw new Error("Failed to fetch follow-ups");
  return res.json();
}

export async function fetchProjectCompliance() {
  const res = await fetch(`${API_URL}/compliance/projects`);
  if (!res.ok) throw new Error("Failed to fetch project compliance");
  return res.json();
}

export async function fetchPiCompliance() {
  const res = await fetch(`${API_URL}/compliance/pi`);
  if (!res.ok) throw new Error("Failed to fetch PI compliance");
  return res.json();
}

export async function fetchProgramBoard(project) {
  const params = new URLSearchParams();
  if (project) params.set("project", project);
  const res = await fetch(`${API_URL}/pi/program-board?${params}`);
  if (!res.ok) throw new Error("Failed to fetch program board");
  return res.json();
}

export async function fetchQuickQueries() {
  const res = await fetch(`${API_URL}/quick-queries`);
  if (!res.ok) throw new Error("Failed to fetch quick queries");
  return res.json();
}

export async function fetchBookmarks() {
  const res = await fetch(`${API_URL}/bookmarks`);
  if (!res.ok) throw new Error("Failed to fetch bookmarks");
  return res.json();
}

export async function createBookmark(name, jql) {
  const res = await fetch(`${API_URL}/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, jql }),
  });
  if (!res.ok) throw new Error("Failed to create bookmark");
  return res.json();
}

export async function deleteBookmark(id) {
  const res = await fetch(`${API_URL}/bookmarks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete bookmark");
  return res.json();
}
