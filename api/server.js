import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

import express from "express";
import cors from "cors";
import crypto from "crypto";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ─── Config ──────────────────────────────────────────────
const PORT = process.env.API_PORT || process.env.PORT || 3011;
const JIRA_BASE_URL = process.env.JIRA_BASE_URL || "";
const JIRA_USERNAME = process.env.JIRA_USERNAME || "";
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN || "";
const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || "";
const DEFAULT_JQL = process.env.JIRA_DEFAULT_JQL || "";

// ─── Persistent Config (file → env vars → defaults) ──────────
const CONFIG_DIR = process.env.CONFIG_DIR || resolve(__dirname, "../data");
const CONFIG_FILE = resolve(CONFIG_DIR, "config.json");

function loadConfigFromFile() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  return null;
}

function saveConfigToFile() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const data = {
      servers: JIRA_SERVERS,
      teams: TEAMS,
      defaultTeamId: DEFAULT_TEAM_ID,
      jqlBookmarks: JQL_BOOKMARKS,
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error("Failed to save config:", err.message);
  }
}

// ─── Multi-Server / Multi-Team Configuration ──────────────
const fileConfig = loadConfigFromFile();
let configSource = "defaults";

let JIRA_SERVERS = [];
let TEAMS = [];
let DEFAULT_TEAM_ID = "";
let JQL_BOOKMARKS = []; // [{ id, name, jql }]
let raciMatrices = {}; // RACI matrix store (in-memory)

if (fileConfig) {
  // Tier 1: persisted config file
  configSource = "file";
  JIRA_SERVERS = fileConfig.servers || [];
  TEAMS = fileConfig.teams || [];
  DEFAULT_TEAM_ID = fileConfig.defaultTeamId ?? "";
  JQL_BOOKMARKS = fileConfig.jqlBookmarks || [];
} else {
  // Tier 2: environment variables
  try { JIRA_SERVERS = JSON.parse(process.env.JIRA_SERVERS || "[]"); } catch { JIRA_SERVERS = []; }
  try { TEAMS = JSON.parse(process.env.TEAMS || "[]"); } catch { TEAMS = []; }
  if (JIRA_SERVERS.length > 0 || TEAMS.length > 0) configSource = "env vars";
}

// Tier 3: defaults if still empty
// Only create default server if env vars provide actual credentials
if (JIRA_SERVERS.length === 0 && JIRA_API_TOKEN) {
  JIRA_SERVERS.push({
    id: "primary", name: "Primary Jira", url: JIRA_BASE_URL,
    username: JIRA_USERNAME, token: JIRA_API_TOKEN,
    projects: [JIRA_PROJECT_KEY], browserUrl: "",
  });
}
if (TEAMS.length === 0 && JIRA_SERVERS.length > 0) {
  TEAMS.push({
    id: "default", name: "Default Team", serverId: JIRA_SERVERS[0].id,
    projectKey: JIRA_SERVERS[0].projects?.[0] || "", boardId: null, color: "#3B82F6",
  });
}

// Check if app needs initial setup
function needsSetup() {
  return JIRA_SERVERS.length === 0 || JIRA_SERVERS.every((s) => !s.token);
}

// Helper: get server config by id
function getServer(serverId) {
  const server = JIRA_SERVERS.find((s) => s.id === serverId) || JIRA_SERVERS[0];
  if (!server) throw new Error("No Jira server configured. Go to Settings to add one.");
  return server;
}

// Helper: strip ORDER BY clause from user-provided JQL before AND-ing
function stripOrderBy(jql) {
  return jql ? jql.replace(/\s+ORDER\s+BY\s+.*/i, "").trim() : jql;
}

// Helper: get browser-accessible URL for a server (for clickable links)
// JIRA_BASE_URL inside Docker is the internal hostname (http://jira:8080).
// JIRA_BROWSER_URL should be set to the external URL reachable from the browser.
const JIRA_BROWSER_URL = process.env.JIRA_BROWSER_URL || process.env.NEXT_PUBLIC_JIRA_BASE_URL || "";
function getBrowserUrl(server) {
  return server.browserUrl || JIRA_BROWSER_URL || server.url || "";
}

// Helper: fetch from a specific server
function jiraHeadersFor(server) {
  return {
    Authorization: "Basic " + Buffer.from(`${server.username}:${server.token}`).toString("base64"),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// Translate low-level fetch errors into actionable messages
function describeNetworkError(err, url) {
  const code = err.cause?.code || err.code;
  const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  switch (code) {
    case "ENOTFOUND": return `DNS lookup failed — cannot resolve hostname "${hostname}"`;
    case "ECONNREFUSED": return `Connection refused at ${url} — is the server running?`;
    case "ECONNRESET": return `Connection reset by ${hostname} — server closed the connection unexpectedly`;
    case "ETIMEDOUT": return `Connection timed out reaching ${hostname}`;
    case "ECONNABORTED": return `Request aborted — ${hostname} took too long to respond`;
    case "DEPTH_ZERO_SELF_SIGNED_CERT": return `SSL error: self-signed certificate at ${hostname}. Set NODE_TLS_REJECT_UNAUTHORIZED=0 or install the CA`;
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE": return `SSL error: cannot verify certificate chain for ${hostname}. Missing intermediate CA?`;
    case "CERT_HAS_EXPIRED": return `SSL error: certificate has expired for ${hostname}`;
    case "ERR_TLS_CERT_ALTNAME_INVALID": return `SSL error: certificate hostname mismatch — cert does not cover "${hostname}"`;
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY": return `SSL error: unknown CA for ${hostname}. Set NODE_EXTRA_CA_CERTS or NODE_TLS_REJECT_UNAUTHORIZED=0`;
    default: break;
  }
  // Check cause message for additional SSL clues
  const causeMsg = (err.cause?.message || "").toLowerCase();
  if (causeMsg.includes("self-signed") || causeMsg.includes("self_signed"))
    return `SSL error: self-signed certificate at ${hostname}. Set NODE_TLS_REJECT_UNAUTHORIZED=0 or install the CA`;
  if (causeMsg.includes("certificate") || causeMsg.includes("ssl") || causeMsg.includes("tls"))
    return `SSL/TLS error connecting to ${hostname}: ${err.cause?.message}`;
  if (err.message === "fetch failed")
    return `Cannot reach server at ${url} — check the URL, network, firewall, and SSL settings`;
  return `${err.message}${err.cause ? ` (${err.cause.message || err.cause.code})` : ""}`;
}

async function jiraFetchFrom(server, path) {
  const url = `${server.url}/rest/api/2${path}`;
  let res;
  try {
    res = await fetch(url, { headers: jiraHeadersFor(server) });
  } catch (err) {
    throw new Error(`${describeNetworkError(err, server.url)} [server: ${server.name}]`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API ${res.status} (${server.name}): ${text}`);
  }
  return res.json();
}

async function jiraFetchAgileFrom(server, path) {
  const url = `${server.url}/rest/agile/1.0${path}`;
  let res;
  try {
    res = await fetch(url, { headers: jiraHeadersFor(server) });
  } catch (err) {
    throw new Error(`${describeNetworkError(err, server.url)} [server: ${server.name}]`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira Agile API ${res.status} (${server.name}): ${text}`);
  }
  return res.json();
}

// Search using POST /rest/api/3/search/jql (Jira Cloud 2025+), falls back to GET /rest/api/2/search
async function jiraSearchAllFrom(server, jql, fieldsStr, pageSize = 100, expand = "") {
  let startAt = 0;
  let allIssues = [];
  let total = 0;
  do {
    let data;
    try {
      // Try v3 POST endpoint first (required for Jira Cloud since 2025)
      const body = {
        jql,
        fields: fieldsStr.split(",").map((f) => f.trim()),
        startAt,
        maxResults: pageSize,
      };
      if (expand) body.expand = expand.split(",").map((e) => e.trim());
      const url = `${server.url}/rest/api/3/search/jql`;
      const res = await fetch(url, {
        method: "POST",
        headers: jiraHeadersFor(server),
        body: JSON.stringify(body),
      });
      if (res.status === 404 || res.status === 405 || res.status === 410) {
        throw new Error("v3 not available");
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Jira API ${res.status} (${server.name}): ${text}`);
      }
      data = await res.json();
    } catch (err) {
      if (err.message === "v3 not available") {
        // Fallback: GET /rest/api/2/search (self-hosted Jira)
        const expandParam = expand ? `&expand=${expand}` : "";
        data = await jiraFetchFrom(server,
          `/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${pageSize}&fields=${fieldsStr}${expandParam}`
        );
      } else {
        throw err;
      }
    }
    total = data.total;
    allIssues = allIssues.concat(data.issues);
    startAt += data.issues.length;
    if (data.issues.length === 0) break;
  } while (startAt < total);
  return { issues: allIssues, total };
}

// Custom JQL template for finding epic children — use {EPIC_KEY} as placeholder
// Example: 'labels = "{EPIC_KEY}" ORDER BY status ASC'
let EPIC_CHILDREN_JQL_TEMPLATE = process.env.EPIC_CHILDREN_JQL_TEMPLATE || "";

// Missing info audit criteria — prompt-style description of what makes a ticket "incomplete"
const DEFAULT_MISSING_INFO_CRITERIA = `A ticket is considered to have missing information if ANY of the following are true:
- No description or description is less than 30 characters
- No acceptance criteria (description does not contain "acceptance criteria", "AC:", "given/when/then", or a checklist)
- No due date set
- No assignee
- No story points or time estimate`;
let MISSING_INFO_CRITERIA = process.env.MISSING_INFO_CRITERIA || DEFAULT_MISSING_INFO_CRITERIA;

// Story point settings — Fibonacci sequence limits
const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
let STORY_POINT_SETTINGS = {
  maxStoryPoints: parseInt(process.env.MAX_STORY_POINTS) || 8, // tickets above this trigger split alert
  allowedValues: FIBONACCI, // valid story point values
};

// Prompt control settings
let PROMPT_SETTINGS = {
  maxTickets: parseInt(process.env.PROMPT_MAX_TICKETS) || 100,
  maxPromptChars: parseInt(process.env.PROMPT_MAX_CHARS) || 40000,
  includeDescriptions: process.env.PROMPT_INCLUDE_DESCRIPTIONS !== "false",
  includeComments: process.env.PROMPT_INCLUDE_COMMENTS !== "false",
  includeEstimates: process.env.PROMPT_INCLUDE_ESTIMATES !== "false",
  includeDoneTickets: process.env.PROMPT_INCLUDE_DONE !== "true", // exclude done by default
  wipLimitPerPerson: parseInt(process.env.WIP_LIMIT_PER_PERSON) || 3,
  wipLimitBoard: parseInt(process.env.WIP_LIMIT_BOARD) || 0, // 0 = auto (team_size * 2)
};

// ─── Epic Field Detection (Jira 9.x vs 10.x compat) ─────
let EPIC_LINK_FIELDS = ["customfield_10014", "customfield_10101"];
let HAS_EPIC_LINK_JQL = false; // whether "Epic Link" JQL clause works

async function detectEpicFields(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const fields = await jiraFetch("/field");
      const epicLinkField = fields.find(
        (f) => f.name === "Epic Link" || f.clauseNames?.includes("'Epic Link'")
      );
      const epicNameField = fields.find(
        (f) => f.name === "Epic Name" || f.clauseNames?.includes("'Epic Name'")
      );
      const detected = [];
      if (epicLinkField) {
        detected.push(epicLinkField.id);
        HAS_EPIC_LINK_JQL = true;
        console.log(`Epic Link JQL supported (field: ${epicLinkField.id})`);
      }
      if (epicNameField && epicNameField.id !== epicLinkField?.id) {
        detected.push(epicNameField.id);
      }
      for (const f of ["customfield_10014", "customfield_10101"]) {
        if (!detected.includes(f)) detected.push(f);
      }
      EPIC_LINK_FIELDS = detected;
      console.log(`Epic fields: ${EPIC_LINK_FIELDS.join(", ")}`);
      if (!HAS_EPIC_LINK_JQL) {
        console.log("Epic Link JQL NOT available — using parent-based queries");
      }
      return; // success
    } catch (err) {
      console.warn(`Could not auto-detect epic fields, attempt ${attempt}/${retries} (${err.message})`);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 5000 * attempt)); // wait 5s, 10s...
      }
    }
  }
  console.warn("Epic field detection failed after all retries, using defaults + Epic Link fallback in JQL");
}

function getEpicKey(fields) {
  for (const f of EPIC_LINK_FIELDS) {
    if (fields[f]) return fields[f];
  }
  if (fields.parent?.key) return fields.parent.key;
  return null;
}

function getEpicName(fields) {
  for (const f of EPIC_LINK_FIELDS) {
    if (fields[f] && typeof fields[f] === "string") return fields[f];
  }
  if (fields.parent?.fields?.summary) return fields.parent.fields.summary;
  return null;
}

// ─── Helpers (resolve server by id, fall back to first configured or env vars) ────
function resolveServer(serverId) {
  if (serverId) {
    const found = JIRA_SERVERS.find((s) => s.id === serverId);
    if (found) return found;
  }
  if (JIRA_SERVERS.length > 0) return JIRA_SERVERS[0];
  return { url: JIRA_BASE_URL, username: JIRA_USERNAME, token: JIRA_API_TOKEN, name: "default" };
}
function defaultServer() { return resolveServer(null); }

// Resolve server from project key by checking which team owns it
function resolveServerForProject(projectKey) {
  if (!projectKey) return defaultServer();
  const team = TEAMS.find((t) => t.projectKey === projectKey);
  if (team) return resolveServer(team.serverId);
  // Check server project lists
  const server = JIRA_SERVERS.find((s) => s.projects?.includes(projectKey));
  if (server) return server;
  return defaultServer();
}

// Extract project key from JQL (best-effort)
function extractProjectFromJql(jql) {
  if (!jql) return null;
  const match = jql.match(/project\s*=\s*"?([A-Z][A-Z0-9_-]+)"?/i);
  return match ? match[1].toUpperCase() : null;
}

// Resolve server from serverId query param, or from JQL project key
function resolveServerFromReq(req) {
  let server;
  if (req.query.serverId) server = resolveServer(req.query.serverId);
  else {
    const project = extractProjectFromJql(req.query.jql) || req.query.project;
    server = project ? resolveServerForProject(project) : defaultServer();
  }
  return server;
}

// Middleware: auto-resolve serverId from request context
app.use((req, res, next) => {
  if (!req.query.serverId) {
    const server = resolveServerFromReq(req);
    if (server.id) req.query.serverId = server.id;
  }
  next();
});

// Helper: build enriched error response with server & JQL context
function errorResponse(req, err) {
  const server = resolveServerFromReq(req);
  return {
    error: err.message,
    server: server.name || server.url || "unknown",
    serverUrl: server.url || null,
    jql: req.query.jql || null,
  };
}

const jiraHeaders = () => jiraHeadersFor(defaultServer());

async function jiraFetch(path, serverId) {
  const srv = resolveServer(serverId);
  const url = `${srv.url}/rest/api/2${path}`;
  let res;
  try {
    res = await fetch(url, { headers: jiraHeadersFor(srv) });
  } catch (err) {
    throw new Error(`${describeNetworkError(err, srv.url)} [server: ${srv.name}]`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API ${res.status} (${srv.name}): ${text}`);
  }
  return res.json();
}

async function jiraFetchAgile(path, serverId) {
  const srv = resolveServer(serverId);
  const url = `${srv.url}/rest/agile/1.0${path}`;
  let res;
  try {
    res = await fetch(url, { headers: jiraHeadersFor(srv) });
  } catch (err) {
    throw new Error(`${describeNetworkError(err, srv.url)} [server: ${srv.name}]`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira Agile API ${res.status} (${srv.name}): ${text}`);
  }
  return res.json();
}

// Paginated search — fetches ALL matching issues, not just one page
async function jiraSearchAll(jql, fieldsStr, pageSize = 100, expand = "", serverId = null) {
  let startAt = 0;
  let allIssues = [];
  let total = 0;

  do {
    const expandParam = expand ? `&expand=${expand}` : "";
    const data = await jiraFetch(
      `/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${pageSize}&fields=${fieldsStr}${expandParam}`,
      serverId
    );
    total = data.total;
    allIssues = allIssues.concat(data.issues);
    startAt += data.issues.length;
    if (data.issues.length === 0) break; // safety
  } while (startAt < total);

  return { issues: allIssues, total };
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function computeUrgency(issue) {
  const flags = [];
  const now = Date.now();

  if (issue.dueDate && new Date(issue.dueDate).getTime() < now && issue.statusCategory !== "done") {
    const days = daysSince(issue.dueDate);
    flags.push({ type: "overdue", label: `Overdue by ${days}d`, severity: "critical" });
  }

  if (issue.dueDate && issue.statusCategory !== "done") {
    const daysLeft = Math.floor((new Date(issue.dueDate).getTime() - now) / 86400000);
    if (daysLeft >= 0 && daysLeft <= 3) {
      flags.push({ type: "due_soon", label: `Due in ${daysLeft}d`, severity: "warning" });
    }
  }

  if (issue.statusCategory !== "done") {
    const stale = daysSince(issue.updated);
    if (stale >= 14) {
      flags.push({ type: "stale", label: `No update ${stale}d`, severity: "critical" });
    } else if (stale >= 7) {
      flags.push({ type: "stale", label: `No update ${stale}d`, severity: "warning" });
    }
  }

  if (issue.priority === "Highest") {
    flags.push({ type: "priority", label: "Highest priority", severity: "critical" });
  } else if (issue.priority === "High") {
    flags.push({ type: "priority", label: "High priority", severity: "warning" });
  }

  if ((issue.labels || []).some((l) => l.toLowerCase().includes("block"))) {
    flags.push({ type: "blocked", label: "Blocked", severity: "critical" });
  }

  if (!issue.assigneeName && issue.statusCategory !== "done") {
    flags.push({ type: "unassigned", label: "Unassigned", severity: "info" });
  }

  return flags;
}

// Build JQL to find children of an epic, compatible with all Jira versions
function buildEpicChildrenJql(epicKey) {
  // Priority 1: User-defined custom JQL template
  if (EPIC_CHILDREN_JQL_TEMPLATE) {
    return EPIC_CHILDREN_JQL_TEMPLATE.replace(/\{EPIC_KEY\}/g, epicKey);
  }

  const clauses = [];

  // Always include "Epic Link" — classic Jira Server/DC with Software
  // Even if detection failed at startup, this is harmless (Jira ignores invalid OR clauses)
  clauses.push(`"Epic Link" = ${epicKey}`);

  // Also parent = KEY — Jira 10.x / next-gen / team-managed
  clauses.push(`parent = ${epicKey}`);

  return `(${clauses.join(" OR ")}) ORDER BY status ASC, priority DESC`;
}

// ─── Routes ──────────────────────────────────────────────

app.get("/health", async (req, res) => {
  const startTime = Date.now();
  const checks = [];
  let overallStatus = "healthy";

  // 1. API itself
  checks.push({ name: "API Server", status: "healthy", message: "Express running on port " + PORT, latencyMs: 0 });

  // 2. Configuration
  const hasServers = JIRA_SERVERS.length > 0;
  checks.push({
    name: "Configuration",
    status: hasServers ? "healthy" : "degraded",
    message: hasServers
      ? `${JIRA_SERVERS.length} server(s), ${TEAMS.length} team(s), source: ${configSource}`
      : "No Jira servers configured — run setup wizard",
    details: { configSource, serverCount: JIRA_SERVERS.length, teamCount: TEAMS.length, needsSetup: needsSetup() },
  });
  if (!hasServers) overallStatus = "degraded";

  // 3. Jira connectivity (test each server)
  for (const server of JIRA_SERVERS) {
    try {
      const jiraStart = Date.now();
      const data = await jiraFetchFrom(server, "/rest/api/2/serverInfo");
      checks.push({
        name: `Jira: ${server.name}`,
        status: "healthy",
        message: `${data.serverTitle || "Jira"} v${data.version || "?"}`,
        latencyMs: Date.now() - jiraStart,
        details: { url: server.url, version: data.version, baseUrl: data.baseUrl },
      });
    } catch (err) {
      checks.push({
        name: `Jira: ${server.name}`,
        status: "unhealthy",
        message: err.message?.slice(0, 100),
        latencyMs: 0,
        details: { url: server.url },
      });
      overallStatus = "unhealthy";
    }
  }

  // 4. AI Provider
  const aiEnabled = AI_CONFIG?.enabled && AI_CONFIG?.apiKey;
  checks.push({
    name: "AI Provider",
    status: aiEnabled ? "healthy" : "not_configured",
    message: aiEnabled
      ? `${AI_CONFIG.provider} (${AI_CONFIG.model || "default"}) enabled`
      : "No AI provider configured — copy/paste mode active",
    details: { provider: AI_CONFIG?.provider || "", model: AI_CONFIG?.model || "", enabled: !!aiEnabled },
  });

  // 5. RACI data
  const raciCount = Object.keys(raciMatrices).length;
  checks.push({
    name: "RACI Matrices",
    status: raciCount > 0 ? "healthy" : "not_configured",
    message: raciCount > 0 ? `${raciCount} matrix(es) documented` : "No RACI matrices created",
  });

  // 6. Config persistence
  checks.push({
    name: "Config Persistence",
    status: configSource === "file" ? "healthy" : configSource === "defaults" ? "degraded" : "healthy",
    message: configSource === "file" ? "config.json loaded" : configSource === "defaults" ? "Using defaults — no config saved yet" : `Source: ${configSource}`,
  });

  const totalLatency = Date.now() - startTime;

  res.json({
    status: overallStatus,
    edition: "Open Source",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: "1.0.0",
    totalLatencyMs: totalLatency,
    checks,
    summary: {
      total: checks.length,
      healthy: checks.filter((c) => c.status === "healthy").length,
      degraded: checks.filter((c) => c.status === "degraded").length,
      unhealthy: checks.filter((c) => c.status === "unhealthy").length,
      notConfigured: checks.filter((c) => c.status === "not_configured").length,
    },
  });
});

// ─── AI Provider Config (stored per tenant or in file) ───
const AI_CONFIG_FILE = resolve(CONFIG_DIR, "ai-config.json");

// In-memory AI config (fallback when no DB)
let AI_CONFIG = {
  provider: "",      // "openai" | "anthropic" | "mistral" | "ollama" | "custom"
  model: "",         // e.g. "gpt-4o", "claude-sonnet-4-5", "mistral-large"
  apiKey: "",        // user-provided API key (never logged/returned in responses)
  baseUrl: "",       // for custom/ollama providers
  enabled: false,
};

// Load AI config from file on startup
(function loadAiConfig() {
  try {
    const raw = fs.readFileSync(AI_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") AI_CONFIG = { ...AI_CONFIG, ...parsed };
  } catch {}
})();

function saveAiConfig() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(AI_CONFIG_FILE, JSON.stringify(AI_CONFIG, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error("Failed to save AI config:", err.message);
  }
}

app.get("/settings/ai", (req, res) => {
  res.json({
    provider: AI_CONFIG.provider,
    model: AI_CONFIG.model,
    baseUrl: AI_CONFIG.baseUrl,
    enabled: AI_CONFIG.enabled,
    hasApiKey: !!AI_CONFIG.apiKey, // never expose the key
  });
});

app.post("/settings/ai", (req, res) => {
  const { provider, model, apiKey, baseUrl, enabled } = req.body;
  if (provider !== undefined) AI_CONFIG.provider = provider;
  if (model !== undefined) AI_CONFIG.model = model;
  if (apiKey !== undefined && apiKey !== "••••••••") AI_CONFIG.apiKey = apiKey;
  if (baseUrl !== undefined) AI_CONFIG.baseUrl = baseUrl;
  if (enabled !== undefined) AI_CONFIG.enabled = !!enabled;
  saveAiConfig();
  console.log(`AI config updated: provider=${AI_CONFIG.provider}, model=${AI_CONFIG.model}, enabled=${AI_CONFIG.enabled}`);
  res.json({ ok: true, provider: AI_CONFIG.provider, model: AI_CONFIG.model, baseUrl: AI_CONFIG.baseUrl, enabled: AI_CONFIG.enabled, hasApiKey: !!AI_CONFIG.apiKey });
});

// Settings — runtime config for epic children JQL, missing info criteria, prompt, etc.
app.get("/settings", (req, res) => {
  res.json({
    epicChildrenJqlTemplate: EPIC_CHILDREN_JQL_TEMPLATE,
    hasEpicLinkJql: HAS_EPIC_LINK_JQL,
    epicLinkFields: EPIC_LINK_FIELDS,
    defaultJql: DEFAULT_JQL,
    missingInfoCriteria: MISSING_INFO_CRITERIA,
    promptSettings: PROMPT_SETTINGS,
    storyPointSettings: STORY_POINT_SETTINGS,
  });
});

app.post("/settings", (req, res) => {
  const { epicChildrenJqlTemplate, missingInfoCriteria, promptSettings } = req.body;
  if (typeof epicChildrenJqlTemplate === "string") {
    EPIC_CHILDREN_JQL_TEMPLATE = epicChildrenJqlTemplate;
    console.log(`Epic children JQL template updated: ${EPIC_CHILDREN_JQL_TEMPLATE || "(auto-detect)"}`);
  }
  if (typeof missingInfoCriteria === "string") {
    MISSING_INFO_CRITERIA = missingInfoCriteria;
    console.log(`Missing info criteria updated`);
  }
  if (promptSettings && typeof promptSettings === "object") {
    PROMPT_SETTINGS = { ...PROMPT_SETTINGS, ...promptSettings };
    console.log(`Prompt settings updated:`, PROMPT_SETTINGS);
  }
  if (req.body.storyPointSettings && typeof req.body.storyPointSettings === "object") {
    const sp = req.body.storyPointSettings;
    if (typeof sp.maxStoryPoints === "number" && FIBONACCI.includes(sp.maxStoryPoints)) {
      STORY_POINT_SETTINGS.maxStoryPoints = sp.maxStoryPoints;
    }
    console.log(`Story point settings updated: max=${STORY_POINT_SETTINGS.maxStoryPoints}`);
  }
  res.json({
    epicChildrenJqlTemplate: EPIC_CHILDREN_JQL_TEMPLATE,
    hasEpicLinkJql: HAS_EPIC_LINK_JQL,
    missingInfoCriteria: MISSING_INFO_CRITERIA,
    promptSettings: PROMPT_SETTINGS,
    storyPointSettings: STORY_POINT_SETTINGS,
  });
});

// Jira saved filters — favourite filters, board filters, and quick links
app.get("/filters", async (req, res) => {
  try {
    const results = { favourite: [], boards: [], recent: [] };

    // 1. User's favourite/starred filters
    try {
      const favFilters = await jiraFetch("/filter/favourite", req.query.serverId);
      results.favourite = favFilters.map((f) => ({
        id: f.id,
        name: f.name,
        jql: f.jql,
        owner: f.owner?.displayName || null,
        viewUrl: f.viewUrl || null,
      }));
    } catch {
      // favourite endpoint may not be available
    }

    // 2. Boards (Kanban + Scrum) the user can see
    try {
      const boardData = await jiraFetchAgile("/board?maxResults=50", req.query.serverId);
      for (const board of boardData.values || []) {
        const entry = {
          id: board.id,
          name: board.name,
          type: board.type, // "kanban" | "scrum" | "simple"
          jql: null,
          projectKey: board.location?.projectKey || null,
        };
        // Fetch the board's filter to get its JQL
        try {
          const boardConfig = await jiraFetchAgile(`/board/${board.id}/configuration`, req.query.serverId);
          if (boardConfig.filter?.id) {
            const boardFilter = await jiraFetch(`/filter/${boardConfig.filter.id}`, req.query.serverId);
            entry.jql = boardFilter.jql;
            entry.filterName = boardFilter.name;
          }
        } catch {
          // Some boards may not expose config
        }
        results.boards.push(entry);
      }
    } catch {
      // Agile API may not be available
    }

    // 3. Recent filters (not favourites)
    try {
      const myFilters = await jiraFetch("/filter/search?maxResults=20&orderBy=IS_FAVOURITE&expand=jql", req.query.serverId);
      results.recent = (myFilters.values || [])
        .filter((f) => !results.favourite.some((fav) => fav.id === f.id))
        .map((f) => ({
          id: f.id,
          name: f.name,
          jql: f.jql,
          owner: f.owner?.displayName || null,
        }));
    } catch {
      // filter/search may not be available on older versions
    }

    // 4. Build swimlane-like quick filters from boards
    for (const board of results.boards) {
      try {
        const props = await jiraFetchAgile(`/board/${board.id}/properties/GreenHopper.quickFilters`, req.query.serverId);
        if (props.value) {
          board.quickFilters = (Array.isArray(props.value) ? props.value : []).map((qf) => ({
            id: qf.id,
            name: qf.name,
            jql: qf.query,
          }));
        }
      } catch {
        // quickFilters property may not exist
      }
    }

    res.json(results);
  } catch (err) {
    console.error("Error fetching filters:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// Main endpoint: issues grouped by epic with urgency flags
app.get("/issues", async (req, res) => {
  try {
    const jql = req.query.jql || (req.query.project ? `project = ${req.query.project} ORDER BY status ASC, updated DESC` : DEFAULT_JQL);
    if (!jql) return res.status(400).json({ error: "No JQL query provided. Configure a default JQL in Settings or provide a ?jql= parameter." });

    const epicFields = EPIC_LINK_FIELDS.join(",");
    const fieldsStr = `summary,status,assignee,priority,updated,created,duedate,description,issuetype,labels,comment,${epicFields},parent,timetracking,flagged,issuelinks`;

    // Paginate to get ALL issues
    const data = await jiraSearchAll(jql, fieldsStr, 100, "", req.query.serverId);

    const issues = data.issues.map((issue) => {
      const lastComment = issue.fields.comment?.comments?.slice(-1)[0];

      const links = (issue.fields.issuelinks || []).map((link) => {
        const target = link.outwardIssue || link.inwardIssue;
        return {
          type: link.type?.name,
          direction: link.outwardIssue ? link.type?.outward : link.type?.inward,
          key: target?.key,
          summary: target?.fields?.summary,
          status: target?.fields?.status?.name,
          statusCategory: target?.fields?.status?.statusCategory?.key,
          priority: target?.fields?.priority?.name,
          issueType: target?.fields?.issuetype?.name,
          project: target?.key?.split("-")[0],
        };
      });

      const mapped = {
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status?.name,
        statusCategory: issue.fields.status?.statusCategory?.key,
        assigneeName: issue.fields.assignee?.displayName || null,
        assigneeAvatar: issue.fields.assignee?.avatarUrls?.["32x32"],
        priority: issue.fields.priority?.name,
        issueType: issue.fields.issuetype?.name,
        issueTypeIcon: issue.fields.issuetype?.iconUrl,
        labels: issue.fields.labels || [],
        created: issue.fields.created,
        updated: issue.fields.updated,
        dueDate: issue.fields.duedate || null,
        epicKey: getEpicKey(issue.fields),
        epicName: getEpicName(issue.fields),
        originalEstimate: issue.fields.timetracking?.originalEstimate || null,
        remainingEstimate: issue.fields.timetracking?.remainingEstimate || null,
        timeSpent: issue.fields.timetracking?.timeSpent || null,
        links,
        lastComment: lastComment
          ? {
              author: lastComment.author?.displayName,
              body: lastComment.body?.substring(0, 300),
              date: lastComment.updated || lastComment.created,
            }
          : null,
        commentCount: issue.fields.comment?.total || 0,
        daysSinceUpdate: daysSince(issue.fields.updated),
      };

      mapped.urgencyFlags = computeUrgency(mapped);
      return mapped;
    });

    // Group by epic
    const epics = {};
    const noEpic = [];

    for (const issue of issues) {
      if (issue.epicKey) {
        if (!epics[issue.epicKey]) {
          epics[issue.epicKey] = {
            key: issue.epicKey,
            name: issue.epicName || issue.epicKey,
            issues: [],
          };
        }
        epics[issue.epicKey].issues.push(issue);
      } else {
        noEpic.push(issue);
      }
    }

    const epicList = Object.values(epics).map((epic) => {
      const total = epic.issues.length;
      const done = epic.issues.filter((i) => i.statusCategory === "done").length;
      const inProgress = epic.issues.filter((i) => i.statusCategory === "indeterminate").length;
      const todo = total - done - inProgress;
      const allFlags = epic.issues.flatMap((i) => i.urgencyFlags);
      const criticalCount = allFlags.filter((f) => f.severity === "critical").length;
      const warningCount = allFlags.filter((f) => f.severity === "warning").length;

      const dueDates = epic.issues
        .filter((i) => i.dueDate && i.statusCategory !== "done")
        .map((i) => new Date(i.dueDate).getTime())
        .sort((a, b) => a - b);
      const nextDeadline = dueDates.length > 0 ? new Date(dueDates[0]).toISOString().split("T")[0] : null;

      return {
        ...epic,
        stats: { total, done, inProgress, todo, criticalCount, warningCount, nextDeadline },
        progress: total > 0 ? Math.round((done / total) * 100) : 0,
      };
    });

    epicList.sort((a, b) => b.stats.criticalCount - a.stats.criticalCount || a.progress - b.progress);

    res.json({
      total: data.total,
      epics: epicList,
      noEpic,
      stats: {
        total: issues.length,
        done: issues.filter((i) => i.statusCategory === "done").length,
        inProgress: issues.filter((i) => i.statusCategory === "indeterminate").length,
        todo: issues.filter((i) => i.statusCategory === "new").length,
        overdue: issues.filter((i) => i.urgencyFlags.some((f) => f.type === "overdue")).length,
        stale: issues.filter((i) => i.urgencyFlags.some((f) => f.type === "stale")).length,
        unassigned: issues.filter((i) => i.urgencyFlags.some((f) => f.type === "unassigned")).length,
      },
    });
  } catch (err) {
    console.error("Error fetching issues:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

app.get("/issues/:key", async (req, res) => {
  try {
    const data = await jiraFetch(`/issue/${req.params.key}`, req.query.serverId);
    res.json(data);
  } catch (err) {
    res.status(500).json(errorResponse(req, err));
  }
});

// Full epic detail — all ticket data for prompt generation
app.get("/epic/:key", async (req, res) => {
  try {
    const epicKey = req.params.key;

    // Fetch the epic issue itself
    let epic;
    try {
      const epicRaw = await jiraFetch(
        `/issue/${epicKey}?fields=summary,status,assignee,priority,created,updated,duedate,description,labels,comment,issuetype`,
        req.query.serverId
      );
      epic = {
        key: epicRaw.key,
        summary: epicRaw.fields.summary,
        description: epicRaw.fields.description || "",
        status: epicRaw.fields.status?.name,
        statusCategory: epicRaw.fields.status?.statusCategory?.key,
        assigneeName: epicRaw.fields.assignee?.displayName || null,
        priority: epicRaw.fields.priority?.name,
        labels: epicRaw.fields.labels || [],
        created: epicRaw.fields.created,
        updated: epicRaw.fields.updated,
        dueDate: epicRaw.fields.duedate || null,
      };
    } catch {
      epic = { key: epicKey, summary: epicKey, description: "" };
    }

    // Fetch all child tickets — try combined JQL, fall back to parent-only if "Epic Link" unsupported
    const epicFieldsList = EPIC_LINK_FIELDS.join(",");
    const fieldsStr = `summary,status,assignee,priority,updated,created,duedate,description,issuetype,labels,comment,issuelinks,timetracking,${epicFieldsList},parent`;

    let data;
    const jql = buildEpicChildrenJql(epicKey);
    try {
      data = await jiraSearchAll(jql, fieldsStr, 100, "", req.query.serverId);
    } catch {
      // "Epic Link" clause may not be supported — fall back to parent-only
      const fallbackJql = `parent = ${epicKey} ORDER BY status ASC, priority DESC`;
      data = await jiraSearchAll(fallbackJql, fieldsStr, 100, "", req.query.serverId);
    }

    const tickets = data.issues.map((issue) => {
      const comments = (issue.fields.comment?.comments || []).map((c) => ({
        author: c.author?.displayName,
        body: c.body,
        date: c.updated || c.created,
      }));

      const links = (issue.fields.issuelinks || []).map((link) => {
        const target = link.outwardIssue || link.inwardIssue;
        return {
          type: link.type?.name,
          direction: link.outwardIssue ? link.type?.outward : link.type?.inward,
          key: target?.key,
          summary: target?.fields?.summary,
          status: target?.fields?.status?.name,
        };
      });

      const blockers = links.filter(
        (l) =>
          l.direction?.toLowerCase().includes("blocked by") ||
          l.direction?.toLowerCase().includes("is blocked")
      );

      const mapped = {
        key: issue.key,
        summary: issue.fields.summary,
        description: issue.fields.description || "",
        status: issue.fields.status?.name,
        statusCategory: issue.fields.status?.statusCategory?.key,
        assigneeName: issue.fields.assignee?.displayName || null,
        priority: issue.fields.priority?.name,
        issueType: issue.fields.issuetype?.name,
        labels: issue.fields.labels || [],
        created: issue.fields.created,
        updated: issue.fields.updated,
        dueDate: issue.fields.duedate || null,
        originalEstimate: issue.fields.timetracking?.originalEstimate || null,
        remainingEstimate: issue.fields.timetracking?.remainingEstimate || null,
        timeSpent: issue.fields.timetracking?.timeSpent || null,
        comments,
        commentCount: issue.fields.comment?.total || 0,
        links,
        blockers,
        daysSinceUpdate: daysSince(issue.fields.updated),
      };

      mapped.urgencyFlags = computeUrgency(mapped);
      return mapped;
    });

    const total = tickets.length;
    const done = tickets.filter((t) => t.statusCategory === "done").length;
    const inProgress = tickets.filter((t) => t.statusCategory === "indeterminate").length;
    const todo = total - done - inProgress;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;

    res.json({
      epic,
      tickets,
      stats: { total, done, inProgress, todo, progress },
    });
  } catch (err) {
    console.error("Error fetching epic detail:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── Single Issue Detail (for story-level AI prompt) ──────
app.get("/issue/:key", async (req, res) => {
  try {
    const issueKey = req.params.key;
    const epicFieldsList = EPIC_LINK_FIELDS.join(",");
    const fieldsStr = `summary,status,assignee,priority,updated,created,duedate,description,issuetype,labels,comment,issuelinks,timetracking,${epicFieldsList},parent`;

    const raw = await jiraFetch(`/issue/${issueKey}?fields=${fieldsStr}&expand=changelog`, req.query.serverId);
    const f = raw.fields;

    const comments = (f.comment?.comments || []).map((c) => ({
      author: c.author?.displayName || "Unknown",
      body: (c.body || "").substring(0, 500),
      date: c.updated || c.created,
    }));

    const links = (f.issuelinks || []).map((link) => {
      const target = link.outwardIssue || link.inwardIssue;
      return {
        type: link.type?.name,
        direction: link.outwardIssue ? link.type?.outward : link.type?.inward,
        key: target?.key,
        summary: target?.fields?.summary,
        status: target?.fields?.status?.name,
      };
    });

    const blockers = links.filter(
      (l) =>
        l.direction?.toLowerCase().includes("blocked by") ||
        l.direction?.toLowerCase().includes("is blocked")
    );

    // Extract changelog
    const changelog = [];
    for (const history of (raw.changelog?.histories || [])) {
      for (const item of history.items || []) {
        changelog.push({
          field: item.field,
          from: item.fromString,
          to: item.toString,
          author: history.author?.displayName || "Unknown",
          date: history.created,
        });
      }
    }

    // Epic/parent info
    const parentKey = f.parent?.key || null;
    const parentSummary = f.parent?.fields?.summary || null;

    // Subtasks
    let subtasks = [];
    if (f.subtasks?.length) {
      subtasks = f.subtasks.map(s => ({
        key: s.key,
        summary: s.fields?.summary,
        status: s.fields?.status?.name,
        statusCategory: s.fields?.status?.statusCategory?.key,
      }));
    }

    const issue = {
      key: raw.key,
      summary: f.summary,
      description: f.description || "",
      status: f.status?.name,
      statusCategory: f.status?.statusCategory?.key,
      assigneeName: f.assignee?.displayName || null,
      priority: f.priority?.name,
      issueType: f.issuetype?.name,
      labels: f.labels || [],
      created: f.created,
      updated: f.updated,
      dueDate: f.duedate || null,
      originalEstimate: f.timetracking?.originalEstimate || null,
      remainingEstimate: f.timetracking?.remainingEstimate || null,
      timeSpent: f.timetracking?.timeSpent || null,
      comments,
      commentCount: f.comment?.total || 0,
      links,
      blockers,
      changelog,
      parentKey,
      parentSummary,
      subtasks,
      daysSinceUpdate: daysSince(f.updated),
    };

    issue.urgencyFlags = computeUrgency(issue);

    res.json({ issue });
  } catch (err) {
    console.error("Error fetching issue detail:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── PM Analytics endpoint ────────────────────────────────

function computeQualityScore(issue) {
  let score = 0;
  let maxScore = 0;
  const breakdown = {};

  // Has summary (always true, but check length)
  maxScore += 15;
  if (issue.fields.summary && issue.fields.summary.length > 10) {
    score += 15;
    breakdown.summary = { score: 15, max: 15, status: "ok" };
  } else {
    breakdown.summary = { score: 0, max: 15, status: "missing" };
  }

  // Has description
  maxScore += 20;
  const desc = issue.fields.description || "";
  if (desc.length > 50) {
    score += 20;
    breakdown.description = { score: 20, max: 20, status: "ok" };
  } else if (desc.length > 0) {
    score += 10;
    breakdown.description = { score: 10, max: 20, status: "short" };
  } else {
    breakdown.description = { score: 0, max: 20, status: "missing" };
  }

  // Has assignee
  maxScore += 15;
  if (issue.fields.assignee) {
    score += 15;
    breakdown.assignee = { score: 15, max: 15, status: "ok" };
  } else {
    breakdown.assignee = { score: 0, max: 15, status: "missing" };
  }

  // Has priority set (not just default)
  maxScore += 10;
  if (issue.fields.priority && issue.fields.priority.name !== "Medium") {
    score += 10;
    breakdown.priority = { score: 10, max: 10, status: "ok" };
  } else if (issue.fields.priority) {
    score += 5;
    breakdown.priority = { score: 5, max: 10, status: "default" };
  } else {
    breakdown.priority = { score: 0, max: 10, status: "missing" };
  }

  // Has due date
  maxScore += 15;
  if (issue.fields.duedate) {
    score += 15;
    breakdown.dueDate = { score: 15, max: 15, status: "ok" };
  } else {
    breakdown.dueDate = { score: 0, max: 15, status: "missing" };
  }

  // Has estimate
  maxScore += 10;
  if (issue.fields.timetracking?.originalEstimate) {
    score += 10;
    breakdown.estimate = { score: 10, max: 10, status: "ok" };
  } else {
    breakdown.estimate = { score: 0, max: 10, status: "missing" };
  }

  // Has labels
  maxScore += 5;
  if (issue.fields.labels && issue.fields.labels.length > 0) {
    score += 5;
    breakdown.labels = { score: 5, max: 5, status: "ok" };
  } else {
    breakdown.labels = { score: 0, max: 5, status: "missing" };
  }

  // Has comments (activity)
  maxScore += 10;
  const commentCount = issue.fields.comment?.total || 0;
  if (commentCount >= 2) {
    score += 10;
    breakdown.comments = { score: 10, max: 10, status: "ok" };
  } else if (commentCount === 1) {
    score += 5;
    breakdown.comments = { score: 5, max: 10, status: "low" };
  } else {
    breakdown.comments = { score: 0, max: 10, status: "none" };
  }

  return {
    score: Math.round((score / maxScore) * 100),
    rawScore: score,
    maxScore,
    breakdown,
  };
}

app.get("/analytics", async (req, res) => {
  try {
    const jql = req.query.jql || (req.query.project ? `project = ${req.query.project} ORDER BY status ASC, updated DESC` : DEFAULT_JQL);
    if (!jql) return res.status(400).json({ error: "No JQL query provided. Configure a default JQL in Settings or provide a ?jql= parameter." });
    const epicFields = EPIC_LINK_FIELDS.join(",");
    const fieldsStr = `summary,status,assignee,priority,updated,created,duedate,description,issuetype,labels,comment,${epicFields},parent,timetracking,flagged`;

    const data = await jiraSearchAll(jql, fieldsStr, 100, "", req.query.serverId);
    const now = Date.now();

    // ── Ticket Quality Scores ──
    const qualityScores = data.issues.map((issue) => {
      const qs = computeQualityScore(issue);
      return {
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status?.name,
        statusCategory: issue.fields.status?.statusCategory?.key,
        assigneeName: issue.fields.assignee?.displayName || null,
        priority: issue.fields.priority?.name,
        issueType: issue.fields.issuetype?.name,
        qualityScore: qs.score,
        breakdown: qs.breakdown,
      };
    });

    const avgQuality = qualityScores.length > 0
      ? Math.round(qualityScores.reduce((s, q) => s + q.qualityScore, 0) / qualityScores.length)
      : 0;

    // Quality distribution
    const qualityDistribution = {
      excellent: qualityScores.filter((q) => q.qualityScore >= 80).length,
      good: qualityScores.filter((q) => q.qualityScore >= 60 && q.qualityScore < 80).length,
      fair: qualityScores.filter((q) => q.qualityScore >= 40 && q.qualityScore < 60).length,
      poor: qualityScores.filter((q) => q.qualityScore < 40).length,
    };

    // ── Aging WIP ──
    const wipIssues = data.issues
      .filter((i) => i.fields.status?.statusCategory?.key === "indeterminate")
      .map((issue) => {
        const createdDate = new Date(issue.fields.created).getTime();
        const ageDays = Math.floor((now - createdDate) / 86400000);
        return {
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status?.name,
          assigneeName: issue.fields.assignee?.displayName || null,
          priority: issue.fields.priority?.name,
          created: issue.fields.created,
          updated: issue.fields.updated,
          ageDays,
          daysSinceUpdate: daysSince(issue.fields.updated),
        };
      })
      .sort((a, b) => b.ageDays - a.ageDays);

    // WIP aging buckets
    const wipBuckets = {
      "0-3d": wipIssues.filter((i) => i.ageDays <= 3).length,
      "4-7d": wipIssues.filter((i) => i.ageDays > 3 && i.ageDays <= 7).length,
      "1-2w": wipIssues.filter((i) => i.ageDays > 7 && i.ageDays <= 14).length,
      "2-4w": wipIssues.filter((i) => i.ageDays > 14 && i.ageDays <= 28).length,
      "1-2m": wipIssues.filter((i) => i.ageDays > 28 && i.ageDays <= 60).length,
      "2m+": wipIssues.filter((i) => i.ageDays > 60).length,
    };

    // ── Status Distribution ──
    const statusMap = {};
    data.issues.forEach((issue) => {
      const name = issue.fields.status?.name || "Unknown";
      const cat = issue.fields.status?.statusCategory?.key || "new";
      if (!statusMap[name]) statusMap[name] = { name, category: cat, count: 0 };
      statusMap[name].count++;
    });

    // ── Priority Distribution ──
    const priorityMap = {};
    data.issues.forEach((issue) => {
      const name = issue.fields.priority?.name || "None";
      if (!priorityMap[name]) priorityMap[name] = { name, count: 0 };
      priorityMap[name].count++;
    });
    const highestCount = (priorityMap["Highest"]?.count || 0) + (priorityMap["High"]?.count || 0);
    const priorityInflation = data.issues.length > 0
      ? Math.round((highestCount / data.issues.length) * 100)
      : 0;

    // ── Team Workload ──
    const teamMap = {};
    data.issues.forEach((issue) => {
      const name = issue.fields.assignee?.displayName || "Unassigned";
      if (!teamMap[name]) teamMap[name] = { name, total: 0, inProgress: 0, todo: 0, done: 0, overdue: 0 };
      teamMap[name].total++;
      const cat = issue.fields.status?.statusCategory?.key;
      if (cat === "done") teamMap[name].done++;
      else if (cat === "indeterminate") teamMap[name].inProgress++;
      else teamMap[name].todo++;
      if (issue.fields.duedate && new Date(issue.fields.duedate).getTime() < now && cat !== "done") {
        teamMap[name].overdue++;
      }
    });

    // ── Due Date Compliance ──
    const withDueDate = data.issues.filter((i) => i.fields.duedate);
    const doneWithDueDate = withDueDate.filter((i) => i.fields.status?.statusCategory?.key === "done");
    const completedOnTime = doneWithDueDate.filter((i) => {
      // Check if updated (approximate completion) was before due date
      const dueTime = new Date(i.fields.duedate).getTime();
      const updatedTime = new Date(i.fields.updated).getTime();
      return updatedTime <= dueTime + 86400000; // 1 day grace
    });
    const overdueActive = withDueDate.filter(
      (i) => i.fields.status?.statusCategory?.key !== "done" && new Date(i.fields.duedate).getTime() < now
    );

    // ── Cycle Time (approximate: created → done, for done issues) ──
    const doneIssues = data.issues.filter((i) => i.fields.status?.statusCategory?.key === "done");
    const cycleTimes = doneIssues.map((i) => {
      const created = new Date(i.fields.created).getTime();
      const updated = new Date(i.fields.updated).getTime();
      return Math.max(1, Math.floor((updated - created) / 86400000));
    });
    const avgCycleTime = cycleTimes.length > 0
      ? Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length)
      : 0;
    const medianCycleTime = cycleTimes.length > 0
      ? cycleTimes.sort((a, b) => a - b)[Math.floor(cycleTimes.length / 2)]
      : 0;

    // Cycle time buckets
    const cycleTimeBuckets = {
      "1d": cycleTimes.filter((c) => c <= 1).length,
      "2-3d": cycleTimes.filter((c) => c > 1 && c <= 3).length,
      "4-7d": cycleTimes.filter((c) => c > 3 && c <= 7).length,
      "1-2w": cycleTimes.filter((c) => c > 7 && c <= 14).length,
      "2-4w": cycleTimes.filter((c) => c > 14 && c <= 28).length,
      "1m+": cycleTimes.filter((c) => c > 28).length,
    };

    // ── Stale Tickets ──
    const staleIssues = data.issues
      .filter((i) => {
        const cat = i.fields.status?.statusCategory?.key;
        return cat !== "done" && daysSince(i.fields.updated) >= 7;
      })
      .map((i) => ({
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status?.name,
        assigneeName: i.fields.assignee?.displayName || null,
        daysSinceUpdate: daysSince(i.fields.updated),
        priority: i.fields.priority?.name,
      }))
      .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);

    // ── Reassignment detection (based on last comment mentioning reassign/transfer) ──
    // Simplified: count unassigned issues as potential reassignment issues
    const unassignedActive = data.issues.filter(
      (i) => !i.fields.assignee && i.fields.status?.statusCategory?.key !== "done"
    ).length;

    // ── Bottleneck Detection (status column pileup) ──
    const activeStatuses = Object.values(statusMap).filter((s) => s.category !== "done");
    const avgPerStatus = activeStatuses.length > 0
      ? activeStatuses.reduce((sum, s) => sum + s.count, 0) / activeStatuses.length
      : 0;
    const bottlenecks = activeStatuses
      .filter((s) => s.count > avgPerStatus * 1.5 && s.count >= 3)
      .map((s) => ({
        status: s.name,
        count: s.count,
        ratio: avgPerStatus > 0 ? Math.round((s.count / avgPerStatus) * 100) / 100 : 0,
        severity: s.count > avgPerStatus * 3 ? "critical" : s.count > avgPerStatus * 2 ? "warning" : "info",
      }))
      .sort((a, b) => b.count - a.count);

    // ── WIP Limit Enforcement ──
    const wipLimitPerPerson = PROMPT_SETTINGS.wipLimitPerPerson || 3;
    const teamSize = Object.keys(teamMap).filter((k) => k !== "Unassigned").length || 1;
    const wipLimitBoard = PROMPT_SETTINGS.wipLimitBoard || teamSize * 2;
    const wipViolations = [];

    // Per-person WIP violations
    Object.values(teamMap).forEach((person) => {
      if (person.name !== "Unassigned" && person.inProgress > wipLimitPerPerson) {
        wipViolations.push({
          type: "person",
          name: person.name,
          current: person.inProgress,
          limit: wipLimitPerPerson,
          excess: person.inProgress - wipLimitPerPerson,
          severity: person.inProgress >= wipLimitPerPerson * 2 ? "critical" : "warning",
        });
      }
    });

    // Board-wide WIP violation
    if (wipIssues.length > wipLimitBoard) {
      wipViolations.push({
        type: "board",
        name: "Board Total",
        current: wipIssues.length,
        limit: wipLimitBoard,
        excess: wipIssues.length - wipLimitBoard,
        severity: wipIssues.length >= wipLimitBoard * 1.5 ? "critical" : "warning",
      });
    }

    // ── Sprint Health Score (composite 0-100) ──
    // Factors: quality avg, WIP health, staleness, overdue ratio, workload balance, bottleneck severity
    let healthScore = 100;
    const healthFactors = [];

    // Quality factor (up to -25)
    const qualityPenalty = Math.max(0, Math.round((100 - avgQuality) * 0.25));
    healthScore -= qualityPenalty;
    healthFactors.push({ name: "Ticket Quality", impact: -qualityPenalty, detail: `Avg quality ${avgQuality}%` });

    // WIP overload factor (up to -20)
    const wipPenalty = Math.min(20, wipViolations.reduce((sum, v) => sum + v.excess * 3, 0));
    healthScore -= wipPenalty;
    healthFactors.push({ name: "WIP Limits", impact: -wipPenalty, detail: `${wipViolations.length} violations` });

    // Staleness factor (up to -20)
    const activeNonDone = data.issues.filter((i) => i.fields.status?.statusCategory?.key !== "done").length;
    const staleRatio = activeNonDone > 0 ? staleIssues.length / activeNonDone : 0;
    const stalePenalty = Math.min(20, Math.round(staleRatio * 40));
    healthScore -= stalePenalty;
    healthFactors.push({ name: "Staleness", impact: -stalePenalty, detail: `${staleIssues.length} stale of ${activeNonDone} active` });

    // Overdue factor (up to -15)
    const overdueRatio = activeNonDone > 0 ? overdueActive.length / activeNonDone : 0;
    const overduePenalty = Math.min(15, Math.round(overdueRatio * 30));
    healthScore -= overduePenalty;
    healthFactors.push({ name: "Overdue Items", impact: -overduePenalty, detail: `${overdueActive.length} overdue` });

    // Bottleneck factor (up to -10)
    const bottleneckPenalty = Math.min(10, bottlenecks.filter((b) => b.severity !== "info").length * 5);
    healthScore -= bottleneckPenalty;
    healthFactors.push({ name: "Bottlenecks", impact: -bottleneckPenalty, detail: `${bottlenecks.length} detected` });

    // Unassigned factor (up to -10)
    const unassignedRatio = activeNonDone > 0 ? unassignedActive / activeNonDone : 0;
    const unassignedPenalty = Math.min(10, Math.round(unassignedRatio * 20));
    healthScore -= unassignedPenalty;
    healthFactors.push({ name: "Unassigned Work", impact: -unassignedPenalty, detail: `${unassignedActive} unassigned` });

    healthScore = Math.max(0, healthScore);
    const healthStatus = healthScore >= 75 ? "healthy" : healthScore >= 50 ? "needs_attention" : "critical";

    // ── Retrospective Prompts (auto-generated based on data) ──
    const retroPrompts = [];

    if (staleIssues.length > 3) {
      retroPrompts.push({
        category: "process",
        question: `We have ${staleIssues.length} stale tickets (no update in 7+ days). What's blocking progress on these items? Do we need to re-prioritize or remove them?`,
        context: `Top stale: ${staleIssues.slice(0, 3).map((i) => i.key).join(", ")}`,
      });
    }

    if (bottlenecks.length > 0) {
      retroPrompts.push({
        category: "workflow",
        question: `"${bottlenecks[0].status}" has ${bottlenecks[0].count} items piled up (${bottlenecks[0].ratio}x average). What's causing this bottleneck and how can we improve flow?`,
        context: `Average items per status: ${Math.round(avgPerStatus)}`,
      });
    }

    if (wipViolations.filter((v) => v.type === "person").length > 0) {
      const names = wipViolations.filter((v) => v.type === "person").map((v) => v.name).join(", ");
      retroPrompts.push({
        category: "workload",
        question: `${names} exceeded WIP limits. Are we spreading work too thin? Should we focus on finishing before starting new work?`,
        context: `WIP limit per person: ${wipLimitPerPerson}`,
      });
    }

    if (overdueActive.length > 0) {
      retroPrompts.push({
        category: "planning",
        question: `${overdueActive.length} tickets are past their due date. Are our estimates realistic? Should we adjust our planning approach?`,
        context: `Overdue ratio: ${Math.round(overdueRatio * 100)}%`,
      });
    }

    if (priorityInflation > 30) {
      retroPrompts.push({
        category: "prioritization",
        question: `${priorityInflation}% of tickets are High/Highest priority. If everything is urgent, nothing is. Can we re-evaluate our prioritization criteria?`,
        context: `Recommended: <30% high priority`,
      });
    }

    if (unassignedActive > 3) {
      retroPrompts.push({
        category: "ownership",
        question: `${unassignedActive} active tickets have no assignee. How can we improve task ownership and accountability?`,
        context: `Team size: ${teamSize}`,
      });
    }

    if (avgQuality < 50) {
      retroPrompts.push({
        category: "quality",
        question: `Average ticket quality is ${avgQuality}%. Many tickets lack descriptions, estimates, or acceptance criteria. Should we introduce a Definition of Ready?`,
        context: `Poor quality tickets: ${qualityDistribution.poor}`,
      });
    }

    // Always include these general prompts
    retroPrompts.push(
      { category: "positive", question: "What went well this sprint that we should keep doing?", context: `Done: ${doneIssues.length} issues` },
      { category: "improvement", question: "What is one process change that would have the biggest impact on our delivery speed?", context: `Avg cycle time: ${avgCycleTime}d` },
    );

    // ── Definition of Done Checklist ──
    const dodChecklist = doneIssues.slice(0, 50).map((issue) => {
      const checks = {
        hasDescription: (issue.fields.description || "").length > 30,
        hasComments: (issue.fields.comment?.total || 0) >= 1,
        hasEstimate: !!issue.fields.timetracking?.originalEstimate,
        hasLabels: (issue.fields.labels || []).length > 0,
        hasAssignee: !!issue.fields.assignee,
      };
      const passed = Object.values(checks).filter(Boolean).length;
      return {
        key: issue.key,
        summary: issue.fields.summary,
        checks,
        score: Math.round((passed / Object.keys(checks).length) * 100),
      };
    });

    const dodAvgScore = dodChecklist.length > 0
      ? Math.round(dodChecklist.reduce((s, d) => s + d.score, 0) / dodChecklist.length)
      : 0;

    res.json({
      total: data.total,
      qualityScores: qualityScores.sort((a, b) => a.qualityScore - b.qualityScore),
      avgQuality,
      qualityDistribution,
      wipIssues,
      wipBuckets,
      wipCount: wipIssues.length,
      statusDistribution: Object.values(statusMap).sort((a, b) => b.count - a.count),
      priorityDistribution: Object.values(priorityMap).sort((a, b) => b.count - a.count),
      priorityInflation,
      teamWorkload: Object.values(teamMap).sort((a, b) => b.total - a.total),
      dueDateCompliance: {
        totalWithDueDate: withDueDate.length,
        completedOnTime: completedOnTime.length,
        overdueActive: overdueActive.length,
        complianceRate: doneWithDueDate.length > 0
          ? Math.round((completedOnTime.length / doneWithDueDate.length) * 100)
          : null,
      },
      cycleTime: {
        avg: avgCycleTime,
        median: medianCycleTime,
        buckets: cycleTimeBuckets,
        sampleSize: cycleTimes.length,
      },
      staleIssues,
      unassignedActive,
      // ── Agile Coach Features ──
      bottlenecks,
      wipLimits: {
        perPerson: wipLimitPerPerson,
        board: wipLimitBoard,
        violations: wipViolations,
      },
      sprintHealth: {
        score: healthScore,
        status: healthStatus,
        factors: healthFactors,
      },
      retroPrompts,
      definitionOfDone: {
        checklist: dodChecklist,
        avgScore: dodAvgScore,
      },
    });
  } catch (err) {
    console.error("Error computing analytics:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── AI endpoints (called by n8n) ───────────────────────

// AI endpoints return prompts only — no external LLM provider connections.
// Users copy the prompt into their own AI chatbot and paste back the response.

app.post("/ai/summarize-ticket", async (req, res) => {
  try {
    const ticketData = req.body;
    if (!ticketData || !ticketData.key) {
      return res.status(400).json({ error: "Missing ticket data (need at least 'key')" });
    }
    const { buildTicketPrompt } = await import("../ai-lib/prompts.js");
    const prompt = buildTicketPrompt(ticketData);
    res.json({ issue_key: ticketData.key, prompt });
  } catch (err) {
    console.error("Error building ticket prompt:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

app.post("/ai/summarize-board", async (req, res) => {
  try {
    const { tickets, jql } = req.body;
    if (!tickets || !Array.isArray(tickets)) {
      return res.status(400).json({ error: "Missing 'tickets' array in body" });
    }
    const { buildBoardPrompt } = await import("../ai-lib/prompts.js");
    const prompt = buildBoardPrompt(tickets);
    res.json({ jql: jql || "unknown", total_issues: tickets.length, prompt });
  } catch (err) {
    console.error("Error building board prompt:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── Hierarchy: full tree (Epic → Story → Task → Subtask) ──

app.get("/hierarchy", async (req, res) => {
  try {
    const jql = req.query.jql || (req.query.project ? `project = ${req.query.project} ORDER BY status ASC, updated DESC` : DEFAULT_JQL);
    if (!jql) return res.status(400).json({ error: "No JQL query provided. Configure a default JQL in Settings or provide a ?jql= parameter." });
    const epicFields = EPIC_LINK_FIELDS.join(",");
    const fieldsStr = `summary,status,assignee,priority,updated,created,duedate,description,issuetype,labels,comment,${epicFields},parent,timetracking,flagged,subtasks`;

    const data = await jiraSearchAll(jql, fieldsStr, 100, "", req.query.serverId);
    const now = Date.now();

    // Map all issues by key
    const issueMap = {};
    const issues = data.issues.map((issue) => {
      const lastComment = issue.fields.comment?.comments?.slice(-1)[0];
      const mapped = {
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status?.name,
        statusCategory: issue.fields.status?.statusCategory?.key,
        assigneeName: issue.fields.assignee?.displayName || null,
        priority: issue.fields.priority?.name,
        issueType: issue.fields.issuetype?.name,
        issueTypeIcon: issue.fields.issuetype?.iconUrl,
        labels: issue.fields.labels || [],
        created: issue.fields.created,
        updated: issue.fields.updated,
        dueDate: issue.fields.duedate || null,
        epicKey: getEpicKey(issue.fields),
        parentKey: issue.fields.parent?.key || null,
        parentType: issue.fields.parent?.fields?.issuetype?.name || null,
        originalEstimate: issue.fields.timetracking?.originalEstimate || null,
        commentCount: issue.fields.comment?.total || 0,
        daysSinceUpdate: daysSince(issue.fields.updated),
        description: (issue.fields.description || "").substring(0, 500),
        children: [],
      };
      mapped.urgencyFlags = computeUrgency(mapped);
      issueMap[mapped.key] = mapped;
      return mapped;
    });

    // Build the tree by linking children to parents
    // Priority: parent field → epicKey field
    const roots = [];
    const attached = new Set();

    for (const issue of issues) {
      // Try direct parent first
      if (issue.parentKey && issueMap[issue.parentKey]) {
        issueMap[issue.parentKey].children.push(issue);
        attached.add(issue.key);
      } else if (issue.epicKey && issue.epicKey !== issue.key && issueMap[issue.epicKey]) {
        issueMap[issue.epicKey].children.push(issue);
        attached.add(issue.key);
      }
    }

    // Roots = issues not attached to any parent within the result set
    for (const issue of issues) {
      if (!attached.has(issue.key)) {
        roots.push(issue);
      }
    }

    // Sort children recursively
    function sortTree(nodes) {
      nodes.sort((a, b) => {
        // Epics first, then Stories, then Tasks, then Sub-tasks
        const typeOrder = { Epic: 0, Story: 1, Task: 2, "Sub-task": 3, Bug: 2 };
        const aOrder = typeOrder[a.issueType] ?? 4;
        const bOrder = typeOrder[b.issueType] ?? 4;
        if (aOrder !== bOrder) return aOrder - bOrder;
        // Then by status category (todo → in-progress → done)
        const catOrder = { new: 0, indeterminate: 1, done: 2 };
        return (catOrder[a.statusCategory] ?? 1) - (catOrder[b.statusCategory] ?? 1);
      });
      for (const node of nodes) {
        if (node.children.length > 0) sortTree(node.children);
      }
    }
    sortTree(roots);

    // Compute tree stats
    function countTree(nodes) {
      let total = 0, done = 0, inProgress = 0, criticals = 0;
      for (const n of nodes) {
        total++;
        if (n.statusCategory === "done") done++;
        else if (n.statusCategory === "indeterminate") inProgress++;
        criticals += n.urgencyFlags.filter((f) => f.severity === "critical").length;
        const sub = countTree(n.children);
        total += sub.total; done += sub.done; inProgress += sub.inProgress; criticals += sub.criticals;
      }
      return { total, done, inProgress, criticals };
    }

    // Agile coach warnings based on hierarchy analysis
    const coachWarnings = [];
    const allFlat = issues;

    // Check: orphan tasks (no parent/epic)
    const orphans = allFlat.filter((i) => !i.parentKey && !i.epicKey && i.issueType !== "Epic");
    if (orphans.length > 0) {
      coachWarnings.push({
        severity: "warning",
        title: `${orphans.length} orphan ticket${orphans.length > 1 ? "s" : ""} without parent or epic`,
        detail: "Every ticket should belong to a story or epic for proper tracking. Assign parents to: " +
          orphans.slice(0, 5).map((o) => o.key).join(", ") + (orphans.length > 5 ? ` (+${orphans.length - 5} more)` : ""),
        category: "hierarchy",
      });
    }

    // Check: epics with no children
    const emptyEpics = allFlat.filter((i) => i.issueType === "Epic" && i.children.length === 0);
    if (emptyEpics.length > 0) {
      coachWarnings.push({
        severity: "info",
        title: `${emptyEpics.length} epic${emptyEpics.length > 1 ? "s" : ""} with no child tickets`,
        detail: "Epics should be broken down into stories/tasks: " +
          emptyEpics.slice(0, 5).map((e) => e.key).join(", "),
        category: "hierarchy",
      });
    }

    // Check: deep nesting (more than 3 levels)
    function maxDepth(node, depth = 1) {
      if (node.children.length === 0) return depth;
      return Math.max(...node.children.map((c) => maxDepth(c, depth + 1)));
    }
    const deepRoots = roots.filter((r) => maxDepth(r) > 4);
    if (deepRoots.length > 0) {
      coachWarnings.push({
        severity: "warning",
        title: "Excessive nesting depth detected (>4 levels)",
        detail: "Keep hierarchy to Epic → Story → Task → Subtask (4 levels max) for clarity.",
        category: "hierarchy",
      });
    }

    // Check: stories directly under epics with >10 stories
    const bigEpics = allFlat.filter((i) => i.issueType === "Epic" && i.children.length > 10);
    if (bigEpics.length > 0) {
      coachWarnings.push({
        severity: "info",
        title: `${bigEpics.length} epic${bigEpics.length > 1 ? "s" : ""} with >10 direct children`,
        detail: "Large epics are hard to manage. Consider splitting: " +
          bigEpics.slice(0, 3).map((e) => `${e.key} (${e.children.length} children)`).join(", "),
        category: "scope",
      });
    }

    // Check: tasks/stories without estimates
    const noEstimate = allFlat.filter((i) =>
      i.issueType !== "Epic" && !i.originalEstimate && i.statusCategory !== "done"
    );
    if (noEstimate.length > allFlat.length * 0.3) {
      coachWarnings.push({
        severity: "warning",
        title: `${noEstimate.length} active tickets (${Math.round((noEstimate.length / allFlat.length) * 100)}%) without estimates`,
        detail: "Estimates improve predictability. Use planning poker or T-shirt sizing to estimate work.",
        category: "estimation",
      });
    }

    const treeStats = countTree(roots);

    // Unique assignees and statuses for filter options
    const assignees = [...new Set(allFlat.map((i) => i.assigneeName).filter(Boolean))].sort();
    const statuses = [...new Set(allFlat.map((i) => i.status).filter(Boolean))].sort();
    const issueTypes = [...new Set(allFlat.map((i) => i.issueType).filter(Boolean))].sort();
    const priorities = [...new Set(allFlat.map((i) => i.priority).filter(Boolean))];

    res.json({
      tree: roots,
      stats: treeStats,
      filterOptions: { assignees, statuses, issueTypes, priorities },
      coachWarnings,
      total: data.total,
    });
  } catch (err) {
    console.error("Error building hierarchy:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── Retro Collaboration (in-memory) ──────

let retroSessions = {};

app.get("/retro/sessions", (req, res) => {
  const sessions = Object.values(retroSessions)
    .map(({ id, title, createdAt, entries }) => ({ id, title, createdAt, entryCount: entries.length }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(sessions);
});

app.post("/retro/sessions", (req, res) => {
  const title = req.body.title || `Retrospective ${new Date().toISOString().split("T")[0]}`;
  const id = `retro-${Date.now()}`;
  const session = { id, title, createdAt: new Date().toISOString(), entries: [] };
  retroSessions[id] = session;
  res.json(session);
});

app.get("/retro/sessions/:id", (req, res) => {
  const session = retroSessions[req.params.id];
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

app.post("/retro/sessions/:id/entries", (req, res) => {
  const { author, category, text } = req.body;
  if (!text || !category) return res.status(400).json({ error: "Missing text or category" });

  const entry = {
    id: `entry-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    author: author || "Anonymous",
    category, text, votes: 0,
    createdAt: new Date().toISOString(),
  };

  const session = retroSessions[req.params.id];
  if (!session) return res.status(404).json({ error: "Session not found" });
  session.entries.push(entry);
  res.json(entry);
});

app.post("/retro/sessions/:id/entries/:entryId/vote", (req, res) => {
  const session = retroSessions[req.params.id];
  if (!session) return res.status(404).json({ error: "Session not found" });
  const entry = session.entries.find((e) => e.id === req.params.entryId);
  if (!entry) return res.status(404).json({ error: "Entry not found" });
  entry.votes += 1;
  res.json(entry);
});

app.delete("/retro/sessions/:id", (req, res) => {
  delete retroSessions[req.params.id];
  res.json({ ok: true });
});

// Helper: serialize server for API responses (no credentials)
function serializeServers() {
  return JIRA_SERVERS.map((s) => ({
    id: s.id, name: s.name, url: s.url,
    browserUrl: s.browserUrl || "",
    projects: s.projects || [],
    hasCredentials: !!(s.username && s.token),
  }));
}

function configResponse() {
  return {
    servers: serializeServers(),
    teams: TEAMS,
    defaultTeamId: DEFAULT_TEAM_ID,
    jqlBookmarks: JQL_BOOKMARKS,
    configSource,
    needsSetup: needsSetup(),
  };
}

// Lightweight status check for frontend setup guard
app.get("/config/status", (req, res) => {
  const primaryServer = JIRA_SERVERS[0];
  // Resolve default JQL: env var > default team's JQL > empty
  let resolvedDefaultJql = DEFAULT_JQL;
  if (!resolvedDefaultJql && DEFAULT_TEAM_ID) {
    const team = TEAMS.find((tm) => tm.id === DEFAULT_TEAM_ID);
    if (team) resolvedDefaultJql = team.jql || (team.projectKey ? `project = ${team.projectKey} ORDER BY status ASC, updated DESC` : "");
  }
  res.json({
    needsSetup: needsSetup(),
    configSource,
    serverCount: JIRA_SERVERS.length,
    teamCount: TEAMS.length,
    defaultJql: resolvedDefaultJql,
    defaultTeamId: DEFAULT_TEAM_ID,
    browserUrl: primaryServer ? getBrowserUrl(primaryServer) : "",
  });
});

// Test connection to a Jira server (without saving)
app.post("/config/test-connection", async (req, res) => {
  let { url, username, token, serverId } = req.body;
  // Allow testing with saved credentials
  if (username === "__use_saved__" || token === "__use_saved__") {
    const existing = JIRA_SERVERS.find((s) => s.url === url) || JIRA_SERVERS.find((s) => s.id === serverId);
    if (existing) {
      if (username === "__use_saved__") username = existing.username;
      if (token === "__use_saved__") token = existing.token;
    }
  }
  if (!url || !username || !token) {
    return res.status(400).json({ ok: false, error: "URL, username, and token are required" });
  }
  try {
    const testUrl = `${url.replace(/\/+$/, "")}/rest/api/2/myself`;
    const resp = await fetch(testUrl, {
      headers: {
        Authorization: "Basic " + Buffer.from(`${username}:${token}`).toString("base64"),
        Accept: "application/json",
      },
    });
    if (!resp.ok) {
      const text = await resp.text();
      let detail = `HTTP ${resp.status}`;
      if (resp.status === 401) detail = "Authentication failed — check username and token";
      else if (resp.status === 403) detail = "Forbidden — user lacks API access";
      else if (resp.status === 404) detail = "Jira API not found at this URL";
      else detail += `: ${text.slice(0, 200)}`;
      return res.json({ ok: false, error: detail });
    }
    const user = await resp.json();

    // Fetch projects list for the setup wizard
    let projects = [];
    try {
      const projUrl = `${url.replace(/\/+$/, "")}/rest/api/2/project`;
      const projResp = await fetch(projUrl, {
        headers: {
          Authorization: "Basic " + Buffer.from(`${username}:${token}`).toString("base64"),
          Accept: "application/json",
        },
      });
      if (projResp.ok) {
        const projData = await projResp.json();
        projects = projData.map((p) => ({ key: p.key, name: p.name }));
      }
    } catch {
      // Non-fatal — projects list is optional
    }

    return res.json({ ok: true, displayName: user.displayName, emailAddress: user.emailAddress, projects });
  } catch (err) {
    return res.json({ ok: false, error: describeNetworkError(err, url) });
  }
});

// Get configuration: servers, teams
app.get("/config", (req, res) => {
  res.json(configResponse());
});

// Update configuration at runtime and persist to file
app.post("/config", (req, res) => {
  if (req.body.teams) TEAMS = req.body.teams;
  if (req.body.servers) {
    for (const update of req.body.servers) {
      const existing = JIRA_SERVERS.find((s) => s.id === update.id);
      if (existing) {
        if (update.name !== undefined) existing.name = update.name;
        if (update.projects !== undefined) existing.projects = update.projects;
        if (update.url !== undefined) existing.url = update.url;
        if (update.browserUrl !== undefined) existing.browserUrl = update.browserUrl;
        if (update.username !== undefined) existing.username = update.username;
        if (update.token && update.token !== "••••••••") existing.token = update.token;
      } else if (update.url && update.username && update.token) {
        JIRA_SERVERS.push({
          id: update.id || `server-${Date.now()}`,
          name: update.name || "New Server",
          url: update.url,
          browserUrl: update.browserUrl || "",
          username: update.username,
          token: update.token,
          projects: update.projects || [],
        });
      }
    }
  }
  if (req.body.defaultTeamId !== undefined) DEFAULT_TEAM_ID = req.body.defaultTeamId;
  if (req.body.jqlBookmarks) JQL_BOOKMARKS = req.body.jqlBookmarks;
  // Delete servers by id
  if (req.body.deleteServerIds && Array.isArray(req.body.deleteServerIds)) {
    const referencedServerIds = new Set(TEAMS.map((t) => t.serverId));
    const safeToDelete = req.body.deleteServerIds.filter((id) => !referencedServerIds.has(id));
    JIRA_SERVERS = JIRA_SERVERS.filter((s) => !safeToDelete.includes(s.id));
  }
  // Persist to disk
  configSource = "file";
  saveConfigToFile();
  res.json(configResponse());
});

// Import full config.json — replaces everything
app.post("/config/import", (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== "object") {
      return res.status(400).json({ error: "Invalid JSON" });
    }
    if (data.servers && Array.isArray(data.servers)) JIRA_SERVERS = data.servers;
    if (data.teams && Array.isArray(data.teams)) TEAMS = data.teams;
    if (data.defaultTeamId !== undefined) DEFAULT_TEAM_ID = data.defaultTeamId;
    if (data.jqlBookmarks && Array.isArray(data.jqlBookmarks)) JQL_BOOKMARKS = data.jqlBookmarks;
    configSource = "file";
    saveConfigToFile();
    res.json({ ok: true, ...configResponse() });
  } catch (err) {
    res.status(400).json({ error: "Failed to import config: " + err.message });
  }
});

// Reset config: delete file and reload from env vars
app.post("/config/reset", (req, res) => {
  try { fs.unlinkSync(CONFIG_FILE); } catch {}
  // Re-parse from env vars
  try { JIRA_SERVERS = JSON.parse(process.env.JIRA_SERVERS || "[]"); } catch { JIRA_SERVERS = []; }
  try { TEAMS = JSON.parse(process.env.TEAMS || "[]"); } catch { TEAMS = []; }
  JQL_BOOKMARKS = [];
  if (JIRA_SERVERS.length === 0 && JIRA_API_TOKEN) {
    JIRA_SERVERS.push({
      id: "primary", name: "Primary Jira", url: JIRA_BASE_URL,
      username: JIRA_USERNAME, token: JIRA_API_TOKEN,
      projects: [JIRA_PROJECT_KEY], browserUrl: "",
    });
  }
  if (TEAMS.length === 0 && JIRA_SERVERS.length > 0) {
    TEAMS.push({ id: "default", name: "Default Team", serverId: JIRA_SERVERS[0].id,
      projectKey: JIRA_SERVERS[0].projects?.[0] || "", boardId: null, color: "#3B82F6" });
  }
  configSource = JIRA_SERVERS.length > 0 ? "env vars" : "defaults";
  res.json(configResponse());
});

// ─── JQL Bookmarks CRUD ──────────────────────────────────

app.get("/bookmarks", (req, res) => {
  res.json({ bookmarks: JQL_BOOKMARKS });
});

app.post("/bookmarks", (req, res) => {
  const { name, jql } = req.body;
  if (!name || !jql) return res.status(400).json({ error: "name and jql required" });
  const id = `bm-${Date.now()}`;
  JQL_BOOKMARKS.push({ id, name, jql });
  saveConfigToFile();
  res.json({ bookmarks: JQL_BOOKMARKS });
});

app.delete("/bookmarks/:id", (req, res) => {
  JQL_BOOKMARKS = JQL_BOOKMARKS.filter((b) => b.id !== req.params.id);
  saveConfigToFile();
  res.json({ bookmarks: JQL_BOOKMARKS });
});

// Quick queries: returns all projects, teams, and bookmarks for the JQL dropdown
app.get("/quick-queries", (req, res) => {
  const projects = [];
  for (const server of JIRA_SERVERS) {
    for (const projectKey of (server.projects || [])) {
      projects.push({
        key: projectKey,
        serverName: server.name,
        serverId: server.id,
        jql: `project = ${projectKey} ORDER BY status ASC, updated DESC`,
      });
    }
  }
  const teams = TEAMS.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    projectKey: t.projectKey,
    jql: t.jql || `project = ${t.projectKey} ORDER BY status ASC, updated DESC`,
    isCustom: !!(t.jql && t.jql.trim()),
  }));
  res.json({ projects, teams, bookmarks: JQL_BOOKMARKS });
});



// ─── Compliance: Per-Project Agile Health ─────────────────
app.get("/compliance/projects", async (req, res) => {
  try {
    const FIELDS = "summary,status,issuetype,priority,assignee,created,updated,duedate,description,timetracking,issuelinks," +
      (EPIC_LINK_FIELDS.join(",") || "customfield_10014") + ",labels,components,resolution,parent,subtasks,comment,flagged,customfield_10021";
    const NOW = Date.now();
    const DAY = 86400000;

    const results = await Promise.all(TEAMS.map(async (team) => {
      const server = getServer(team.serverId);
      const userJql = req.query.jql;
      let baseJql = team.jql || `project = ${team.projectKey}`;
      const jql = userJql ? `(${baseJql}) AND (${stripOrderBy(userJql)}) ORDER BY status ASC, updated DESC` : `${baseJql} ORDER BY status ASC, updated DESC`;
      let issues = [];
      try {
        const data = await jiraSearchAllFrom(server, jql, FIELDS);
        issues = data.issues;
      } catch (err) {
        return { team: { id: team.id, name: team.name, color: team.color, projectKey: team.projectKey, serverUrl: getBrowserUrl(server) }, score: 0, checks: [], error: err.message };
      }

      const checks = [];
      const total = issues.length;
      if (total === 0) {
        return { team: { id: team.id, name: team.name, color: team.color, projectKey: team.projectKey, serverUrl: getBrowserUrl(server) }, score: 0, checks: [{ id: "no-issues", name: "No Issues Found", score: 0, maxScore: 100, status: "critical", description: "This project has no issues matching the query. Create stories and tasks to start tracking work.", action: null }], error: null };
      }

      const statusCat = (i) => (i.fields.status?.statusCategory?.key || "new");
      const inProgress = issues.filter((i) => statusCat(i) === "indeterminate");
      const done = issues.filter((i) => statusCat(i) === "done");
      const todo = issues.filter((i) => statusCat(i) === "new");
      const notDone = issues.filter((i) => statusCat(i) !== "done");

      // 1. Description completeness (10 pts)
      const withDesc = notDone.filter((i) => i.fields.description && i.fields.description.length >= 30);
      const descPct = notDone.length > 0 ? Math.round((withDesc.length / notDone.length) * 100) : 100;
      const descScore = Math.round(descPct / 10);
      const missingDescKeys = notDone.filter((i) => !i.fields.description || i.fields.description.length < 30).slice(0, 5).map((i) => i.key);
      checks.push({
        id: "descriptions", name: "Story Descriptions", score: descScore, maxScore: 10,
        status: descScore >= 8 ? "pass" : descScore >= 5 ? "warning" : "fail",
        description: `${descPct}% of active tickets have meaningful descriptions (≥30 chars). Every story/task should clearly describe the work to be done so any team member can pick it up.`,
        detail: `${withDesc.length}/${notDone.length} active tickets have descriptions.`,
        action: missingDescKeys.length > 0 ? { label: "Fix in Jira", keys: missingDescKeys, serverUrl: getBrowserUrl(server) } : null,
      });

      // 2. Acceptance Criteria (10 pts)
      const acRegex = /acceptance\s*criteria|given\s.*when\s.*then|\bAC[:\s]|definition\s*of\s*done|\[x\]|\[ \]/i;
      const stories = notDone.filter((i) => ["Story", "Bug", "Task"].includes(i.fields.issuetype?.name));
      const withAC = stories.filter((i) => i.fields.description && acRegex.test(i.fields.description));
      const acPct = stories.length > 0 ? Math.round((withAC.length / stories.length) * 100) : 100;
      const acScore = Math.round(acPct / 10);
      const missingACKeys = stories.filter((i) => !i.fields.description || !acRegex.test(i.fields.description)).slice(0, 5).map((i) => i.key);
      checks.push({
        id: "acceptance-criteria", name: "Acceptance Criteria", score: acScore, maxScore: 10,
        status: acScore >= 8 ? "pass" : acScore >= 5 ? "warning" : "fail",
        description: `${acPct}% of stories/tasks include acceptance criteria in their description. Clear AC ensures everyone agrees on "done" and prevents scope creep. Use "Given/When/Then", checklists, or "AC:" sections.`,
        detail: `${withAC.length}/${stories.length} stories have acceptance criteria.`,
        action: missingACKeys.length > 0 ? { label: "Add AC", keys: missingACKeys, serverUrl: getBrowserUrl(server) } : null,
      });

      // 3. Assignee coverage for in-progress items (10 pts)
      const wipWithAssignee = inProgress.filter((i) => i.fields.assignee);
      const assigneePct = inProgress.length > 0 ? Math.round((wipWithAssignee.length / inProgress.length) * 100) : 100;
      const assigneeScore = Math.round(assigneePct / 10);
      const unassignedKeys = inProgress.filter((i) => !i.fields.assignee).slice(0, 5).map((i) => i.key);
      checks.push({
        id: "assignees", name: "WIP Assignee Coverage", score: assigneeScore, maxScore: 10,
        status: assigneeScore >= 9 ? "pass" : assigneeScore >= 6 ? "warning" : "fail",
        description: `${assigneePct}% of in-progress items have an assignee. Every item being actively worked on must have a clear owner to avoid confusion and duplicate work.`,
        detail: `${wipWithAssignee.length}/${inProgress.length} in-progress items are assigned.`,
        action: unassignedKeys.length > 0 ? { label: "Assign owner", keys: unassignedKeys, serverUrl: getBrowserUrl(server) } : null,
      });

      // 4. WIP limits (10 pts)
      const wipCount = inProgress.length;
      const idealWip = Math.max(TEAMS.length > 0 ? 5 : 3, 3); // rough per-team WIP
      const wipRatio = wipCount / Math.max(idealWip, 1);
      const wipScore = wipRatio <= 1 ? 10 : wipRatio <= 1.5 ? 7 : wipRatio <= 2 ? 4 : 1;
      checks.push({
        id: "wip-limits", name: "WIP Limits", score: wipScore, maxScore: 10,
        status: wipScore >= 8 ? "pass" : wipScore >= 5 ? "warning" : "fail",
        description: `${wipCount} items currently in progress (recommended: ≤${idealWip}). Limiting WIP increases throughput, reduces context switching, and surfaces bottlenecks faster. Agile teams should pull work only when capacity allows.`,
        detail: `${wipCount} in-progress vs ${idealWip} recommended WIP limit.`,
        action: wipCount > idealWip ? { label: "Review WIP", keys: inProgress.slice(0, 5).map((i) => i.key), serverUrl: getBrowserUrl(server) } : null,
      });

      // 5. Stale tickets (10 pts)
      const staleThreshold = 14 * DAY;
      const stale = notDone.filter((i) => {
        const updated = new Date(i.fields.updated).getTime();
        return (NOW - updated) > staleThreshold;
      });
      const stalePct = notDone.length > 0 ? Math.round(((notDone.length - stale.length) / notDone.length) * 100) : 100;
      const staleScore = Math.round(stalePct / 10);
      checks.push({
        id: "stale-tickets", name: "Stale Ticket Hygiene", score: staleScore, maxScore: 10,
        status: staleScore >= 8 ? "pass" : staleScore >= 5 ? "warning" : "fail",
        description: `${stale.length} tickets not updated in 14+ days. Stale tickets clutter the backlog, hide real priorities, and give a false picture of scope. Review, update, or close them.`,
        detail: `${stale.length}/${notDone.length} active tickets are stale (not updated in 14+ days).`,
        action: stale.length > 0 ? { label: "Review stale", keys: stale.slice(0, 5).map((i) => i.key), serverUrl: getBrowserUrl(server) } : null,
      });

      // 6. Epic coverage (10 pts)
      const nonEpics = notDone.filter((i) => i.fields.issuetype?.name !== "Epic");
      const hasEpicLink = (i) => EPIC_LINK_FIELDS.some((f) => i.fields[f]);
      const withEpic = nonEpics.filter(hasEpicLink);
      const epicPct = nonEpics.length > 0 ? Math.round((withEpic.length / nonEpics.length) * 100) : 100;
      const epicScore = Math.round(epicPct / 10);
      const orphanKeys = nonEpics.filter((i) => !hasEpicLink(i)).slice(0, 5).map((i) => i.key);
      checks.push({
        id: "epic-coverage", name: "Epic Coverage", score: epicScore, maxScore: 10,
        status: epicScore >= 8 ? "pass" : epicScore >= 5 ? "warning" : "fail",
        description: `${epicPct}% of stories/tasks belong to an epic. Orphan tickets make it impossible to track feature progress and hide work from stakeholders. Every item should roll up to an epic.`,
        detail: `${withEpic.length}/${nonEpics.length} non-epic items linked to an epic.`,
        action: orphanKeys.length > 0 ? { label: "Link to epic", keys: orphanKeys, serverUrl: getBrowserUrl(server) } : null,
      });

      // 7. Priority distribution (10 pts) — healthy = pyramid shape
      const priorities = {};
      notDone.forEach((i) => { const p = i.fields.priority?.name || "None"; priorities[p] = (priorities[p] || 0) + 1; });
      const highestCount = (priorities["Highest"] || 0) + (priorities["Blocker"] || 0);
      const highCount = priorities["High"] || 0;
      const topHeavyPct = notDone.length > 0 ? Math.round(((highestCount + highCount) / notDone.length) * 100) : 0;
      const prioScore = topHeavyPct <= 20 ? 10 : topHeavyPct <= 35 ? 8 : topHeavyPct <= 50 ? 5 : topHeavyPct <= 70 ? 3 : 1;
      checks.push({
        id: "priority-distribution", name: "Priority Distribution", score: prioScore, maxScore: 10,
        status: prioScore >= 8 ? "pass" : prioScore >= 5 ? "warning" : "fail",
        description: `${topHeavyPct}% of tickets are High or Highest priority. When everything is urgent, nothing is. A healthy backlog follows a pyramid: few critical items, moderate high, many medium/low. Re-prioritize regularly.`,
        detail: `Highest: ${highestCount}, High: ${highCount}, Medium: ${priorities["Medium"] || 0}, Low: ${(priorities["Low"] || 0) + (priorities["Lowest"] || 0)}`,
        action: topHeavyPct > 35 ? { label: "Re-prioritize", keys: notDone.filter((i) => ["Highest", "Blocker", "High"].includes(i.fields.priority?.name)).slice(0, 5).map((i) => i.key), serverUrl: getBrowserUrl(server) } : null,
      });

      // 8. Due dates on epics (10 pts)
      const epics = issues.filter((i) => i.fields.issuetype?.name === "Epic" && statusCat(i) !== "done");
      const epicsWithDue = epics.filter((i) => i.fields.duedate);
      const duePct = epics.length > 0 ? Math.round((epicsWithDue.length / epics.length) * 100) : 100;
      const dueScore = Math.round(duePct / 10);
      checks.push({
        id: "epic-due-dates", name: "Epic Due Dates", score: dueScore, maxScore: 10,
        status: dueScore >= 8 ? "pass" : dueScore >= 5 ? "warning" : "fail",
        description: `${duePct}% of active epics have due dates. Epics without target dates have no urgency signal, making planning and forecasting impossible. Set realistic due dates and track them.`,
        detail: `${epicsWithDue.length}/${epics.length} active epics have due dates set.`,
        action: epics.filter((i) => !i.fields.duedate).length > 0 ? { label: "Set due dates", keys: epics.filter((i) => !i.fields.duedate).slice(0, 5).map((i) => i.key), serverUrl: getBrowserUrl(server) } : null,
      });

      // 9. Estimation coverage (10 pts)
      const estimable = notDone.filter((i) => ["Story", "Task", "Bug"].includes(i.fields.issuetype?.name));
      const withEstimate = estimable.filter((i) => i.fields.timetracking?.originalEstimate || i.fields.timetracking?.remainingEstimate || (i.fields.customfield_10016 != null));
      const estPct = estimable.length > 0 ? Math.round((withEstimate.length / estimable.length) * 100) : 100;
      const estScore = Math.round(estPct / 10);
      checks.push({
        id: "estimates", name: "Story Estimation", score: estScore, maxScore: 10,
        status: estScore >= 7 ? "pass" : estScore >= 4 ? "warning" : "fail",
        description: `${estPct}% of stories/tasks have estimates (story points or time). Estimation enables velocity tracking, sprint planning, and forecasting. Teams that don't estimate can't predict delivery.`,
        detail: `${withEstimate.length}/${estimable.length} estimable items have story points or time estimates.`,
        action: estimable.filter((i) => !i.fields.timetracking?.originalEstimate && i.fields.customfield_10016 == null).length > 0 ? { label: "Add estimates", keys: estimable.filter((i) => !i.fields.timetracking?.originalEstimate && i.fields.customfield_10016 == null).slice(0, 5).map((i) => i.key), serverUrl: getBrowserUrl(server) } : null,
      });

      // 10. Done ratio health (10 pts) — at least some throughput
      const donePct = total > 0 ? Math.round((done.length / total) * 100) : 0;
      const throughputScore = donePct >= 20 ? 10 : donePct >= 10 ? 8 : donePct >= 5 ? 5 : donePct > 0 ? 3 : 0;
      checks.push({
        id: "throughput", name: "Delivery Throughput", score: throughputScore, maxScore: 10,
        status: throughputScore >= 8 ? "pass" : throughputScore >= 5 ? "warning" : "fail",
        description: `${donePct}% of tickets are done (${done.length}/${total}). Healthy teams show consistent throughput. Low completion may indicate blocked work, scope creep, or tickets created but never worked on.`,
        detail: `${done.length} done, ${inProgress.length} in progress, ${todo.length} to do out of ${total} total.`,
        action: null,
      });

      // ── Hierarchy / Architecture Compliance Checks ──

      // 11. Issue Type Hierarchy (10 pts) — proper Epic → Story/Task → Sub-task structure
      const subtasks = issues.filter((i) => i.fields.issuetype?.subtask === true || i.fields.issuetype?.name === "Sub-task");
      const storiesAndTasks = issues.filter((i) => ["Story", "Task", "Bug"].includes(i.fields.issuetype?.name));
      const subtasksWithParent = subtasks.filter((i) => i.fields.parent?.key);
      const subtaskOrphanPct = subtasks.length > 0 ? Math.round(((subtasks.length - subtasksWithParent.length) / subtasks.length) * 100) : 0;
      const storiesWithEpicOrParent = storiesAndTasks.filter((i) => hasEpicLink(i) || i.fields.parent?.key);
      const storyOrphanPct = storiesAndTasks.length > 0 ? Math.round(((storiesAndTasks.length - storiesWithEpicOrParent.length) / storiesAndTasks.length) * 100) : 0;
      // Combined: % of items correctly placed in hierarchy
      const hierarchyItems = [...subtasks, ...storiesAndTasks];
      const correctlyPlaced = [...subtasksWithParent, ...storiesWithEpicOrParent];
      const hierarchyPct = hierarchyItems.length > 0 ? Math.round((correctlyPlaced.length / hierarchyItems.length) * 100) : 100;
      const hierarchyScore = Math.round(hierarchyPct / 10);
      const orphanStoryKeys = storiesAndTasks.filter((i) => !hasEpicLink(i) && !i.fields.parent?.key).slice(0, 5).map((i) => i.key);
      const orphanSubtaskKeys = subtasks.filter((i) => !i.fields.parent?.key).slice(0, 5).map((i) => i.key);
      const hierarchyActionKeys = [...orphanStoryKeys, ...orphanSubtaskKeys].slice(0, 5);
      checks.push({
        id: "hierarchy-structure", name: "Issue Type Hierarchy", score: hierarchyScore, maxScore: 10,
        status: hierarchyScore >= 8 ? "pass" : hierarchyScore >= 5 ? "warning" : "fail",
        description: `${hierarchyPct}% of tickets follow proper hierarchy (Epic → Story/Task → Sub-task). ${storyOrphanPct}% of stories lack a parent epic, ${subtaskOrphanPct}% of sub-tasks lack a parent story. A clean hierarchy enables roll-up reporting, roadmap views, and dependency tracking.`,
        detail: `${correctlyPlaced.length}/${hierarchyItems.length} items correctly placed. ${storiesAndTasks.length - storiesWithEpicOrParent.length} orphan stories, ${subtasks.length - subtasksWithParent.length} orphan sub-tasks.`,
        action: hierarchyActionKeys.length > 0 ? { label: "Fix hierarchy", keys: hierarchyActionKeys, serverUrl: getBrowserUrl(server) } : null,
      });

      // 12. Epic Completeness (10 pts) — active epics should have child stories
      const activeEpics = issues.filter((i) => i.fields.issuetype?.name === "Epic" && statusCat(i) !== "done");
      const epicKeysSet = new Set(activeEpics.map((i) => i.key));
      // Find which epics have children (via epic link field or parent field)
      const epicsWithChildren = new Set();
      issues.forEach((i) => {
        if (i.fields.issuetype?.name === "Epic") return;
        // Check epic link fields
        for (const f of EPIC_LINK_FIELDS) {
          const val = i.fields[f];
          if (val && epicKeysSet.has(val)) { epicsWithChildren.add(val); break; }
        }
        // Check parent field
        if (i.fields.parent?.key && epicKeysSet.has(i.fields.parent.key)) {
          epicsWithChildren.add(i.fields.parent.key);
        }
      });
      const emptyEpics = activeEpics.filter((i) => !epicsWithChildren.has(i.key));
      const epicCompletePct = activeEpics.length > 0 ? Math.round((epicsWithChildren.size / activeEpics.length) * 100) : 100;
      const epicCompleteScore = Math.round(epicCompletePct / 10);
      checks.push({
        id: "epic-completeness", name: "Epic Completeness", score: epicCompleteScore, maxScore: 10,
        status: epicCompleteScore >= 8 ? "pass" : epicCompleteScore >= 5 ? "warning" : "fail",
        description: `${epicCompletePct}% of active epics (${epicsWithChildren.size}/${activeEpics.length}) have child stories or tasks. Empty epics are placeholders that clutter the board and give no visibility into actual work. Break them down into implementable stories.`,
        detail: `${emptyEpics.length} active epic(s) have no children.`,
        action: emptyEpics.length > 0 ? { label: "Break down epics", keys: emptyEpics.slice(0, 5).map((i) => i.key), serverUrl: getBrowserUrl(server) } : null,
      });

      // 13. Issue Type Consistency (10 pts) — using standard types, no "Task" misuse as sub-task, etc.
      const typeNames = {};
      issues.forEach((i) => { const t = i.fields.issuetype?.name || "Unknown"; typeNames[t] = (typeNames[t] || 0) + 1; });
      const standardTypes = new Set(["Epic", "Story", "Task", "Bug", "Sub-task", "Subtask", "Improvement", "Spike", "Tech Debt"]);
      const nonStandardTypes = Object.keys(typeNames).filter((t) => !standardTypes.has(t));
      const nonStandardCount = nonStandardTypes.reduce((s, t) => s + typeNames[t], 0);
      // Check for sub-tasks used at top level (no parent) — architectural misuse
      const topLevelSubtasks = subtasks.filter((i) => !i.fields.parent?.key);
      // Check for epics with a parent (shouldn't happen)
      const childEpics = issues.filter((i) => i.fields.issuetype?.name === "Epic" && i.fields.parent?.key);
      const misusedCount = topLevelSubtasks.length + childEpics.length;
      const consistencyPct = total > 0 ? Math.round(((total - nonStandardCount - misusedCount) / total) * 100) : 100;
      const consistencyScore = Math.round(Math.max(0, consistencyPct) / 10);
      checks.push({
        id: "type-consistency", name: "Issue Type Consistency", score: consistencyScore, maxScore: 10,
        status: consistencyScore >= 8 ? "pass" : consistencyScore >= 5 ? "warning" : "fail",
        description: `${consistencyPct}% of tickets use standard issue types correctly. ${nonStandardCount} ticket(s) use non-standard types${nonStandardTypes.length > 0 ? " (" + nonStandardTypes.join(", ") + ")" : ""}. ${topLevelSubtasks.length} sub-task(s) have no parent. ${childEpics.length} epic(s) are children of other issues. Consistent type usage enables filtering, reporting, and board configuration.`,
        detail: `Types: ${Object.entries(typeNames).map(([t, c]) => `${t}: ${c}`).join(", ")}. ${misusedCount} misused type(s).`,
        action: [...topLevelSubtasks, ...childEpics].length > 0 ? { label: "Fix types", keys: [...topLevelSubtasks, ...childEpics].slice(0, 5).map((i) => i.key), serverUrl: getBrowserUrl(server) } : null,
      });

      // ── Additional Quality & Hygiene Checks ──

      // 14. Labels or Components usage (10 pts) — categorization
      const withLabel = notDone.filter((i) => (i.fields.labels?.length > 0) || (i.fields.components?.length > 0));
      const labelPct = notDone.length > 0 ? Math.round((withLabel.length / notDone.length) * 100) : 100;
      const labelScore = Math.round(labelPct / 10);
      const unlabeledKeys = notDone.filter((i) => (!i.fields.labels || i.fields.labels.length === 0) && (!i.fields.components || i.fields.components.length === 0)).slice(0, 5).map((i) => i.key);
      checks.push({
        id: "labels-components", name: "Labels & Components", score: labelScore, maxScore: 10,
        status: labelScore >= 7 ? "pass" : labelScore >= 4 ? "warning" : "fail",
        description: `${labelPct}% of active tickets have labels or components. Categorization enables board filters, release notes, team routing, and reporting. Every ticket should have at least one label or component.`,
        detail: `${withLabel.length}/${notDone.length} active tickets are categorized.`,
        action: unlabeledKeys.length > 0 ? { label: "Add labels", keys: unlabeledKeys, serverUrl: getBrowserUrl(server) } : null,
      });

      // 15. Bug Ratio Health (10 pts) — too many bugs signals quality issues
      const bugs = notDone.filter((i) => i.fields.issuetype?.name === "Bug");
      const bugRatio = notDone.length > 0 ? Math.round((bugs.length / notDone.length) * 100) : 0;
      const bugScore = bugRatio <= 15 ? 10 : bugRatio <= 25 ? 8 : bugRatio <= 40 ? 5 : bugRatio <= 60 ? 3 : 1;
      checks.push({
        id: "bug-ratio", name: "Bug Ratio Health", score: bugScore, maxScore: 10,
        status: bugScore >= 8 ? "pass" : bugScore >= 5 ? "warning" : "fail",
        description: `${bugRatio}% of active tickets are bugs (${bugs.length}/${notDone.length}). A healthy ratio is ≤15%. High bug counts indicate technical debt, insufficient testing, or rushed releases. Prioritize root-cause fixes over patches.`,
        detail: `${bugs.length} open bugs out of ${notDone.length} active items.`,
        action: bugs.length > 0 ? { label: "Triage bugs", keys: bugs.slice(0, 5).map((i) => i.key), serverUrl: getBrowserUrl(server) } : null,
      });

      // 16. Done Items Have Resolution (10 pts) — proper closure
      const doneWithResolution = done.filter((i) => i.fields.resolution);
      const resPct = done.length > 0 ? Math.round((doneWithResolution.length / done.length) * 100) : 100;
      const resScore = Math.round(resPct / 10);
      const noResKeys = done.filter((i) => !i.fields.resolution).slice(0, 5).map((i) => i.key);
      checks.push({
        id: "done-resolution", name: "Done Resolution Set", score: resScore, maxScore: 10,
        status: resScore >= 9 ? "pass" : resScore >= 6 ? "warning" : "fail",
        description: `${resPct}% of done tickets have a resolution set (Fixed, Won't Fix, Duplicate, etc.). Tickets closed without resolution break velocity reports, make retrospectives harder, and hide whether work was actually completed or just abandoned.`,
        detail: `${doneWithResolution.length}/${done.length} done tickets have resolution.`,
        action: noResKeys.length > 0 ? { label: "Set resolution", keys: noResKeys, serverUrl: getBrowserUrl(server) } : null,
      });

      // 17. Backlog Freshness (10 pts) — old "To Do" tickets clog the backlog
      const backlogAgeThreshold = 60 * DAY; // 60 days
      const staleBacklog = todo.filter((i) => {
        const created = new Date(i.fields.created).getTime();
        return (NOW - created) > backlogAgeThreshold;
      });
      const freshPct = todo.length > 0 ? Math.round(((todo.length - staleBacklog.length) / todo.length) * 100) : 100;
      const freshScore = Math.round(freshPct / 10);
      checks.push({
        id: "backlog-freshness", name: "Backlog Freshness", score: freshScore, maxScore: 10,
        status: freshScore >= 8 ? "pass" : freshScore >= 5 ? "warning" : "fail",
        description: `${staleBacklog.length} of ${todo.length} backlog items are older than 60 days. Stale backlog gives a false sense of planned work. Regularly groom: close what you won't do, re-estimate and re-prioritize the rest.`,
        detail: `${staleBacklog.length} tickets in "To Do" created more than 60 days ago.`,
        action: staleBacklog.length > 0 ? { label: "Groom backlog", keys: staleBacklog.slice(0, 5).map((i) => i.key), serverUrl: getBrowserUrl(server) } : null,
      });

      // 18. Blocked / Flagged Items Visibility (10 pts) — flagged items need attention
      const flagged = notDone.filter((i) => {
        // Jira uses customfield_10021 or "flagged" for impediments
        const f = i.fields.flagged || i.fields.customfield_10021;
        if (Array.isArray(f)) return f.some((v) => v.value === "Impediment" || v.value === "Flagged");
        return f === "Impediment" || f === "Flagged" || f === true;
      });
      const blockedRatio = notDone.length > 0 ? Math.round((flagged.length / notDone.length) * 100) : 0;
      const blockedScore = blockedRatio <= 5 ? 10 : blockedRatio <= 10 ? 8 : blockedRatio <= 20 ? 5 : blockedRatio <= 30 ? 3 : 1;
      checks.push({
        id: "blocked-items", name: "Blocked / Flagged Items", score: blockedScore, maxScore: 10,
        status: blockedScore >= 8 ? "pass" : blockedScore >= 5 ? "warning" : "fail",
        description: `${flagged.length} item(s) flagged as blocked/impediment (${blockedRatio}% of active work). Blocked items should be resolved in ≤2 days. Escalate blockers in standups and remove impediments before starting new work.`,
        detail: `${flagged.length}/${notDone.length} active items are flagged.`,
        action: flagged.length > 0 ? { label: "Unblock items", keys: flagged.slice(0, 5).map((i) => i.key), serverUrl: getBrowserUrl(server) } : null,
      });

      // 19. Issue Link Coverage (10 pts) — traceability via links
      const linkableItems = notDone.filter((i) => ["Story", "Task", "Bug"].includes(i.fields.issuetype?.name));
      const withLinks = linkableItems.filter((i) => (i.fields.issuelinks?.length || 0) > 0);
      const linkPct = linkableItems.length > 0 ? Math.round((withLinks.length / linkableItems.length) * 100) : 100;
      const linkScore = linkPct >= 50 ? 10 : linkPct >= 35 ? 8 : linkPct >= 20 ? 5 : linkPct >= 10 ? 3 : 1;
      const unlinkedKeys = linkableItems.filter((i) => !i.fields.issuelinks || i.fields.issuelinks.length === 0).slice(0, 5).map((i) => i.key);
      checks.push({
        id: "link-coverage", name: "Issue Link Coverage", score: linkScore, maxScore: 10,
        status: linkScore >= 8 ? "pass" : linkScore >= 5 ? "warning" : "fail",
        description: `${linkPct}% of stories/tasks have issue links (blocks, relates-to, duplicates, etc.). Links surface dependencies, duplicates, and related work. Aim for ≥50% link coverage to maintain traceability across the project.`,
        detail: `${withLinks.length}/${linkableItems.length} linkable items have at least one issue link.`,
        action: unlinkedKeys.length > 0 ? { label: "Add links", keys: unlinkedKeys, serverUrl: getBrowserUrl(server) } : null,
      });

      // 20. Comment Activity (10 pts) — collaboration signal
      const recentWindow = 30 * DAY;
      const activeItems = notDone.filter((i) => statusCat(i) === "indeterminate" || (NOW - new Date(i.fields.updated).getTime()) < recentWindow);
      const withComments = activeItems.filter((i) => {
        const comments = i.fields.comment?.comments || i.fields.comment?.total;
        if (typeof comments === "number") return comments > 0;
        return Array.isArray(comments) && comments.length > 0;
      });
      const commentPct = activeItems.length > 0 ? Math.round((withComments.length / activeItems.length) * 100) : 100;
      const commentScore = commentPct >= 40 ? 10 : commentPct >= 25 ? 8 : commentPct >= 15 ? 5 : commentPct >= 5 ? 3 : 1;
      const silentKeys = activeItems.filter((i) => {
        const comments = i.fields.comment?.comments || i.fields.comment?.total;
        if (typeof comments === "number") return comments === 0;
        return !Array.isArray(comments) || comments.length === 0;
      }).slice(0, 5).map((i) => i.key);
      checks.push({
        id: "comment-activity", name: "Comment Activity", score: commentScore, maxScore: 10,
        status: commentScore >= 8 ? "pass" : commentScore >= 5 ? "warning" : "fail",
        description: `${commentPct}% of active/recent tickets have comments. Silent tickets signal misalignment, blocked decisions, or abandoned work. Use comments for updates, questions, and decisions — they create an audit trail.`,
        detail: `${withComments.length}/${activeItems.length} recently active items have at least one comment.`,
        action: silentKeys.length > 0 ? { label: "Add updates", keys: silentKeys, serverUrl: getBrowserUrl(server) } : null,
      });

      // 21. Epic Definition Quality (10 pts) — architecture: are epics well-defined?
      const activeEpics2 = notDone.filter((i) => i.fields.issuetype?.name === "Epic");
      if (activeEpics2.length > 0) {
        const epicQuality = activeEpics2.map((epic) => {
          let score = 0;
          const hasDesc = epic.fields.description && epic.fields.description.length >= 50;
          const hasAC = epic.fields.description && acRegex.test(epic.fields.description);
          const hasDue = !!epic.fields.duedate;
          if (hasDesc) score++;
          if (hasAC) score++;
          if (hasDue) score++;
          return { key: epic.key, score, total: 3, hasDesc, hasAC, hasDue };
        });
        const epicQualPct = Math.round((epicQuality.reduce((s, e) => s + e.score, 0) / (activeEpics2.length * 3)) * 100);
        const epicQualScore = Math.round(epicQualPct / 10);
        const poorEpics = epicQuality.filter((e) => e.score < 2).slice(0, 5).map((e) => e.key);
        checks.push({
          id: "epic-definition", name: "Epic Definition Quality", score: epicQualScore, maxScore: 10,
          status: epicQualScore >= 8 ? "pass" : epicQualScore >= 5 ? "warning" : "fail",
          description: `${epicQualPct}% of epic definition criteria met. Well-defined epics need: description (≥50 chars), acceptance criteria, and a due date. Poorly defined epics cascade into unclear stories and misaligned work.`,
          detail: `${activeEpics2.length} active epics checked (desc + AC + due date = 3 criteria each).`,
          action: poorEpics.length > 0 ? { label: "Improve epics", keys: poorEpics, serverUrl: getBrowserUrl(server) } : null,
        });
      }

      // 22. Story/Task Definition Quality (10 pts) — architecture: are stories ready for dev?
      const storyItems = notDone.filter((i) => ["Story", "Task", "Bug"].includes(i.fields.issuetype?.name));
      if (storyItems.length > 0) {
        const storyQuality = storyItems.map((item) => {
          let score = 0;
          const hasDesc = item.fields.description && item.fields.description.length >= 30;
          const hasAC = item.fields.description && acRegex.test(item.fields.description);
          const hasEst = !!(item.fields.timetracking?.originalEstimate || item.fields.timetracking?.remainingEstimate || item.fields.customfield_10016);
          const hasAssignee = !!item.fields.assignee;
          if (hasDesc) score++;
          if (hasAC) score++;
          if (hasEst) score++;
          if (hasAssignee) score++;
          return { key: item.key, score, total: 4, hasDesc, hasAC, hasEst, hasAssignee };
        });
        const storyQualPct = Math.round((storyQuality.reduce((s, e) => s + e.score, 0) / (storyItems.length * 4)) * 100);
        const storyQualScore = Math.round(storyQualPct / 10);
        const poorStories = storyQuality.filter((e) => e.score <= 1).slice(0, 5).map((e) => e.key);
        checks.push({
          id: "story-definition", name: "Story/Task Readiness", score: storyQualScore, maxScore: 10,
          status: storyQualScore >= 8 ? "pass" : storyQualScore >= 5 ? "warning" : "fail",
          description: `${storyQualPct}% of story/task readiness criteria met. A dev-ready ticket needs: description, acceptance criteria, estimate, and assignee. Tickets missing 3+ criteria are not ready for sprint and block delivery.`,
          detail: `${storyItems.length} stories/tasks/bugs checked (desc + AC + estimate + assignee = 4 criteria each).`,
          action: poorStories.length > 0 ? { label: "Complete tickets", keys: poorStories, serverUrl: getBrowserUrl(server) } : null,
        });
      }

      // 23. Subtask Completeness (10 pts) — architecture: are subtasks actionable?
      const activeSubtasks = notDone.filter((i) => {
        const typeName = (i.fields.issuetype?.name || "").toLowerCase();
        return typeName === "sub-task" || typeName === "subtask" || i.fields.issuetype?.subtask === true;
      });
      if (activeSubtasks.length > 0) {
        const subQuality = activeSubtasks.map((item) => {
          let score = 0;
          const hasAssignee = !!item.fields.assignee;
          const hasEst = !!(item.fields.timetracking?.originalEstimate || item.fields.timetracking?.remainingEstimate);
          const hasDesc = item.fields.description && item.fields.description.length >= 10;
          if (hasAssignee) score++;
          if (hasEst) score++;
          if (hasDesc) score++;
          return { key: item.key, score, total: 3 };
        });
        const subPct = Math.round((subQuality.reduce((s, e) => s + e.score, 0) / (activeSubtasks.length * 3)) * 100);
        const subScore = Math.round(subPct / 10);
        const poorSubs = subQuality.filter((e) => e.score === 0).slice(0, 5).map((e) => e.key);
        checks.push({
          id: "subtask-quality", name: "Subtask Completeness", score: subScore, maxScore: 10,
          status: subScore >= 8 ? "pass" : subScore >= 5 ? "warning" : "fail",
          description: `${subPct}% of subtask completeness criteria met. Actionable subtasks need: assignee, time estimate, and a brief description. Empty subtasks are invisible work that can't be tracked or measured.`,
          detail: `${activeSubtasks.length} subtasks checked (assignee + estimate + description = 3 criteria each).`,
          action: poorSubs.length > 0 ? { label: "Complete subtasks", keys: poorSubs, serverUrl: getBrowserUrl(server) } : null,
        });
      }

      // 24. Story Breakdown (10 pts) — architecture: are large stories decomposed?
      const largeStories = notDone.filter((i) => {
        if (!["Story", "Task"].includes(i.fields.issuetype?.name)) return false;
        const sp = i.fields.customfield_10016;
        const est = i.fields.timetracking?.originalEstimateSeconds;
        return (sp && sp >= 8) || (est && est >= 3 * 86400); // 8+ SP or 3+ days
      });
      if (largeStories.length > 0) {
        const withChildren = largeStories.filter((i) => {
          const subs = i.fields.subtasks;
          return subs && subs.length > 0;
        });
        const breakdownPct = Math.round((withChildren.length / largeStories.length) * 100);
        const breakdownScore = Math.round(breakdownPct / 10);
        const unbrokenKeys = largeStories.filter((i) => !i.fields.subtasks || i.fields.subtasks.length === 0).slice(0, 5).map((i) => i.key);
        checks.push({
          id: "story-breakdown", name: "Large Story Breakdown", score: breakdownScore, maxScore: 10,
          status: breakdownScore >= 8 ? "pass" : breakdownScore >= 5 ? "warning" : "fail",
          description: `${breakdownPct}% of large stories (≥8 SP or ≥3 days) are broken into subtasks. Large, undecomposed stories are risky — they hide complexity, resist estimation, and often slip. Break them into 1-2 day subtasks.`,
          detail: `${withChildren.length}/${largeStories.length} large stories have subtasks.`,
          action: unbrokenKeys.length > 0 ? { label: "Break down stories", keys: unbrokenKeys, serverUrl: getBrowserUrl(server) } : null,
        });
      }

      // 25. Due Soon (10 pts) — approaching deadlines
      const dueSoonItems = notDone.filter((i) => {
        if (!i.fields.duedate) return false;
        const daysLeft = Math.floor((new Date(i.fields.duedate).getTime() - NOW) / DAY);
        return daysLeft >= 0 && daysLeft <= 3;
      });
      const overdueItems = notDone.filter((i) => i.fields.duedate && new Date(i.fields.duedate).getTime() < NOW);
      const atRiskCount = dueSoonItems.length + overdueItems.length;
      const withDueDate = notDone.filter((i) => !!i.fields.duedate);
      const atRiskPct = withDueDate.length > 0 ? Math.round((atRiskCount / withDueDate.length) * 100) : 0;
      const dueSoonScore = atRiskPct <= 10 ? 10 : atRiskPct <= 20 ? 8 : atRiskPct <= 35 ? 5 : atRiskPct <= 50 ? 3 : 1;
      const dueSoonKeys = [...overdueItems, ...dueSoonItems].slice(0, 5).map((i) => i.key);
      checks.push({
        id: "due-soon", name: "Approaching Deadlines", score: dueSoonScore, maxScore: 10,
        status: dueSoonScore >= 8 ? "pass" : dueSoonScore >= 5 ? "warning" : "fail",
        description: `${atRiskCount} tickets are overdue or due within 3 days (${atRiskPct}% of dated items). Approaching deadlines need immediate attention — reassign, reduce scope, or communicate delays before they become overdue.`,
        detail: `${overdueItems.length} overdue + ${dueSoonItems.length} due in ≤3 days out of ${withDueDate.length} dated items.`,
        action: dueSoonKeys.length > 0 ? { label: "Address deadlines", keys: dueSoonKeys, serverUrl: getBrowserUrl(server) } : null,
      });

      // 26. Aging WIP (10 pts) — tickets stuck in-progress too long
      const agingThreshold = 10 * DAY; // 10 days in same status
      const agingWip = inProgress.filter((i) => {
        const lastUpdate = new Date(i.fields.updated).getTime();
        const created = new Date(i.fields.created).getTime();
        const inProgressDays = (NOW - Math.min(lastUpdate, created)) / DAY;
        return inProgressDays > 10;
      });
      const agingPct = inProgress.length > 0 ? Math.round((agingWip.length / inProgress.length) * 100) : 0;
      const agingScore = agingPct <= 10 ? 10 : agingPct <= 20 ? 8 : agingPct <= 35 ? 5 : agingPct <= 50 ? 3 : 1;
      const agingKeys = agingWip.slice(0, 5).map((i) => i.key);
      checks.push({
        id: "aging-wip", name: "Aging WIP", score: agingScore, maxScore: 10,
        status: agingScore >= 8 ? "pass" : agingScore >= 5 ? "warning" : "fail",
        description: `${agingWip.length} in-progress tickets have been open for 10+ days (${agingPct}% of WIP). Long-running WIP signals blocked work, scope creep, or tasks that should be broken down. Investigate and unblock or split.`,
        detail: `${agingWip.length}/${inProgress.length} in-progress items are aging (>10 days).`,
        action: agingKeys.length > 0 ? { label: "Investigate aging WIP", keys: agingKeys, serverUrl: getBrowserUrl(server) } : null,
      });

      // 27. Per-Person WIP Overload (10 pts) — individual overcommitment
      const assigneeWip = {};
      for (const i of inProgress) {
        const name = i.fields.assignee?.displayName || "Unassigned";
        if (name === "Unassigned") continue;
        assigneeWip[name] = (assigneeWip[name] || 0) + 1;
      }
      const wipLimit = 3; // default per-person WIP limit
      const overloadedPeople = Object.entries(assigneeWip).filter(([, count]) => count > wipLimit);
      const totalAssignees = Object.keys(assigneeWip).length;
      const overloadPct = totalAssignees > 0 ? Math.round((overloadedPeople.length / totalAssignees) * 100) : 0;
      const wipPersonScore = overloadPct <= 10 ? 10 : overloadPct <= 25 ? 8 : overloadPct <= 40 ? 5 : overloadPct <= 60 ? 3 : 1;
      const overloadDetail = overloadedPeople.map(([name, count]) => `${name} (${count})`).join(", ");
      checks.push({
        id: "per-person-wip", name: "Per-Person WIP Overload", score: wipPersonScore, maxScore: 10,
        status: wipPersonScore >= 8 ? "pass" : wipPersonScore >= 5 ? "warning" : "fail",
        description: `${overloadedPeople.length}/${totalAssignees} team members exceed ${wipLimit} concurrent WIP items (${overloadPct}%). Overloaded individuals context-switch excessively, reducing quality and throughput. Redistribute or defer work.`,
        detail: overloadedPeople.length > 0 ? `Overloaded: ${overloadDetail}` : `All ${totalAssignees} assignees within WIP limit of ${wipLimit}.`,
        action: null,
      });

      // 28. Hierarchy Depth (10 pts) — proper epic→story→subtask levels
      const hasEpicsLocal = notDone.some((i) => i.fields.issuetype?.name === "Epic");
      const hasStoriesLocal = notDone.some((i) => ["Story", "Task"].includes(i.fields.issuetype?.name));
      const hasSubsLocal = notDone.some((i) => {
        const tn = (i.fields.issuetype?.name || "").toLowerCase();
        return tn === "sub-task" || tn === "subtask" || i.fields.issuetype?.subtask === true;
      });
      const depthLevels = (hasEpicsLocal ? 1 : 0) + (hasStoriesLocal ? 1 : 0) + (hasSubsLocal ? 1 : 0);
      const depthScore = depthLevels >= 3 ? 10 : depthLevels === 2 ? 7 : depthLevels === 1 ? 3 : 0;
      const missingLevels = [];
      if (!hasEpicsLocal) missingLevels.push("Epics");
      if (!hasStoriesLocal) missingLevels.push("Stories/Tasks");
      if (!hasSubsLocal) missingLevels.push("Subtasks");
      checks.push({
        id: "hierarchy-depth", name: "Hierarchy Depth", score: depthScore, maxScore: 10,
        status: depthScore >= 8 ? "pass" : depthScore >= 5 ? "warning" : "fail",
        description: `Project uses ${depthLevels}/3 hierarchy levels (Epic → Story/Task → Subtask). A complete hierarchy enables planning at strategic (epic), tactical (story), and execution (subtask) levels. Missing levels reduce visibility and traceability.`,
        detail: missingLevels.length > 0 ? `Missing: ${missingLevels.join(", ")}` : "All 3 hierarchy levels present.",
        action: null,
      });

      // RACI Documentation check (10 pts)
      const projectRacis = Object.values(raciMatrices).filter((m) => m.type === "project");
      let raciScore = 0;
      let raciDetail = "No RACI matrix documented for this team.";
      if (projectRacis.length > 0) {
        raciScore += 3; // Has at least one matrix
        const latest = projectRacis.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
        const acts = latest.activities || [];
        const roles = latest.roles || [];
        const allHaveA = acts.every((act) => roles.some((r) => latest.assignments[`${act.id}:${r.id}`] === "A"));
        const allHaveR = acts.every((act) => roles.some((r) => latest.assignments[`${act.id}:${r.id}`] === "R"));
        const fillCount = Object.values(latest.assignments || {}).filter(Boolean).length;
        const totalCells = acts.length * roles.length;
        const fillPct = totalCells > 0 ? Math.round((fillCount / totalCells) * 100) : 0;
        if (allHaveA) raciScore += 3;
        if (allHaveR) raciScore += 2;
        if (fillPct >= 50) raciScore += 2;
        raciDetail = `${projectRacis.length} matrix, ${acts.length} activities, ${roles.length} roles, ${fillPct}% filled.${!allHaveA ? " Missing Accountable on some activities." : ""}${!allHaveR ? " Missing Responsible on some activities." : ""}`;
      }
      checks.push({
        id: "raci-documentation", name: "RACI Documentation", score: raciScore, maxScore: 10,
        status: raciScore >= 8 ? "pass" : raciScore >= 4 ? "warning" : "fail",
        description: "Teams should document who is Responsible, Accountable, Consulted, and Informed for key activities. A clear RACI matrix prevents ownership gaps, reduces confusion, and speeds up decision-making.",
        detail: raciDetail,
        action: raciScore < 8 ? { label: "Create RACI", keys: [], serverUrl: getBrowserUrl(server) } : null,
      });

      // Bus Factor check (10 pts) — knowledge distribution across team
      // Count unique assignees on resolved tickets for this project
      const resolvedByPerson = {};
      for (const issue of issues) {
        if (statusCat(issue) === "done" && issue.fields.assignee?.displayName) {
          const person = issue.fields.assignee.displayName;
          resolvedByPerson[person] = (resolvedByPerson[person] || 0) + 1;
        }
      }
      const resolvers = Object.keys(resolvedByPerson);
      const resolvedTotal = Object.values(resolvedByPerson).reduce((s, v) => s + v, 0);
      const topResolver = resolvers.length > 0 ? resolvers.sort((a, b) => resolvedByPerson[b] - resolvedByPerson[a])[0] : null;
      const topResolverPct = topResolver && resolvedTotal > 0 ? Math.round((resolvedByPerson[topResolver] / resolvedTotal) * 100) : 0;
      let busScore = 0;
      if (resolvers.length >= 4) busScore = 10;
      else if (resolvers.length === 3) busScore = 8;
      else if (resolvers.length === 2) busScore = 5;
      else if (resolvers.length === 1) busScore = 2;
      if (topResolverPct > 70 && busScore > 5) busScore = Math.min(busScore, 5); // penalize over-reliance
      checks.push({
        id: "bus-factor", name: "Bus Factor (Knowledge Distribution)", score: busScore, maxScore: 10,
        status: busScore >= 8 ? "pass" : busScore >= 5 ? "warning" : "fail",
        description: `${resolvers.length} people have resolved tickets in this project. A healthy team has 3+ contributors. If one person holds all the knowledge, their absence creates critical risk.`,
        detail: topResolver
          ? `${resolvers.length} contributors. Top resolver: ${topResolver} (${topResolverPct}% of resolved tickets).`
          : "No resolved tickets found to analyze.",
        action: null,
      });

      const totalScore = checks.reduce((s, c) => s + c.score, 0);
      const maxPossible = checks.reduce((s, c) => s + c.maxScore, 0);
      const overallPct = Math.round((totalScore / maxPossible) * 100);

      return {
        team: { id: team.id, name: team.name, color: team.color, projectKey: team.projectKey, serverUrl: getBrowserUrl(server) },
        score: overallPct,
        totalScore,
        maxPossible,
        checks,
        stats: { total, done: done.length, inProgress: inProgress.length, todo: todo.length, stale: stale.length },
        error: null,
      };
    }));

    res.json({ projects: results });
  } catch (err) {
    console.error("Error in compliance/projects:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── Sprint & Velocity Endpoints ─────────────────────────

// Get sprints for a board
app.get("/sprints", async (req, res) => {
  try {
    const team = TEAMS[0];
    const server = getServer(team?.serverId);
    let boardId = team?.boardId;

    // Auto-detect board if not configured
    if (!boardId) {
      const boards = await jiraFetchAgileFrom(server, `/board?projectKeyOrId=${team?.projectKey || JIRA_PROJECT_KEY}&maxResults=1`);
      boardId = boards.values?.[0]?.id;
      if (!boardId) return res.json({ sprints: [], message: "No board found" });
    }

    const data = await jiraFetchAgileFrom(server, `/board/${boardId}/sprint?state=active,closed&maxResults=20`);
    const sprints = (data.values || []).map(s => ({
      id: s.id, name: s.name, state: s.state,
      startDate: s.startDate, endDate: s.endDate, completeDate: s.completeDate,
      goal: s.goal || "",
    })).sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));

    res.json({ sprints, boardId });
  } catch (err) {
    console.error("Error fetching sprints:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// Burndown data for a sprint
app.get("/sprints/:id/burndown", async (req, res) => {
  try {
    const sprintId = req.params.id;
    const team = TEAMS[0];
    const server = getServer(team?.serverId);

    // Get sprint info
    const sprint = await jiraFetchAgileFrom(server, `/sprint/${sprintId}`);
    if (!sprint.startDate || !sprint.endDate) {
      return res.json({ sprint, daily: [], issues: [] });
    }

    // Get issues in sprint
    const userJql = req.query.jql;
    const jql = userJql ? `sprint = ${sprintId} AND (${stripOrderBy(userJql)}) ORDER BY created ASC` : `sprint = ${sprintId} ORDER BY created ASC`;
    const fieldsStr = "summary,status,assignee,priority,issuetype,created,updated,resolutiondate,duedate,timetracking," + EPIC_LINK_FIELDS.join(",") + ",parent,labels";
    const data = await jiraSearchAll(jql, fieldsStr, 100, "", req.query.serverId);

    const startDate = new Date(sprint.startDate);
    const endDate = new Date(sprint.endDate || sprint.completeDate || new Date());
    const totalDays = Math.ceil((endDate - startDate) / 86400000);

    // Build daily burndown
    const daily = [];
    const totalIssues = data.issues.length;
    let totalPoints = 0;
    const issueDetails = data.issues.map(i => {
      const sp = i.fields.timetracking?.originalEstimateSeconds
        ? Math.round(i.fields.timetracking.originalEstimateSeconds / 3600)
        : (i.fields[EPIC_LINK_FIELDS[0]] && typeof i.fields[EPIC_LINK_FIELDS[0]] === "number" ? i.fields[EPIC_LINK_FIELDS[0]] : 1);
      totalPoints += sp;
      return {
        key: i.key, summary: i.fields.summary, points: sp,
        status: i.fields.status?.name, statusCategory: i.fields.status?.statusCategory?.key,
        resolvedDate: i.fields.resolutiondate,
        assignee: i.fields.assignee?.displayName,
      };
    });

    for (let d = 0; d <= totalDays; d++) {
      const date = new Date(startDate.getTime() + d * 86400000);
      const dateStr = date.toISOString().split("T")[0];
      const resolvedByDate = issueDetails.filter(i =>
        i.resolvedDate && new Date(i.resolvedDate).toISOString().split("T")[0] <= dateStr
      );
      const resolvedPoints = resolvedByDate.reduce((s, i) => s + i.points, 0);
      const ideal = Math.round(totalPoints * (1 - d / totalDays) * 10) / 10;

      daily.push({
        date: dateStr, day: d,
        remaining: totalPoints - resolvedPoints,
        completed: resolvedPoints,
        ideal,
        scope: totalPoints,
      });
    }

    res.json({ sprint, daily, issues: issueDetails, totalPoints, totalIssues });
  } catch (err) {
    console.error("Error fetching burndown:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// Velocity across sprints
app.get("/velocity", async (req, res) => {
  try {
    const team = TEAMS[0];
    const server = getServer(team?.serverId);
    let boardId = team?.boardId;

    if (!boardId) {
      const boards = await jiraFetchAgileFrom(server, `/board?projectKeyOrId=${team?.projectKey || JIRA_PROJECT_KEY}&maxResults=1`);
      boardId = boards.values?.[0]?.id;
      if (!boardId) return res.json({ sprints: [] });
    }

    const sprintData = await jiraFetchAgileFrom(server, `/board/${boardId}/sprint?state=closed,active&maxResults=15`);
    const sprints = (sprintData.values || []).sort((a, b) => new Date(a.startDate || 0) - new Date(b.startDate || 0));
    const userJql = req.query.jql;

    const velocity = [];
    for (const sprint of sprints.slice(-10)) {
      const jql = userJql ? `sprint = ${sprint.id} AND (${stripOrderBy(userJql)}) ORDER BY created ASC` : `sprint = ${sprint.id} ORDER BY created ASC`;
      const fields = "status,issuetype,timetracking," + EPIC_LINK_FIELDS.join(",");
      const data = await jiraSearchAllFrom(server, jql, fields, 200);
      let committed = 0, completed = 0, totalIssues = 0, doneIssues = 0;
      for (const issue of data.issues) {
        const pts = 1; // count-based; enhance with story points if available
        committed += pts;
        totalIssues++;
        if (issue.fields.status?.statusCategory?.key === "done") {
          completed += pts;
          doneIssues++;
        }
      }
      velocity.push({
        sprintId: sprint.id, sprintName: sprint.name, state: sprint.state,
        startDate: sprint.startDate, endDate: sprint.endDate,
        committed, completed, totalIssues, doneIssues,
        completionRate: totalIssues > 0 ? Math.round((doneIssues / totalIssues) * 100) : 0,
      });
    }

    const avgVelocity = velocity.length > 0
      ? Math.round(velocity.reduce((s, v) => s + v.completed, 0) / velocity.length)
      : 0;

    res.json({ velocity, avgVelocity });
  } catch (err) {
    console.error("Error fetching velocity:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── Flow Metrics Endpoints ──────────────────────────────

// Cumulative Flow Diagram data
app.get("/flow/cfd", async (req, res) => {
  try {
    const jql = req.query.jql || DEFAULT_JQL;
    if (!jql) return res.status(400).json({ error: "No JQL query provided. Configure a default JQL in Settings or provide a ?jql= parameter." });
    const days = parseInt(req.query.days) || 30;

    const fieldsStr = "status,created,updated,resolutiondate";
    const data = await jiraSearchAll(jql, fieldsStr, 100, "", req.query.serverId);

    const now = new Date();
    const startDate = new Date(now.getTime() - days * 86400000);
    const dailyData = [];

    for (let d = 0; d <= days; d++) {
      const date = new Date(startDate.getTime() + d * 86400000);
      const dateStr = date.toISOString().split("T")[0];
      let todo = 0, inProgress = 0, done = 0;

      for (const issue of data.issues) {
        const created = new Date(issue.fields.created);
        if (created > date) continue; // not yet created

        const resolved = issue.fields.resolutiondate ? new Date(issue.fields.resolutiondate) : null;
        const statusCat = issue.fields.status?.statusCategory?.key;

        if (resolved && resolved <= date) {
          done++;
        } else if (statusCat === "indeterminate" || (statusCat === "done" && (!resolved || resolved > date))) {
          // Approximate: if currently in-progress or was done after this date
          inProgress++;
        } else {
          todo++;
        }
      }
      dailyData.push({ date: dateStr, todo, inProgress, done, total: todo + inProgress + done });
    }

    res.json({ daily: dailyData, totalIssues: data.issues.length });
  } catch (err) {
    console.error("Error fetching CFD:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// Cycle time scatterplot data
app.get("/flow/cycle-time", async (req, res) => {
  try {
    const jql = req.query.jql || (JIRA_PROJECT_KEY ? `project = ${JIRA_PROJECT_KEY} AND statusCategory = Done ORDER BY resolutiondate DESC` : "");
    if (!jql) return res.status(400).json({ error: "No JQL query provided. Configure a default JQL in Settings or provide a ?jql= parameter." });

    const fieldsStr = "summary,status,assignee,priority,issuetype,created,updated,resolutiondate";
    const data = await jiraSearchAll(jql, fieldsStr, 200, "", req.query.serverId);

    const items = data.issues
      .filter(i => i.fields.resolutiondate && i.fields.created)
      .map(i => {
        const created = new Date(i.fields.created);
        const resolved = new Date(i.fields.resolutiondate);
        const cycleTimeDays = Math.max(1, Math.round((resolved - created) / 86400000));
        return {
          key: i.key, summary: i.fields.summary,
          issueType: i.fields.issuetype?.name,
          priority: i.fields.priority?.name,
          assignee: i.fields.assignee?.displayName,
          created: i.fields.created,
          resolved: i.fields.resolutiondate,
          cycleTimeDays,
        };
      })
      .sort((a, b) => new Date(a.resolved) - new Date(b.resolved));

    // Compute percentiles
    const times = items.map(i => i.cycleTimeDays).sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length * 0.5)] || 0;
    const p85 = times[Math.floor(times.length * 0.85)] || 0;
    const p95 = times[Math.floor(times.length * 0.95)] || 0;
    const avg = times.length > 0 ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : 0;

    res.json({ items, percentiles: { p50, p85, p95, avg }, total: items.length });
  } catch (err) {
    console.error("Error fetching cycle time:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// Flow metrics (throughput, WIP age, flow efficiency)
app.get("/flow/metrics", async (req, res) => {
  try {
    const jql = req.query.jql || DEFAULT_JQL;
    if (!jql) return res.status(400).json({ error: "No JQL query provided. Configure a default JQL in Settings or provide a ?jql= parameter." });

    const fieldsStr = "summary,status,assignee,priority,issuetype,created,updated,resolutiondate,duedate";
    const data = await jiraSearchAll(jql, fieldsStr, 100, "", req.query.serverId);
    const now = Date.now();

    // Throughput: items completed per week over last 8 weeks
    const weeks = 8;
    const weeklyThroughput = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const weekStart = new Date(now - (w + 1) * 7 * 86400000);
      const weekEnd = new Date(now - w * 7 * 86400000);
      const completed = data.issues.filter(i => {
        const rd = i.fields.resolutiondate ? new Date(i.fields.resolutiondate) : null;
        return rd && rd >= weekStart && rd < weekEnd;
      }).length;
      weeklyThroughput.push({
        weekStart: weekStart.toISOString().split("T")[0],
        weekEnd: weekEnd.toISOString().split("T")[0],
        completed,
      });
    }

    // WIP Age: how long current in-progress items have been open
    const wipItems = data.issues
      .filter(i => i.fields.status?.statusCategory?.key === "indeterminate")
      .map(i => ({
        key: i.key, summary: i.fields.summary,
        assignee: i.fields.assignee?.displayName,
        status: i.fields.status?.name,
        ageDays: Math.floor((now - new Date(i.fields.created).getTime()) / 86400000),
        lastUpdatedDays: Math.floor((now - new Date(i.fields.updated).getTime()) / 86400000),
      }))
      .sort((a, b) => b.ageDays - a.ageDays);

    const avgWipAge = wipItems.length > 0
      ? Math.round(wipItems.reduce((s, i) => s + i.ageDays, 0) / wipItems.length)
      : 0;

    // Status distribution
    const statusDist = { todo: 0, inProgress: 0, done: 0 };
    for (const i of data.issues) {
      const cat = i.fields.status?.statusCategory?.key;
      if (cat === "done") statusDist.done++;
      else if (cat === "indeterminate") statusDist.inProgress++;
      else statusDist.todo++;
    }

    const result = {
      throughput: weeklyThroughput,
      avgThroughput: weeklyThroughput.length > 0 ? Math.round(weeklyThroughput.reduce((s, w) => s + w.completed, 0) / weeklyThroughput.length) : 0,
      wipItems,
      wipCount: wipItems.length,
      avgWipAge,
      statusDistribution: statusDist,
      totalIssues: data.issues.length,
    };
    res.json(result);
  } catch (err) {
    console.error("Error fetching flow metrics:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── Daily Standup Dashboard ─────────────────────────────

app.get("/standup", async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const jql = req.query.jql || DEFAULT_JQL;
    if (!jql) return res.status(400).json({ error: "No JQL query provided. Configure a default JQL in Settings or provide a ?jql= parameter." });
    const fieldsStr = "summary,status,assignee,priority,issuetype,created,updated,resolutiondate,duedate,comment,labels," + EPIC_LINK_FIELDS.join(",") + ",parent";
    const data = await jiraSearchAll(jql, fieldsStr, 100, "changelog", req.query.serverId);

    const cutoff = new Date(Date.now() - hours * 3600000);
    const now = Date.now();

    const recentlyUpdated = [];
    const newlyCreated = [];
    const recentlyResolved = [];
    const blocked = [];
    const approachingDue = [];
    const stale = [];
    const recentComments = []; // track new comments

    for (const issue of data.issues) {
      const f = issue.fields;
      const updated = new Date(f.updated);
      const created = new Date(f.created);
      const resolved = f.resolutiondate ? new Date(f.resolutiondate) : null;
      const statusCat = f.status?.statusCategory?.key;

      // Extract recent comments
      const comments = f.comment?.comments || [];
      const issueRecentComments = comments
        .filter(c => new Date(c.created) >= cutoff)
        .map(c => ({
          author: c.author?.displayName || "Unknown",
          body: (c.body || "").substring(0, 300),
          created: c.created,
        }));

      // Extract recent changes from changelog
      const recentChanges = [];
      const histories = issue.changelog?.histories || [];
      for (const history of histories) {
        if (new Date(history.created) < cutoff) continue;
        for (const item of history.items || []) {
          const field = item.field?.toLowerCase();
          // Map field names to readable change types
          let changeType = null;
          let detail = null;
          if (field === "status") {
            changeType = "status";
            detail = `${item.fromString || "?"} \u2192 ${item.toString || "?"}`;
          } else if (field === "assignee") {
            changeType = "assignee";
            detail = item.toString ? `\u2192 ${item.toString}` : "Unassigned";
          } else if (field === "priority") {
            changeType = "priority";
            detail = `${item.fromString || "?"} \u2192 ${item.toString || "?"}`;
          } else if (field === "duedate") {
            changeType = "duedate";
            detail = item.toString ? `Set to ${item.toString}` : "Removed";
          } else if (field === "labels") {
            changeType = "labels";
            detail = item.toString || "Changed";
          } else if (field === "summary") {
            changeType = "summary";
            detail = "Title updated";
          } else if (field === "description") {
            changeType = "description";
            detail = "Description updated";
          } else if (field === "resolution") {
            changeType = "resolution";
            detail = item.toString || "Resolved";
          } else if (field === "sprint") {
            changeType = "sprint";
            detail = item.toString || "Changed";
          } else if (field === "story points" || field === "story_points") {
            changeType = "points";
            detail = `${item.fromString || "?"} \u2192 ${item.toString || "?"}`;
          } else if (field === "link" || field === "issuelinks") {
            changeType = "link";
            detail = item.toString || "Link changed";
          }
          if (changeType) {
            recentChanges.push({
              type: changeType,
              detail,
              author: history.author?.displayName || "Unknown",
              created: history.created,
            });
          }
        }
      }

      const item = {
        key: issue.key, summary: f.summary,
        status: f.status?.name, statusCategory: statusCat,
        assignee: f.assignee?.displayName,
        priority: f.priority?.name,
        issueType: f.issuetype?.name,
        updated: f.updated, created: f.created,
        dueDate: f.duedate,
        labels: f.labels || [],
        recentComments: issueRecentComments,
        recentChanges,
        epicName: f.parent?.fields?.summary || null,
      };

      // Recently updated (status changed, comments, etc.)
      if (updated >= cutoff) {
        recentlyUpdated.push(item);
      }

      // Newly created
      if (created >= cutoff) {
        newlyCreated.push(item);
      }

      // Recently resolved
      if (resolved && resolved >= cutoff) {
        recentlyResolved.push({ ...item, resolvedDate: f.resolutiondate });
      }

      // Blocked
      if ((f.labels || []).some(l => l.toLowerCase().includes("block")) && statusCat !== "done") {
        blocked.push(item);
      }

      // Approaching due (within 3 days)
      if (f.duedate && statusCat !== "done") {
        const daysLeft = Math.floor((new Date(f.duedate).getTime() - now) / 86400000);
        if (daysLeft >= 0 && daysLeft <= 3) {
          approachingDue.push({ ...item, daysLeft });
        }
      }

      // Stale (no update in 7+ days, not done)
      if (statusCat !== "done" && statusCat !== "new") {
        const staleDays = Math.floor((now - updated.getTime()) / 86400000);
        if (staleDays >= 7) {
          stale.push({ ...item, staleDays });
        }
      }

      // Collect recent comments for the feed
      for (const c of issueRecentComments) {
        recentComments.push({
          issueKey: issue.key,
          issueSummary: f.summary,
          assignee: f.assignee?.displayName,
          status: f.status?.name,
          ...c,
        });
      }
    }

    // Sort recent comments by date (newest first)
    recentComments.sort((a, b) => new Date(b.created) - new Date(a.created));

    // Team workload
    const workload = {};
    for (const issue of data.issues) {
      if (issue.fields.status?.statusCategory?.key === "done") continue;
      const assignee = issue.fields.assignee?.displayName || "Unassigned";
      if (!workload[assignee]) workload[assignee] = { inProgress: 0, todo: 0, total: 0 };
      workload[assignee].total++;
      if (issue.fields.status?.statusCategory?.key === "indeterminate") workload[assignee].inProgress++;
      else workload[assignee].todo++;
    }

    res.json({
      since: cutoff.toISOString(),
      recentlyUpdated: recentlyUpdated.sort((a, b) => new Date(b.updated) - new Date(a.updated)).slice(0, 40),
      newlyCreated,
      recentlyResolved,
      blocked,
      approachingDue,
      stale: stale.sort((a, b) => b.staleDays - a.staleDays).slice(0, 15),
      recentComments: recentComments.slice(0, 30),
      workload,
      summary: {
        updatedCount: recentlyUpdated.length,
        createdCount: newlyCreated.length,
        resolvedCount: recentlyResolved.length,
        blockedCount: blocked.length,
        staleCount: stale.length,
        approachingDueCount: approachingDue.length,
        recentCommentCount: recentComments.length,
      },
    });
  } catch (err) {
    console.error("Error fetching standup data:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── Sprint Review / Demo Readiness ──────────────────────

app.get("/sprint-review", async (req, res) => {
  try {
    const userJql = req.query.jql || DEFAULT_JQL;
    if (!userJql) return res.status(400).json({ error: "No JQL query provided. Configure a default JQL in Settings or provide a ?jql= parameter." });
    const team = TEAMS[0];
    const server = getServer(team?.serverId || req.query.serverId);
    let activeSprint = null;

    // Try to get active sprint info (optional — works without it)
    try {
      let boardId = team?.boardId;
      if (!boardId) {
        const boards = await jiraFetchAgileFrom(server, `/board?projectKeyOrId=${team?.projectKey || JIRA_PROJECT_KEY}&maxResults=1`);
        boardId = boards.values?.[0]?.id;
      }
      if (boardId) {
        const sprintData = await jiraFetchAgileFrom(server, `/board/${boardId}/sprint?state=active&maxResults=1`);
        activeSprint = sprintData.values?.[0] || null;
      }
    } catch {
      // Board/sprint API not available — continue with JQL-only mode
    }

    // Build JQL: if we found an active sprint, scope to it; otherwise use the user's JQL as-is
    const jql = activeSprint
      ? `sprint = ${activeSprint.id} AND (${stripOrderBy(userJql)}) ORDER BY status DESC, priority ASC`
      : userJql;

    const fieldsStr = "summary,status,assignee,priority,issuetype,created,updated,resolutiondate,duedate,description,labels," + EPIC_LINK_FIELDS.join(",") + ",parent";
    const data = await jiraSearchAllFrom(server, jql, fieldsStr, 200);

    const epicGroups = {};
    const issues = data.issues.map(i => {
      const f = i.fields;
      const epicKey = getEpicKey(f) || "__no_epic__";
      const epicName = f.parent?.fields?.summary || getEpicName(f) || "No Epic";
      if (!epicGroups[epicKey]) epicGroups[epicKey] = { key: epicKey, name: epicName, issues: [], done: 0, total: 0 };
      const item = {
        key: i.key, summary: f.summary,
        status: f.status?.name, statusCategory: f.status?.statusCategory?.key,
        assignee: f.assignee?.displayName,
        priority: f.priority?.name,
        issueType: f.issuetype?.name,
        hasDescription: !!(f.description && f.description.length > 30),
        labels: f.labels || [],
      };
      epicGroups[epicKey].issues.push(item);
      epicGroups[epicKey].total++;
      if (item.statusCategory === "done") epicGroups[epicKey].done++;
      return item;
    });

    const done = issues.filter(i => i.statusCategory === "done").length;
    const inProgress = issues.filter(i => i.statusCategory === "indeterminate").length;
    const todo = issues.filter(i => i.statusCategory === "new").length;

    const result = {
      sprint: activeSprint
        ? { id: activeSprint.id, name: activeSprint.name, goal: activeSprint.goal || "", startDate: activeSprint.startDate, endDate: activeSprint.endDate }
        : { id: null, name: "Sprint Review (JQL)", goal: "", startDate: null, endDate: null },
      stats: { total: issues.length, done, inProgress, todo, completionRate: issues.length > 0 ? Math.round((done / issues.length) * 100) : 0 },
      epicGroups: Object.values(epicGroups).sort((a, b) => b.total - a.total),
      issues,
      serverUrl: getBrowserUrl(server),
    };
    res.json(result);
  } catch (err) {
    console.error("Error fetching sprint review:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── Definition of Ready Gate ────────────────────────────

app.get("/dor", async (req, res) => {
  try {
    const jql = req.query.jql || (JIRA_PROJECT_KEY ? `project = ${JIRA_PROJECT_KEY} AND statusCategory != Done ORDER BY priority ASC, created DESC` : "");
    if (!jql) return res.status(400).json({ error: "No JQL query provided. Configure a default JQL in Settings or provide a ?jql= parameter." });
    const fieldsStr = "summary,status,assignee,priority,issuetype,created,updated,duedate,description,labels,timetracking," + EPIC_LINK_FIELDS.join(",") + ",parent";
    const data = await jiraSearchAll(jql, fieldsStr, 100, "", req.query.serverId);

    const items = data.issues.map(i => {
      const f = i.fields;
      const checks = [];
      const desc = f.description || "";

      // Check 1: Has description
      const hasDesc = desc.length >= 30;
      checks.push({ id: "description", label: "Description", pass: hasDesc, detail: hasDesc ? "Has description" : "Missing or too short" });

      // Check 2: Has acceptance criteria
      const hasAC = /acceptance criteria|AC:|given.*when.*then|^\s*[-*]\s*\[/im.test(desc);
      checks.push({ id: "acceptance_criteria", label: "Acceptance Criteria", pass: hasAC, detail: hasAC ? "Found" : "Not detected in description" });

      // Check 3: Has estimate
      const hasEstimate = !!(f.timetracking?.originalEstimate);
      checks.push({ id: "estimate", label: "Estimate", pass: hasEstimate, detail: hasEstimate ? f.timetracking.originalEstimate : "No estimate" });

      // Check 4: Has assignee
      const hasAssignee = !!f.assignee;
      checks.push({ id: "assignee", label: "Assignee", pass: hasAssignee, detail: hasAssignee ? f.assignee.displayName : "Unassigned" });

      // Check 5: Has due date
      const hasDueDate = !!f.duedate;
      checks.push({ id: "due_date", label: "Due Date", pass: hasDueDate, detail: hasDueDate ? f.duedate : "No due date" });

      // Check 6: Has priority set (not default)
      const hasPriority = f.priority && f.priority.name !== "Medium";
      checks.push({ id: "priority", label: "Priority Triaged", pass: hasPriority, detail: f.priority?.name || "None" });

      // Check 7: Has labels/epic
      const hasContext = (f.labels && f.labels.length > 0) || !!getEpicKey(f);
      checks.push({ id: "context", label: "Epic/Labels", pass: hasContext, detail: hasContext ? "Has context" : "No epic or labels" });

      const passCount = checks.filter(c => c.pass).length;
      const readyScore = Math.round((passCount / checks.length) * 100);

      return {
        key: i.key, summary: f.summary,
        status: f.status?.name, statusCategory: f.status?.statusCategory?.key,
        assignee: f.assignee?.displayName,
        priority: f.priority?.name,
        issueType: f.issuetype?.name,
        checks, passCount, totalChecks: checks.length, readyScore,
        isReady: readyScore >= 70,
      };
    });

    const readyCount = items.filter(i => i.isReady).length;
    const avgScore = items.length > 0 ? Math.round(items.reduce((s, i) => s + i.readyScore, 0) / items.length) : 0;

    // Score distribution
    const distribution = {
      ready: items.filter(i => i.readyScore >= 70).length,
      almostReady: items.filter(i => i.readyScore >= 40 && i.readyScore < 70).length,
      notReady: items.filter(i => i.readyScore < 40).length,
    };

    // Most common missing criteria
    const missingCounts = {};
    for (const item of items) {
      for (const check of item.checks) {
        if (!check.pass) {
          missingCounts[check.label] = (missingCounts[check.label] || 0) + 1;
        }
      }
    }
    const topMissing = Object.entries(missingCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count, pct: Math.round((count / items.length) * 100) }));

    res.json({ items, readyCount, totalCount: items.length, avgScore, distribution, topMissing });
  } catch (err) {
    console.error("Error fetching DoR:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── ROAM Risk Board (in-memory) ──────────

let roamRisks = {};

app.get("/roam/risks", (req, res) => {
  res.json(Object.values(roamRisks).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
});

app.post("/roam/risks", (req, res) => {
  const { id, title, description, category, owner, linkedIssues, severity } = req.body;
  if (!title || !category) return res.status(400).json({ error: "Missing title or category" });

  const riskId = id || `risk-${Date.now()}`;
  const existing = roamRisks[riskId];
  roamRisks[riskId] = { id: riskId, title, description: description || "", category, owner: owner || "", linkedIssues: linkedIssues || [], severity: severity || "medium", createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  res.json(roamRisks[riskId]);
});

app.delete("/roam/risks/:id", (req, res) => {
  delete roamRisks[req.params.id];
  res.json({ ok: true });
});

// ─── Team Health Check (in-memory) ────────

const HC_CATEGORIES = [
  { id: "mission", label: "Mission & Purpose", emoji: "\uD83C\uDFAF" },
  { id: "speed", label: "Delivery Speed", emoji: "\uD83D\uDE80" },
  { id: "quality", label: "Code Quality", emoji: "\u2728" },
  { id: "fun", label: "Fun & Teamwork", emoji: "\uD83C\uDF89" },
  { id: "learning", label: "Learning & Growth", emoji: "\uD83D\uDCDA" },
  { id: "support", label: "Support & Tools", emoji: "\uD83D\uDEE0\uFE0F" },
  { id: "communication", label: "Communication", emoji: "\uD83D\uDCAC" },
  { id: "autonomy", label: "Autonomy", emoji: "\uD83D\uDDFD" },
];

let healthCheckSessions = {};

function aggregateHealthCheck(session) {
  const categories = session.categories || HC_CATEGORIES;
  const responses = session.responses || [];
  const aggregated = {};
  for (const cat of categories) {
    const catResponses = responses.filter(r => r.categoryId === cat.id);
    const scores = catResponses.map(r => r.score);
    aggregated[cat.id] = {
      ...cat,
      avg: scores.length > 0 ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10 : 0,
      count: scores.length,
      distribution: { green: scores.filter(s => s >= 4).length, yellow: scores.filter(s => s === 3).length, red: scores.filter(s => s <= 2).length },
    };
  }
  return aggregated;
}

app.get("/health-check/sessions", (req, res) => {
  res.json(Object.values(healthCheckSessions).map(({ id, title, createdAt, responses }) => ({ id, title, createdAt, responseCount: responses.length })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.post("/health-check/sessions", (req, res) => {
  const title = req.body.title || `Health Check ${new Date().toISOString().split("T")[0]}`;
  const data = { categories: HC_CATEGORIES, responses: [] };
  const id = `hc-${Date.now()}`;
  const session = { id, title, createdAt: new Date().toISOString(), ...data };
  healthCheckSessions[id] = session;
  res.json(session);
});

app.get("/health-check/sessions/:id", (req, res) => {
  const session = healthCheckSessions[req.params.id];
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json({ ...session, aggregated: aggregateHealthCheck(session) });
});

app.post("/health-check/sessions/:id/vote", (req, res) => {
  const { voter, categoryId, score, comment } = req.body;
  if (!categoryId || score == null) return res.status(400).json({ error: "Missing categoryId or score" });

  const vote = {
    id: `vote-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    voter: voter || "Anonymous", categoryId,
    score: Math.min(5, Math.max(1, parseInt(score))),
    comment: comment || "", createdAt: new Date().toISOString(),
  };

  const session = healthCheckSessions[req.params.id];
  if (!session) return res.status(404).json({ error: "Session not found" });
  session.responses.push(vote);
  res.json({ ok: true });
});

app.delete("/health-check/sessions/:id", (req, res) => {
  delete healthCheckSessions[req.params.id];
  res.json({ ok: true });
});

// ─── Sprint Goals Tracker (in-memory) ─────

let sprintGoals = {};

app.get("/sprint-goals", (req, res) => {
  res.json(Object.values(sprintGoals).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.post("/sprint-goals", (req, res) => {
  const { id, sprintName, goals } = req.body;
  if (!sprintName || !goals || !Array.isArray(goals)) {
    return res.status(400).json({ error: "Missing sprintName or goals array" });
  }

  const data = {
    sprintName,
    goals: goals.map((g, i) => ({
      id: g.id || `g-${Date.now()}-${i}`,
      text: g.text,
      status: g.status || "not_started",
      linkedIssues: g.linkedIssues || [],
      notes: g.notes || "",
    })),
    updatedAt: new Date().toISOString(),
  };

  const goalId = id || `sg-${Date.now()}`;
  const existing = sprintGoals[goalId];
  sprintGoals[goalId] = { id: goalId, ...data, createdAt: existing?.createdAt || new Date().toISOString() };
  res.json(sprintGoals[goalId]);
});

app.delete("/sprint-goals/:id", (req, res) => {
  delete sprintGoals[req.params.id];
  res.json({ ok: true });
});

// ─── Expertise / SME Detection ──────────────────────────

app.get("/expertise", async (req, res) => {
  try {
    const server = resolveServerFromReq(req);
    if (!server) return res.status(400).json({ error: "No Jira server configured" });

    const jql = req.query.jql || `project = ${TEAMS[0]?.projectKey || "TEAM"} ORDER BY updated DESC`;
    const maxResults = Math.min(parseInt(req.query.max) || 500, 1000);

    const fieldsStr = ["assignee", "reporter", "status", "issuetype", "summary",
      "labels", "components", "comment", "updated", "created", ...EPIC_LINK_FIELDS, "parent"].join(",");
    const { issues } = await jiraSearchAllFrom(server, jql, fieldsStr, Math.min(maxResults, 100));

    // ── Domain detection: extract domains from labels, components, epic names, keywords
    function detectDomains(issue) {
      const domains = new Set();
      const f = issue.fields;
      // Labels
      for (const l of (f.labels || [])) domains.add(l.toLowerCase());
      // Components
      for (const c of (f.components || [])) domains.add((c.name || "").toLowerCase());
      // Epic name
      const epicKey = getEpicKey(f);
      if (epicKey) domains.add("epic:" + epicKey);
      // Keywords from summary
      const summary = (f.summary || "").toLowerCase();
      const keywords = ["auth", "api", "frontend", "backend", "database", "ci/cd", "pipeline",
        "payment", "security", "infra", "deploy", "test", "mobile", "performance", "migration",
        "monitoring", "logging", "notification", "email", "search", "cache", "config"];
      for (const kw of keywords) {
        if (summary.includes(kw)) domains.add(kw);
      }
      // Issue type as a weak domain signal
      const typeName = (f.issuetype?.name || "").toLowerCase();
      if (typeName === "bug") domains.add("bug-fixing");
      if (typeName === "epic") domains.add("epic-ownership");
      return [...domains];
    }

    // ── Score each person × domain
    const expertiseMap = {}; // "person:domain" -> { resolved, active, comments, lastActive }
    const personStats = {};  // person -> { totalResolved, totalActive, domains: Set }
    const domainStats = {};  // domain -> { people: Set, totalTickets }
    const now = Date.now();

    function addScore(person, domain, type, date) {
      if (!person || !domain) return;
      const key = person + ":" + domain;
      if (!expertiseMap[key]) expertiseMap[key] = { person, domain, resolved: 0, active: 0, comments: 0, lastActive: null };
      const entry = expertiseMap[key];
      if (type === "resolved") entry.resolved++;
      if (type === "active") entry.active++;
      if (type === "comment") entry.comments++;
      if (date && (!entry.lastActive || new Date(date) > new Date(entry.lastActive))) {
        entry.lastActive = date;
      }

      if (!personStats[person]) personStats[person] = { totalResolved: 0, totalActive: 0, domains: new Set() };
      personStats[person].domains.add(domain);
      if (type === "resolved") personStats[person].totalResolved++;
      if (type === "active") personStats[person].totalActive++;

      if (!domainStats[domain]) domainStats[domain] = { people: new Set(), totalTickets: 0 };
      domainStats[domain].people.add(person);
      domainStats[domain].totalTickets++;
    }

    for (const issue of issues) {
      const f = issue.fields;
      const assignee = f.assignee?.displayName;
      const reporter = f.reporter?.displayName;
      const statusCat = f.status?.statusCategory?.key;
      const domains = detectDomains(issue);
      const updateDate = f.updated;

      for (const domain of domains) {
        if (assignee) {
          if (statusCat === "done") {
            addScore(assignee, domain, "resolved", updateDate);
          } else {
            addScore(assignee, domain, "active", updateDate);
          }
        }

        // Comments = knowledge contribution
        const comments = f.comment?.comments || [];
        const commenters = new Set();
        for (const c of comments.slice(-10)) {
          const name = c.author?.displayName;
          if (name && name !== assignee && !commenters.has(name)) {
            commenters.add(name);
            addScore(name, domain, "comment", c.created);
          }
        }
      }
    }

    // ── Compute final scores with recency decay
    const expertiseList = Object.values(expertiseMap).map((e) => {
      const daysSinceActive = e.lastActive ? Math.floor((now - new Date(e.lastActive).getTime()) / 86400000) : 365;
      const recencyBonus = Math.max(0, 1 - daysSinceActive / 365); // 0 to 1, decays over a year
      const rawScore = (e.resolved * 3) + (e.active * 1) + (e.comments * 0.5);
      const score = Math.round((rawScore * (0.5 + 0.5 * recencyBonus)) * 10) / 10;
      return { ...e, score, daysSinceActive };
    }).filter((e) => e.score > 0);

    // ── Build domain → ranked experts
    const domainExperts = {};
    for (const e of expertiseList) {
      if (!domainExperts[e.domain]) domainExperts[e.domain] = [];
      domainExperts[e.domain].push(e);
    }
    for (const domain of Object.keys(domainExperts)) {
      domainExperts[domain].sort((a, b) => b.score - a.score);
    }

    // ── Bus factor: domains with only 1 expert
    const busFactor = Object.entries(domainStats)
      .filter(([, d]) => d.people.size <= 1 && d.totalTickets >= 3)
      .map(([domain, d]) => ({
        domain,
        expertCount: d.people.size,
        totalTickets: d.totalTickets,
        soloExpert: d.people.size === 1 ? [...d.people][0] : null,
        risk: d.people.size === 0 ? "critical" : "high",
      }))
      .sort((a, b) => b.totalTickets - a.totalTickets);

    // ── People summary
    const people = Object.entries(personStats)
      .map(([name, stats]) => ({
        name,
        totalResolved: stats.totalResolved,
        totalActive: stats.totalActive,
        domainCount: stats.domains.size,
        topDomains: [...stats.domains]
          .map((d) => ({ domain: d, score: expertiseMap[name + ":" + d]?.score || 0 }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5),
      }))
      .sort((a, b) => b.totalResolved - a.totalResolved);

    // ── Top domains (by ticket count, excluding weak signals)
    const topDomains = Object.entries(domainStats)
      .filter(([d]) => !d.startsWith("epic:")) // exclude epic keys as domain names
      .map(([domain, d]) => ({
        domain,
        expertCount: d.people.size,
        totalTickets: d.totalTickets,
        topExperts: (domainExperts[domain] || []).slice(0, 3).map((e) => ({
          name: e.person, score: e.score, resolved: e.resolved, daysSinceActive: e.daysSinceActive,
        })),
      }))
      .sort((a, b) => b.totalTickets - a.totalTickets)
      .slice(0, 30);

    res.json({
      totalIssuesAnalyzed: issues.length,
      people,
      topDomains,
      busFactor,
      domainExperts,
      stats: {
        totalPeople: people.length,
        totalDomains: topDomains.length,
        busFactorRisks: busFactor.length,
      },
    });
  } catch (err) {
    console.error("Error analyzing expertise:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── Sprint Prioritization ──────────────────────────────

app.get("/prioritize", async (req, res) => {
  try {
    const server = resolveServerFromReq(req);
    if (!server) return res.status(400).json({ error: "No Jira server configured" });

    const jql = req.query.jql || `project = ${TEAMS[0]?.projectKey || "TEAM"} AND statusCategory != Done ORDER BY priority ASC, updated DESC`;
    const prioFieldsStr = ["summary", "status", "assignee", "priority", "issuetype",
      "duedate", "created", "updated", "issuelinks",
      "labels", "components", ...EPIC_LINK_FIELDS, "parent", "timetracking"].join(",");
    const { issues } = await jiraSearchAllFrom(server, jql, prioFieldsStr, 100);

    const now = Date.now();
    const maxSP = STORY_POINT_SETTINGS.maxStoryPoints;

    // Build blocking graph
    const blockedBy = {};
    const blocks = {};
    for (const issue of issues) {
      for (const link of (issue.fields.issuelinks || [])) {
        if (link.outwardIssue && (link.type?.outward || "").toLowerCase().includes("block")) {
          const from = issue.key, to = link.outwardIssue.key;
          if (!blocks[from]) blocks[from] = new Set();
          blocks[from].add(to);
          if (!blockedBy[to]) blockedBy[to] = new Set();
          blockedBy[to].add(from);
        }
        if (link.inwardIssue && (link.type?.inward || "").toLowerCase().includes("block")) {
          const from = link.inwardIssue.key, to = issue.key;
          if (!blocks[from]) blocks[from] = new Set();
          blocks[from].add(to);
          if (!blockedBy[to]) blockedBy[to] = new Set();
          blockedBy[to].add(from);
        }
      }
    }

    function countDownstream(key, visited = new Set()) {
      if (visited.has(key)) return 0;
      visited.add(key);
      let count = 0;
      for (const child of (blocks[key] || [])) {
        count += 1 + countDownstream(child, visited);
      }
      return count;
    }

    // Build ticket lookup for cross-referencing
    const ticketMap = {};
    for (const issue of issues) {
      const f = issue.fields;
      ticketMap[issue.key] = {
        key: issue.key, summary: f.summary, status: f.status?.name,
        statusCategory: f.status?.statusCategory?.key,
        priority: f.priority?.name || "Medium",
        assignee: f.assignee?.displayName,
        dueDate: f.duedate,
        storyPoints: typeof (f.customfield_10016 ?? null) === "number" ? f.customfield_10016 : null,
        updated: f.updated,
      };
    }

    const priorityRank = { Blocker: 0, Highest: 1, High: 2, Medium: 3, Low: 4, Lowest: 5 };

    // ── Incoherence detection ──
    const incoherences = [];

    for (const [blockerKey, blockedSet] of Object.entries(blocks)) {
      const blocker = ticketMap[blockerKey];
      if (!blocker) continue;

      for (const blockedKey of blockedSet) {
        const blocked = ticketMap[blockedKey];
        if (!blocked) continue;

        // 1. Due date conflict: blocker due AFTER blocked
        if (blocker.dueDate && blocked.dueDate && new Date(blocker.dueDate) > new Date(blocked.dueDate)) {
          incoherences.push({
            type: "due_date_conflict", severity: "critical",
            title: "Blocker due after blocked ticket",
            description: `${blockerKey} (due ${blocker.dueDate}) blocks ${blockedKey} (due ${blocked.dueDate}) — impossible to meet deadline`,
            blocker: blockerKey, blocked: blockedKey,
            fix: `Move ${blockerKey} due date before ${blocked.dueDate} or extend ${blockedKey} deadline`,
          });
        }

        // 2. Priority conflict: low priority blocks high priority
        if ((priorityRank[blocker.priority] ?? 3) > (priorityRank[blocked.priority] ?? 3) + 1) {
          incoherences.push({
            type: "priority_conflict", severity: "high",
            title: "Low priority blocks high priority",
            description: `${blockerKey} (${blocker.priority}) blocks ${blockedKey} (${blocked.priority}) — escalate the blocker`,
            blocker: blockerKey, blocked: blockedKey,
            fix: `Raise ${blockerKey} priority to at least ${blocked.priority}`,
          });
        }

        // 3. Status conflict: blocked ticket in progress while blocker is To Do
        if (blocked.statusCategory === "indeterminate" && blocker.statusCategory === "new") {
          incoherences.push({
            type: "status_conflict", severity: "high",
            title: "Working on blocked ticket before blocker starts",
            description: `${blockedKey} is In Progress but ${blockerKey} is still To Do — work may be wasted`,
            blocker: blockerKey, blocked: blockedKey,
            fix: `Start ${blockerKey} first, or verify ${blockedKey} can proceed independently`,
          });
        }

        // 4. Same assignee blocking themselves
        if (blocker.assignee && blocker.assignee === blocked.assignee && blocker.statusCategory !== "done") {
          incoherences.push({
            type: "self_blocking", severity: "medium",
            title: "Same person assigned to blocker and blocked",
            description: `${blocker.assignee} owns both ${blockerKey} and ${blockedKey} — they're blocking themselves`,
            blocker: blockerKey, blocked: blockedKey,
            fix: `${blocker.assignee} should finish ${blockerKey} first, or reassign one ticket`,
          });
        }
      }

      // 5. Stale blocker: blocks others but no update in 7+ days
      if (blocker.updated && blocker.statusCategory !== "done") {
        const daysSinceUpdate = Math.floor((now - new Date(blocker.updated).getTime()) / 86400000);
        if (daysSinceUpdate >= 7 && blockedSet.size > 0) {
          incoherences.push({
            type: "stale_blocker", severity: "high",
            title: "Stale blocker — no update in 7+ days",
            description: `${blockerKey} blocks ${blockedSet.size} ticket(s) but hasn't been updated in ${daysSinceUpdate} days`,
            blocker: blockerKey, blocked: [...blockedSet].join(", "),
            fix: `Check status of ${blockerKey} with ${blocker.assignee || "unassigned owner"} — it's holding up work`,
          });
        }
      }

      // 6. Unassigned blocker blocking assigned work
      if (!blocker.assignee && blocker.statusCategory !== "done") {
        const assignedBlocked = [...blockedSet].filter((k) => ticketMap[k]?.assignee);
        if (assignedBlocked.length > 0) {
          incoherences.push({
            type: "unassigned_blocker", severity: "high",
            title: "Unassigned blocker holding up assigned work",
            description: `${blockerKey} is unassigned but blocks ${assignedBlocked.join(", ")} (assigned) — nobody's working on the bottleneck`,
            blocker: blockerKey, blocked: assignedBlocked.join(", "),
            fix: `Assign ${blockerKey} immediately`,
          });
        }
      }
    }

    // 7. Orphan high-priority: Highest/Blocker with no assignee and no due date
    for (const issue of issues) {
      const f = issue.fields;
      const p = f.priority?.name;
      if ((p === "Highest" || p === "Blocker") && !f.assignee && !f.duedate && f.status?.statusCategory?.key !== "done") {
        incoherences.push({
          type: "orphan_urgent", severity: "critical",
          title: "Urgent ticket with no owner or deadline",
          description: `${issue.key} is ${p} priority but has no assignee and no due date — it will be forgotten`,
          blocker: issue.key, blocked: null,
          fix: `Assign and set a due date on ${issue.key}`,
        });
      }
    }

    // 8. Circular dependencies
    function detectCycle(startKey) {
      const visited = new Set();
      const stack = [startKey];
      while (stack.length > 0) {
        const key = stack.pop();
        if (visited.has(key)) {
          if (key === startKey && visited.size > 1) return true;
          continue;
        }
        visited.add(key);
        for (const child of (blocks[key] || [])) stack.push(child);
      }
      return false;
    }
    const cycleChecked = new Set();
    for (const key of Object.keys(blocks)) {
      if (!cycleChecked.has(key) && detectCycle(key)) {
        incoherences.push({
          type: "circular_dependency", severity: "critical",
          title: "Circular dependency detected",
          description: `${key} is part of a circular blocking chain — deadlock`,
          blocker: key, blocked: [...(blocks[key] || [])].join(", "),
          fix: `Review and break the dependency cycle involving ${key}`,
        });
      }
      cycleChecked.add(key);
    }

    // Sort incoherences by severity
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    incoherences.sort((a, b) => (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3));

    // ── Score each ticket (with incoherence bonuses) ──
    const incoherencesByTicket = {};
    for (const inc of incoherences) {
      if (inc.blocker) {
        if (!incoherencesByTicket[inc.blocker]) incoherencesByTicket[inc.blocker] = [];
        incoherencesByTicket[inc.blocker].push(inc);
      }
    }

    const scored = issues.map((issue) => {
      const t = ticketMap[issue.key];
      const statusCat = t.statusCategory;
      const isBlocked = (blockedBy[issue.key]?.size || 0) > 0;
      const blocksCount = blocks[issue.key]?.size || 0;
      const downstreamCount = countDownstream(issue.key);
      const daysSinceCreated = Math.floor((now - new Date(issue.fields.created).getTime()) / 86400000);
      const isOversized = t.storyPoints !== null && t.storyPoints > maxSP;
      const isNotFibonacci = t.storyPoints !== null && !FIBONACCI.includes(t.storyPoints);
      const ticketIncoherences = incoherencesByTicket[issue.key] || [];
      const daysSinceUpdate = t.updated ? Math.floor((now - new Date(t.updated).getTime()) / 86400000) : 0;

      let score = 0;
      const priorityWeights = { Blocker: 40, Highest: 35, High: 25, Medium: 15, Low: 8, Lowest: 3 };
      score += priorityWeights[t.priority] || 15;

      if (t.dueDate) {
        const daysUntilDue = Math.floor((new Date(t.dueDate).getTime() - now) / 86400000);
        if (daysUntilDue < 0) score += 30;
        else if (daysUntilDue <= 2) score += 25;
        else if (daysUntilDue <= 7) score += 15;
        else if (daysUntilDue <= 14) score += 8;
      }

      if (downstreamCount > 0) score += Math.min(30, downstreamCount * 10);
      if (isBlocked) score -= 20;
      if (daysSinceCreated > 30) score += 5;
      if (daysSinceCreated > 60) score += 5;
      if (t.storyPoints && t.storyPoints <= 3 && downstreamCount > 0) score += 10;
      if (statusCat === "indeterminate") score += 5;

      // Incoherence bonuses
      if (ticketIncoherences.some((i) => i.severity === "critical")) score += 15;
      else if (ticketIncoherences.some((i) => i.severity === "high")) score += 10;
      if (blocksCount > 0 && daysSinceUpdate >= 7) score += 10; // stale blocker
      if (!t.assignee && (t.priority === "Highest" || t.priority === "Blocker")) score += 10; // orphan urgent
      if (blocksCount > 0 && !t.assignee) score += 5; // unassigned blocker

      return {
        key: issue.key, summary: t.summary, status: t.status, statusCategory: statusCat,
        priority: t.priority, assignee: t.assignee, storyPoints: t.storyPoints, dueDate: t.dueDate,
        isBlocked, blockedByKeys: [...(blockedBy[issue.key] || [])],
        blocksCount, downstreamCount, isOversized, isNotFibonacci, maxStoryPoints: maxSP,
        score, daysSinceCreated, epicKey: getEpicKey(issue.fields), labels: issue.fields.labels || [],
        issueType: issue.fields.issuetype?.name,
        incoherenceCount: ticketIncoherences.length,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    const oversized = scored.filter((t) => t.isOversized);
    const blocked = scored.filter((t) => t.isBlocked);
    const unblockers = scored.filter((t) => t.downstreamCount > 0 && !t.isBlocked).sort((a, b) => b.downstreamCount - a.downstreamCount);
    const overdue = scored.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now);
    const quickWins = scored.filter((t) => !t.isBlocked && t.storyPoints && t.storyPoints <= 3 && t.statusCategory === "new").slice(0, 10);

    res.json({
      tickets: scored, oversized, blocked, unblockers: unblockers.slice(0, 10), overdue, quickWins,
      incoherences,
      storyPointSettings: STORY_POINT_SETTINGS,
      stats: {
        total: scored.length, oversizedCount: oversized.length, blockedCount: blocked.length,
        overdueCount: overdue.length, unblockerCount: unblockers.length,
        incoherenceCount: incoherences.length,
        avgStoryPoints: scored.filter((t) => t.storyPoints).length > 0
          ? Math.round(scored.filter((t) => t.storyPoints).reduce((s, t) => s + t.storyPoints, 0) / scored.filter((t) => t.storyPoints).length * 10) / 10 : 0,
      },
    });
  } catch (err) {
    console.error("Error prioritizing:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── AI Coach Endpoint ───────────────────────────────────

function buildAiPrompt(context, question, data) {
  return `You are an experienced Agile Coach and Scrum Master. You help teams improve their agile practices, identify process issues, and suggest actionable improvements.

CONTEXT: ${context}

DATA:
${JSON.stringify(data || {}, null, 2).substring(0, 8000)}

USER QUESTION: ${question}

Provide a helpful, actionable response. Be specific and reference the data when possible. Keep your response concise but thorough. Use bullet points for recommendations. If suggesting process changes, explain the "why" behind each suggestion.`;
}

async function callAiProvider(prompt) {
  const { provider, model, apiKey, baseUrl } = AI_CONFIG;

  if (provider === "openai" || provider === "custom") {
    const url = (provider === "custom" && baseUrl) ? `${baseUrl.replace(/\/+$/, "")}/chat/completions` : "https://api.openai.com/v1/chat/completions";
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model || "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 1500 }),
    });
    if (!resp.ok) { const t = await resp.text(); throw new Error(`OpenAI API ${resp.status}: ${t.slice(0, 200)}`); }
    const json = await resp.json();
    return json.choices?.[0]?.message?.content || "";
  }

  if (provider === "anthropic") {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: model || "claude-haiku-4-5-20251001", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
    });
    if (!resp.ok) { const t = await resp.text(); throw new Error(`Anthropic API ${resp.status}: ${t.slice(0, 200)}`); }
    const json = await resp.json();
    return json.content?.[0]?.text || "";
  }

  if (provider === "mistral") {
    const resp = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model || "mistral-small-latest", messages: [{ role: "user", content: prompt }], max_tokens: 1500 }),
    });
    if (!resp.ok) { const t = await resp.text(); throw new Error(`Mistral API ${resp.status}: ${t.slice(0, 200)}`); }
    const json = await resp.json();
    return json.choices?.[0]?.message?.content || "";
  }

  if (provider === "ollama") {
    const base = baseUrl || "http://localhost:11434";
    const resp = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model || "llama3", messages: [{ role: "user", content: prompt }], stream: false }),
    });
    if (!resp.ok) { const t = await resp.text(); throw new Error(`Ollama API ${resp.status}: ${t.slice(0, 200)}`); }
    const json = await resp.json();
    return json.message?.content || "";
  }

  throw new Error("no_provider");
}

// ─── RACI Matrix ────────────────────────────────────────

const DEFAULT_ACTIVITIES = [
  "Sprint Planning", "Backlog Refinement", "Code Review", "Architecture Decisions",
  "Release Sign-off", "Incident Response", "Deployment", "Sprint Review / Demo",
  "Retrospective Facilitation", "Stakeholder Communication",
];

const DEFAULT_ROLES = ["Product Owner", "Scrum Master", "Tech Lead", "Developer", "QA", "Stakeholder"];

app.get("/raci", (req, res) => {
  const list = Object.values(raciMatrices).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(list);
});

app.post("/raci", (req, res) => {
  const { id, template } = req.body;

  // Create from template
  if (template === "agile-default" && !id) {
    const now = Date.now();
    const matrix = {
      id: `raci-${now}`,
      name: "Project RACI",
      type: "project",
      activities: DEFAULT_ACTIVITIES.map((name, i) => ({ id: `act-${now}-${i}`, name, order: i })),
      roles: DEFAULT_ROLES.map((name, i) => ({ id: `role-${now}-${i}`, name, order: i })),
      assignments: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    raciMatrices[matrix.id] = matrix;
    return res.json(matrix);
  }

  // Upsert existing
  const matrixId = id || `raci-${Date.now()}`;
  const existing = raciMatrices[matrixId];
  raciMatrices[matrixId] = {
    ...req.body,
    id: matrixId,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  res.json(raciMatrices[matrixId]);
});

app.delete("/raci/:id", (req, res) => {
  delete raciMatrices[req.params.id];
  res.json({ ok: true });
});

app.post("/raci/:id/validate", (req, res) => {
  const matrix = raciMatrices[req.params.id];
  if (!matrix) return res.status(404).json({ error: "Matrix not found" });

  const errors = [];
  const warnings = [];

  for (const act of matrix.activities) {
    const row = matrix.roles.map((r) => matrix.assignments[`${act.id}:${r.id}`]).filter(Boolean);
    const aCount = row.filter((v) => v === "A").length;
    const rCount = row.filter((v) => v === "R").length;

    if (aCount === 0) errors.push({ activity: act.name, message: "No one is Accountable (A)" });
    if (aCount > 1) errors.push({ activity: act.name, message: `${aCount} people are Accountable — must be exactly 1` });
    if (rCount === 0) warnings.push({ activity: act.name, message: "No one is Responsible (R)" });
    if (row.length === 0) warnings.push({ activity: act.name, message: "No assignments at all" });
  }

  // Check overloaded roles
  for (const role of matrix.roles) {
    const aCount = matrix.activities.filter((act) => matrix.assignments[`${act.id}:${role.id}`] === "A").length;
    if (aCount > 5) warnings.push({ role: role.name, message: `Accountable for ${aCount} activities (may be overloaded)` });
  }

  res.json({ valid: errors.length === 0, errors, warnings, score: Math.max(0, 100 - errors.length * 15 - warnings.length * 5) });
});

app.get("/raci/suggest", async (req, res) => {
  try {
    const server = resolveServerFromReq(req);
    if (!server) return res.status(400).json({ error: "No Jira server configured" });

    const jql = req.query.jql || `project = ${TEAMS[0]?.projectKey || "TEAM"} ORDER BY updated DESC`;
    const data = await jiraSearchAll(jql, "assignee,reporter,issuetype,status,comment", 200, "", server?.id);
    const issues = data.issues;

    // Analyze patterns
    const assigneeCounts = {};
    const reporterCounts = {};
    const commenterCounts = {};

    for (const issue of issues) {
      const assignee = issue.fields.assignee?.displayName || "Unassigned";
      const reporter = issue.fields.reporter?.displayName || "Unknown";
      assigneeCounts[assignee] = (assigneeCounts[assignee] || 0) + 1;
      reporterCounts[reporter] = (reporterCounts[reporter] || 0) + 1;

      const comments = issue.fields.comment?.comments || [];
      for (const c of comments.slice(-5)) {
        const name = c.author?.displayName || "Unknown";
        commenterCounts[name] = (commenterCounts[name] || 0) + 1;
      }
    }

    // Build suggested roles from top contributors
    const topAssignees = Object.entries(assigneeCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const topReporters = Object.entries(reporterCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const allPeople = [...new Set([...topAssignees.map(([n]) => n), ...topReporters.map(([n]) => n)])].slice(0, 8);

    const now = Date.now();
    const suggestedMatrix = {
      id: `raci-${now}`,
      name: "Suggested RACI (from Jira activity)",
      type: "project",
      activities: DEFAULT_ACTIVITIES.map((name, i) => ({ id: `act-${now}-${i}`, name, order: i })),
      roles: allPeople.map((name, i) => ({ id: `role-${now}-${i}`, name, order: i })),
      assignments: {},
      insights: {
        totalIssues: issues.length,
        topAssignees: topAssignees.map(([name, count]) => ({ name, count })),
        topReporters: topReporters.map(([name, count]) => ({ name, count })),
      },
    };

    // Auto-assign: top reporter = A for most activities, top assignees = R
    if (topReporters.length > 0) {
      const aRole = suggestedMatrix.roles.find((r) => r.name === topReporters[0][0]);
      if (aRole) {
        for (const act of suggestedMatrix.activities) {
          suggestedMatrix.assignments[`${act.id}:${aRole.id}`] = "A";
        }
      }
    }
    if (topAssignees.length > 0) {
      const rRole = suggestedMatrix.roles.find((r) => r.name === topAssignees[0][0]);
      if (rRole) {
        for (const act of suggestedMatrix.activities) {
          if (!suggestedMatrix.assignments[`${act.id}:${rRole.id}`]) {
            suggestedMatrix.assignments[`${act.id}:${rRole.id}`] = "R";
          }
        }
      }
    }

    res.json(suggestedMatrix);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI Coach Endpoint ───────────────────────────────────

app.post("/ai/coach", async (req, res) => {
  try {
    const { context, question, data } = req.body;
    if (!context || !question) {
      return res.status(400).json({ error: "Missing context or question" });
    }

    const prompt = buildAiPrompt(context, question, data);

    // If AI provider is configured and enabled, call it
    if (AI_CONFIG.enabled && AI_CONFIG.provider && (AI_CONFIG.apiKey || AI_CONFIG.provider === "ollama")) {
      try {
        const answer = await callAiProvider(prompt);
        return res.json({ answer, prompt, context, question });
      } catch (aiErr) {
        if (aiErr.message !== "no_provider") {
          return res.status(502).json({ error: `AI provider error: ${aiErr.message}`, prompt });
        }
      }
    }

    // No provider configured — return the prompt for the user to use manually
    res.json({ prompt, context, question });
  } catch (err) {
    console.error("Error in AI coach:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── Cross-Project Dependencies ──────────────────────────

app.get("/dependencies", async (req, res) => {
  try {
    // Fetch issues from all configured projects/servers
    const projectKeys = new Set();
    for (const team of TEAMS) {
      if (team.projectKey) projectKeys.add(team.projectKey);
    }
    for (const server of JIRA_SERVERS) {
      for (const pk of server.projects || []) projectKeys.add(pk);
    }

    const allProjects = [...projectKeys];
    if (allProjects.length === 0) allProjects.push(JIRA_PROJECT_KEY);

    // Build JQL to fetch from all projects
    const projectsJql = req.query.jql || `project in (${allProjects.join(",")}) AND statusCategory != Done ORDER BY priority ASC, updated DESC`;
    const fieldsStr = `summary,status,assignee,priority,issuetype,created,updated,duedate,issuelinks,${EPIC_LINK_FIELDS.join(",")},parent,labels`;

    const data = await jiraSearchAll(projectsJql, fieldsStr, 200, "", req.query.serverId);

    // Build dependency graph
    const nodes = {};
    const edges = [];
    const crossProjectEdges = [];

    for (const issue of data.issues) {
      const f = issue.fields;
      const project = issue.key.split("-")[0];
      nodes[issue.key] = {
        key: issue.key,
        project,
        summary: f.summary,
        status: f.status?.name,
        statusCategory: f.status?.statusCategory?.key,
        assignee: f.assignee?.displayName,
        priority: f.priority?.name,
        issueType: f.issuetype?.name,
        dueDate: f.duedate,
        epicKey: getEpicKey(f),
        labels: f.labels || [],
      };

      for (const link of f.issuelinks || []) {
        const target = link.outwardIssue || link.inwardIssue;
        if (!target) continue;

        const targetProject = target.key.split("-")[0];
        const isOutward = !!link.outwardIssue;
        const fromKey = isOutward ? issue.key : target.key;
        const toKey = isOutward ? target.key : issue.key;
        const edge = {
          from: fromKey,
          to: toKey,
          type: link.type?.name,
          direction: isOutward ? link.type?.outward : link.type?.inward,
          fromProject: isOutward ? project : targetProject,
          toProject: isOutward ? targetProject : project,
          isCrossProject: project !== targetProject,
          fromSummary: isOutward ? f.summary : target.fields?.summary,
          fromStatus: isOutward ? f.status?.name : target.fields?.status?.name,
          fromPriority: isOutward ? f.priority?.name : target.fields?.priority?.name,
          toSummary: isOutward ? target.fields?.summary : f.summary,
          toStatus: isOutward ? target.fields?.status?.name : f.status?.name,
          toStatusCategory: isOutward ? target.fields?.status?.statusCategory?.key : f.status?.statusCategory?.key,
          toPriority: isOutward ? target.fields?.priority?.name : f.priority?.name,
        };

        edges.push(edge);
        if (edge.isCrossProject) crossProjectEdges.push(edge);

        // Add target node if not already known
        if (!nodes[target.key]) {
          nodes[target.key] = {
            key: target.key,
            project: targetProject,
            summary: target.fields?.summary,
            status: target.fields?.status?.name,
            statusCategory: target.fields?.status?.statusCategory?.key,
            priority: target.fields?.priority?.name,
            issueType: target.fields?.issuetype?.name,
            external: true, // not in our JQL result set
          };
        }
      }
    }

    // Analyze blocking chains
    const blockingEdges = edges.filter(e =>
      e.direction?.toLowerCase().includes("block") ||
      e.type?.toLowerCase().includes("block")
    );
    const blockedByExternal = blockingEdges.filter(e => e.isCrossProject);

    // Project-to-project matrix (deduplicated: A->B and B->A count as one link)
    const projectMatrix = {};
    for (const edge of crossProjectEdges) {
      const pairKey = [edge.fromProject, edge.toProject].sort().join(" <-> ");
      if (!projectMatrix[pairKey]) {
        projectMatrix[pairKey] = { pair: pairKey, projects: [edge.fromProject, edge.toProject].sort(), count: 0, blocking: 0, edges: [], seenLinks: new Set(), seenBlocking: new Set() };
      }
      // Deduplicate: "A blocks B" and "B is blocked by A" are the same relationship
      const linkKey = [edge.from, edge.to].sort().join(":");
      if (!projectMatrix[pairKey].seenLinks.has(linkKey)) {
        projectMatrix[pairKey].seenLinks.add(linkKey);
        projectMatrix[pairKey].count++;
      }
      if (edge.direction?.toLowerCase().includes("block")) {
        if (!projectMatrix[pairKey].seenBlocking.has(linkKey)) {
          projectMatrix[pairKey].seenBlocking.add(linkKey);
          projectMatrix[pairKey].blocking++;
        }
      }
      projectMatrix[pairKey].edges.push(edge);
    }
    // Clean up internal tracking sets before sending response
    for (const pm of Object.values(projectMatrix)) { delete pm.seenLinks; delete pm.seenBlocking; }

    // Critical path: issues that block the most other issues (deduplicated)
    // Edge semantics: from=source issue, to=target issue
    // For inward links: from=inwardIssue (blocker), to=currentIssue (blocked), direction="is blocked by"
    // For outward links: from=currentIssue (blocker), to=outwardIssue (blocked), direction="blocks"
    // In BOTH cases: from is the BLOCKER, to is the BLOCKED
    const blockSets = {}; // blocker key -> Set of blocked keys
    const seenBlockPairs = new Set();
    for (const edge of blockingEdges) {
      const blocker = edge.from;
      const blocked = edge.to;
      const pairKey = blocker + ":" + blocked;
      if (seenBlockPairs.has(pairKey)) continue;
      seenBlockPairs.add(pairKey);
      if (!blockSets[blocker]) blockSets[blocker] = new Set();
      blockSets[blocker].add(blocked);
    }
    const criticalBlockers = Object.entries(blockSets)
      .map(([key, blockedSet]) => ({
        ...nodes[key],
        blocksCount: blockedSet.size,
        blockedKeys: [...blockedSet],
        isCrossProject: [...blockedSet].some(bk => nodes[bk]?.project !== nodes[key]?.project),
      }))
      .sort((a, b) => b.blocksCount - a.blocksCount)
      .slice(0, 15);

    // Build blocking tree from ALL blockers (not just top 15 criticalBlockers)
    // A "root" is a blocker that is NOT blocked by anyone else
    const blockedBySet = new Set();
    for (const s of Object.values(blockSets)) for (const k of s) blockedBySet.add(k);
    const allBlockerKeys = Object.keys(blockSets);
    const rootBlockerKeys = allBlockerKeys.filter(k => !blockedBySet.has(k));
    // If no pure roots (all in cycles), use all blockers
    const treeRootKeys = rootBlockerKeys.length > 0 ? rootBlockerKeys : allBlockerKeys;

    function buildBlockingTree(key, visited = new Set()) {
      if (visited.has(key)) return null; // cycle protection
      visited.add(key);
      const node = nodes[key];
      if (!node) return null;
      const children = (blockSets[key] || new Set());
      return {
        key: node.key,
        summary: node.summary,
        status: node.status,
        statusCategory: node.statusCategory,
        priority: node.priority,
        assignee: node.assignee,
        project: node.project,
        blocksCount: children.size,
        children: [...children]
          .map(childKey => buildBlockingTree(childKey, new Set(visited)))
          .filter(Boolean)
          .sort((a, b) => b.blocksCount - a.blocksCount),
      };
    }

    const blockingTree = treeRootKeys
      .map(k => buildBlockingTree(k))
      .filter(Boolean)
      .sort((a, b) => {
        // Sort by total descendants (deep count)
        const countDesc = (n) => n.children.reduce((s, c) => s + 1 + countDesc(c), 0);
        return countDesc(b) - countDesc(a);
      });

    res.json({
      projects: allProjects,
      nodes: Object.values(nodes),
      edges,
      crossProjectEdges,
      projectMatrix: Object.values(projectMatrix).sort((a, b) => b.count - a.count),
      stats: {
        totalNodes: Object.keys(nodes).length,
        totalEdges: edges.length,
        crossProjectCount: crossProjectEdges.length,
        blockingCount: blockingEdges.length,
        crossProjectBlockingCount: blockedByExternal.length,
      },
      criticalBlockers,
      blockingTree,
    });
  } catch (err) {
    console.error("Error fetching dependencies:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── AI Dependency Discovery ─────────────────────────────

app.post("/dependencies/discover", async (req, res) => {
  try {
    const { projects } = req.body;
    // Determine which projects to analyze
    const projectKeys = new Set();
    if (projects && Array.isArray(projects)) {
      projects.forEach(p => projectKeys.add(p));
    } else {
      for (const team of TEAMS) {
        if (team.projectKey) projectKeys.add(team.projectKey);
      }
      for (const server of JIRA_SERVERS) {
        for (const pk of server.projects || []) projectKeys.add(pk);
      }
    }
    const allProjects = [...projectKeys];
    if (allProjects.length === 0) allProjects.push(JIRA_PROJECT_KEY);

    // Fetch active issues from all projects
    const projectIssues = {};
    for (const pk of allProjects) {
      const jql = `project = ${pk} AND statusCategory != Done ORDER BY priority ASC, updated DESC`;
      const fieldsStr = `summary,status,assignee,priority,issuetype,description,labels,duedate,${EPIC_LINK_FIELDS.join(",")},parent`;
      const data = await jiraSearchAll(jql, fieldsStr, 100, "", req.query.serverId);
      projectIssues[pk] = data.issues.map(i => ({
        key: i.key,
        summary: i.fields.summary,
        description: (i.fields.description || "").substring(0, 500),
        status: i.fields.status?.name,
        statusCategory: i.fields.status?.statusCategory?.key,
        assignee: i.fields.assignee?.displayName,
        priority: i.fields.priority?.name,
        issueType: i.fields.issuetype?.name,
        labels: i.fields.labels || [],
        dueDate: i.fields.duedate,
        epicKey: getEpicKey(i.fields),
        epicName: i.fields.parent?.fields?.summary || getEpicName(i.fields),
      }));
    }

    // Build prompt for AI
    const ticketSummaries = {};
    for (const [pk, issues] of Object.entries(projectIssues)) {
      ticketSummaries[pk] = issues.map(i =>
        `  ${i.key} | ${i.issueType} | ${i.summary} | Status: ${i.status} | Assignee: ${i.assignee || "Unassigned"} | Labels: ${i.labels.join(",")} | Due: ${i.dueDate || "none"}\n    Desc: ${i.description.substring(0, 200)}`
      ).join("\n");
    }

    const projectSections = Object.entries(ticketSummaries)
      .map(([pk, text]) => `PROJECT: ${pk}\n${text}`)
      .join("\n\n");

    // Build the prompt and return it — no external AI provider call
    const prompt = `You are an expert Agile Coach and Program Manager. Analyze tickets across multiple Jira projects to discover dependencies, shared work, blockers, and coordination needs.

PROJECTS AND THEIR ACTIVE TICKETS:
${projectSections.substring(0, 12000)}

TASK: Identify all cross-project dependencies, shared concerns, and coordination needs. Look for:
1. **Blocking dependencies**: Ticket A in project X cannot proceed until ticket B in project Y is done
2. **Shared components**: Tickets across projects that touch the same system, API, database, or service
3. **Data dependencies**: One project produces data/APIs another project consumes
4. **Sequential work**: Work that must happen in a specific order across projects
5. **Shared resources**: Same person assigned across projects (resource conflict)
6. **Similar/duplicate work**: Overlapping scope between projects
7. **Risk propagation**: A delay in one project that would impact another

Respond with ONLY valid JSON (no markdown, no backticks):
{
  "dependencies": [
    {
      "from": "PROJ-123",
      "to": "OTHER-456",
      "type": "blocks|shared_component|data_dependency|sequential|resource_conflict|duplicate|risk",
      "confidence": "high|medium|low",
      "reason": "Brief explanation of why these are dependent",
      "impact": "high|medium|low",
      "recommendation": "What the team should do about this dependency"
    }
  ],
  "risks": [
    {
      "description": "Cross-project risk description",
      "affectedProjects": ["PROJ", "OTHER"],
      "severity": "high|medium|low",
      "mitigation": "Suggested action"
    }
  ],
  "recommendations": [
    "Overall coordination recommendation 1",
    "Overall coordination recommendation 2"
  ],
  "sharedResources": [
    {
      "person": "Name",
      "projects": ["PROJ", "OTHER"],
      "ticketCount": 5,
      "risk": "Overloaded / context switching"
    }
  ]
}`;

    // Return prompt + issue data so frontend can enrich after user pastes AI response
    const allIssues = Object.values(projectIssues).flat();
    const issueMap = {};
    for (const issue of allIssues) issueMap[issue.key] = issue;

    res.json({
      prompt,
      projects: allProjects,
      projectIssueCounts: Object.fromEntries(Object.entries(projectIssues).map(([k, v]) => [k, v.length])),
      issueMap,
      totalAnalyzed: allIssues.length,
    });
  } catch (err) {
    console.error("Error discovering dependencies:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── Start ───────────────────────────────────────────────
const server = app.listen(PORT, async () => {
  console.log(`Dashboard API running on port ${PORT}`);

  console.log(`Config loaded from: ${configSource}`);
  console.log(`Jira: ${defaultServer().url}`);
  console.log(`Teams: ${TEAMS.map((t) => t.name).join(", ")}`);
  console.log(`Servers: ${JIRA_SERVERS.map((s) => s.name).join(", ")}`);
  await detectEpicFields();
});

// Graceful shutdown (works on Linux, macOS, Windows, Cygwin/MobaXterm)
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nShutting down...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// Cygwin/MobaXterm/Git Bash: stdin closes when Ctrl+C is pressed
// Only attach stdin handlers when running interactively (not in Docker/k8s)
if (process.stdin.isTTY) {
  process.stdin.resume();
  process.stdin.on("end", shutdown);
  process.stdin.on("error", shutdown);
}
