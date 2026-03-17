const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3011";

export async function fetchIssues(jql, maxResults = 100) {
  const params = new URLSearchParams({ jql, maxResults: String(maxResults) });
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
