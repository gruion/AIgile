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
