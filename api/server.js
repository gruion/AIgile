import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// ─── Config ──────────────────────────────────────────────
const PORT = process.env.API_PORT || process.env.PORT || 3011;
const JIRA_BASE_URL = process.env.JIRA_BASE_URL || "http://localhost:9080";
const JIRA_USERNAME = process.env.JIRA_USERNAME || "admin";
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN || "";
const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || "TEAM";
const DEFAULT_JQL = process.env.JIRA_DEFAULT_JQL || `project = ${JIRA_PROJECT_KEY} ORDER BY status ASC, updated DESC`;

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
      piConfig: PI_CONFIG,
      programProject: PROGRAM_PROJECT,
      programServerId: PROGRAM_SERVER_ID,
      jqlBookmarks: JQL_BOOKMARKS,
      disabledPiChecks: DISABLED_PI_CHECKS,
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
let PI_CONFIG = { name: "", startDate: "", endDate: "", sprintCount: 5, sprintDuration: 14, enabled: false };
let PROGRAM_PROJECT = "";
let PROGRAM_SERVER_ID = "primary";
let JQL_BOOKMARKS = []; // [{ id, name, jql }]
let DISABLED_PI_CHECKS = []; // array of check ids to skip in PI compliance

if (fileConfig) {
  // Tier 1: persisted config file
  configSource = "file";
  JIRA_SERVERS = fileConfig.servers || [];
  TEAMS = fileConfig.teams || [];
  if (fileConfig.piConfig) PI_CONFIG = { ...PI_CONFIG, ...fileConfig.piConfig };
  PROGRAM_PROJECT = fileConfig.programProject ?? "";
  PROGRAM_SERVER_ID = fileConfig.programServerId ?? "primary";
  JQL_BOOKMARKS = fileConfig.jqlBookmarks || [];
  DISABLED_PI_CHECKS = fileConfig.disabledPiChecks || [];
} else {
  // Tier 2: environment variables
  try { JIRA_SERVERS = JSON.parse(process.env.JIRA_SERVERS || "[]"); } catch { JIRA_SERVERS = []; }
  try { TEAMS = JSON.parse(process.env.TEAMS || "[]"); } catch { TEAMS = []; }
  PI_CONFIG = {
    name: process.env.PI_NAME || "",
    startDate: process.env.PI_START_DATE || "",
    endDate: process.env.PI_END_DATE || "",
    sprintCount: parseInt(process.env.PI_SPRINT_COUNT) || 5,
    sprintDuration: parseInt(process.env.PI_SPRINT_DURATION) || 14,
    enabled: !!(process.env.PI_START_DATE && process.env.PI_END_DATE),
  };
  PROGRAM_PROJECT = process.env.PROGRAM_PROJECT || "";
  PROGRAM_SERVER_ID = process.env.PROGRAM_SERVER_ID || "primary";
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
    projectKey: JIRA_SERVERS[0].projects?.[0] || "TEAM", boardId: null, color: "#3B82F6",
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
const JIRA_BROWSER_URL = process.env.JIRA_BROWSER_URL || process.env.NEXT_PUBLIC_JIRA_BASE_URL || "http://localhost:9080";
function getBrowserUrl(server) {
  return server.browserUrl || JIRA_BROWSER_URL;
}

// Helper: fetch from a specific server
function jiraHeadersFor(server) {
  return {
    Authorization: "Basic " + Buffer.from(`${server.username}:${server.token}`).toString("base64"),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function jiraFetchFrom(server, path) {
  const url = `${server.url}/rest/api/2${path}`;
  const res = await fetch(url, { headers: jiraHeadersFor(server) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API ${res.status} (${server.name}): ${text}`);
  }
  return res.json();
}

async function jiraFetchAgileFrom(server, path) {
  const url = `${server.url}/rest/agile/1.0${path}`;
  const res = await fetch(url, { headers: jiraHeadersFor(server) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira Agile API ${res.status} (${server.name}): ${text}`);
  }
  return res.json();
}

async function jiraSearchAllFrom(server, jql, fieldsStr, pageSize = 100, expand = "") {
  let startAt = 0;
  let allIssues = [];
  let total = 0;
  do {
    const expandParam = expand ? `&expand=${expand}` : "";
    const data = await jiraFetchFrom(server,
      `/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${pageSize}&fields=${fieldsStr}${expandParam}`
    );
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

async function detectEpicFields() {
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
  } catch (err) {
    console.warn(`Could not auto-detect epic fields (${err.message}), using defaults`);
  }
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
function defaultServer() { return resolveServer(); }

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
  if (req.query.serverId) return resolveServer(req.query.serverId);
  const project = extractProjectFromJql(req.query.jql) || req.query.project;
  if (project) return resolveServerForProject(project);
  return defaultServer();
}

// Middleware: auto-resolve serverId from JQL project key if not explicitly set
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
  const res = await fetch(url, { headers: jiraHeadersFor(srv) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API ${res.status}: ${text}`);
  }
  return res.json();
}

async function jiraFetchAgile(path, serverId) {
  const srv = resolveServer(serverId);
  const url = `${srv.url}/rest/agile/1.0${path}`;
  const res = await fetch(url, { headers: jiraHeadersFor(srv) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira Agile API ${res.status}: ${text}`);
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

  // Method 2: "Epic Link" — classic Jira Server/DC with Software
  if (HAS_EPIC_LINK_JQL) {
    clauses.push(`"Epic Link" = ${epicKey}`);
  }

  // Method 3: parent = KEY — Jira 10.x / next-gen / team-managed
  clauses.push(`parent = ${epicKey}`);

  return `(${clauses.join(" OR ")}) ORDER BY status ASC, priority DESC`;
}

// ─── Routes ──────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({ status: "ok", jira: JIRA_BASE_URL, epicLinkJql: HAS_EPIC_LINK_JQL });
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
  res.json({
    epicChildrenJqlTemplate: EPIC_CHILDREN_JQL_TEMPLATE,
    hasEpicLinkJql: HAS_EPIC_LINK_JQL,
    missingInfoCriteria: MISSING_INFO_CRITERIA,
    promptSettings: PROMPT_SETTINGS,
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

    // Fetch all child tickets — uses compatible JQL (no "Epic Link" if unsupported)
    const jql = buildEpicChildrenJql(epicKey);
    const epicFieldsList = EPIC_LINK_FIELDS.join(",");
    const fieldsStr = `summary,status,assignee,priority,updated,created,duedate,description,issuetype,labels,comment,issuelinks,timetracking,${epicFieldsList},parent`;

    // Paginate to get ALL children
    const data = await jiraSearchAll(jql, fieldsStr, 100, "", req.query.serverId);

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

// ─── Retro Collaboration (in-memory store, persisted per session) ──

let retroSessions = {};

app.get("/retro/sessions", (req, res) => {
  const sessions = Object.values(retroSessions)
    .map(({ id, title, createdAt, entries }) => ({
      id, title, createdAt, entryCount: entries.length,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(sessions);
});

app.post("/retro/sessions", (req, res) => {
  const id = `retro-${Date.now()}`;
  const session = {
    id,
    title: req.body.title || `Retrospective ${new Date().toISOString().split("T")[0]}`,
    createdAt: new Date().toISOString(),
    entries: [],
  };
  retroSessions[id] = session;
  res.json(session);
});

app.get("/retro/sessions/:id", (req, res) => {
  const session = retroSessions[req.params.id];
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

app.post("/retro/sessions/:id/entries", (req, res) => {
  const session = retroSessions[req.params.id];
  if (!session) return res.status(404).json({ error: "Session not found" });

  const { author, category, text } = req.body;
  if (!text || !category) return res.status(400).json({ error: "Missing text or category" });

  const entry = {
    id: `entry-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    author: author || "Anonymous",
    category, // "went_well" | "to_improve" | "action_item" | "question" | "shoutout"
    text,
    votes: 0,
    createdAt: new Date().toISOString(),
  };
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

// ─── Multi-Team / PI Planning Endpoints ─────────────────

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
    piConfig: PI_CONFIG,
    programBoard: { projectKey: PROGRAM_PROJECT, serverId: PROGRAM_SERVER_ID },
    jqlBookmarks: JQL_BOOKMARKS,
    disabledPiChecks: DISABLED_PI_CHECKS,
    configSource,
    needsSetup: needsSetup(),
  };
}

// Lightweight status check for frontend setup guard
app.get("/config/status", (req, res) => {
  res.json({ needsSetup: needsSetup(), configSource, serverCount: JIRA_SERVERS.length, teamCount: TEAMS.length });
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
    return res.json({ ok: true, displayName: user.displayName, emailAddress: user.emailAddress });
  } catch (err) {
    const msg = err.cause?.code === "ENOTFOUND" ? `Cannot resolve hostname: ${new URL(url).hostname}`
      : err.cause?.code === "ECONNREFUSED" ? `Connection refused: ${url}`
      : err.message === "fetch failed" ? `Cannot reach server at ${url}`
      : err.message;
    return res.json({ ok: false, error: msg });
  }
});

// Get configuration: servers, teams, PI
app.get("/config", (req, res) => {
  res.json(configResponse());
});

// Update configuration at runtime and persist to file
app.post("/config", (req, res) => {
  if (req.body.teams) TEAMS = req.body.teams;
  if (req.body.piConfig) PI_CONFIG = { ...PI_CONFIG, ...req.body.piConfig };
  if (req.body.programBoard) {
    if (req.body.programBoard.projectKey !== undefined) PROGRAM_PROJECT = req.body.programBoard.projectKey;
    if (req.body.programBoard.serverId !== undefined) PROGRAM_SERVER_ID = req.body.programBoard.serverId;
  }
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
  if (req.body.jqlBookmarks) JQL_BOOKMARKS = req.body.jqlBookmarks;
  if (req.body.disabledPiChecks) DISABLED_PI_CHECKS = req.body.disabledPiChecks;
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

// Reset config: delete file and reload from env vars
app.post("/config/reset", (req, res) => {
  try { fs.unlinkSync(CONFIG_FILE); } catch {}
  // Re-parse from env vars
  try { JIRA_SERVERS = JSON.parse(process.env.JIRA_SERVERS || "[]"); } catch { JIRA_SERVERS = []; }
  try { TEAMS = JSON.parse(process.env.TEAMS || "[]"); } catch { TEAMS = []; }
  PI_CONFIG = {
    name: process.env.PI_NAME || "",
    startDate: process.env.PI_START_DATE || "",
    endDate: process.env.PI_END_DATE || "",
    sprintCount: parseInt(process.env.PI_SPRINT_COUNT) || 5,
    sprintDuration: parseInt(process.env.PI_SPRINT_DURATION) || 14,
    enabled: !!(process.env.PI_START_DATE && process.env.PI_END_DATE),
  };
  PROGRAM_PROJECT = process.env.PROGRAM_PROJECT || "";
  PROGRAM_SERVER_ID = process.env.PROGRAM_SERVER_ID || "primary";
  JQL_BOOKMARKS = [];
  DISABLED_PI_CHECKS = [];
  if (JIRA_SERVERS.length === 0 && JIRA_API_TOKEN) {
    JIRA_SERVERS.push({
      id: "primary", name: "Primary Jira", url: JIRA_BASE_URL,
      username: JIRA_USERNAME, token: JIRA_API_TOKEN,
      projects: [JIRA_PROJECT_KEY], browserUrl: "",
    });
  }
  if (TEAMS.length === 0 && JIRA_SERVERS.length > 0) {
    TEAMS.push({ id: "default", name: "Default Team", serverId: JIRA_SERVERS[0].id,
      projectKey: JIRA_SERVERS[0].projects?.[0] || "TEAM", boardId: null, color: "#3B82F6" });
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

// PI Planning: aggregate all teams' data
app.get("/pi/overview", async (req, res) => {
  try {
    const epicFields = EPIC_LINK_FIELDS.join(",");
    const fieldsStr = `summary,status,assignee,priority,updated,created,duedate,description,issuetype,labels,comment,${epicFields},parent,timetracking,flagged,issuelinks`;
    const now = Date.now();

    // Build PI date filter if configured and enabled
    const piStart = PI_CONFIG.enabled !== false ? PI_CONFIG.startDate : "";
    const piEnd = PI_CONFIG.enabled !== false ? PI_CONFIG.endDate : "";
    // Filter modes: "pi" (default when dates set), "all", "sprint"
    const filterMode = req.query.filter || (piStart && piEnd ? "pi" : "all");
    const sprintName = req.query.sprint || null;

    const teamResults = [];

    for (const team of TEAMS) {
      const server = getServer(team.serverId);
      // Default JQL: use per-team jql config, else project-based fallback
      const defaultJql = team.jql || `project = ${team.projectKey} ORDER BY status ASC, updated DESC`;
      let teamJql;
      if (req.query.jql) {
        teamJql = req.query.jql.replace(/\{PROJECT\}/g, team.projectKey);
      } else {
        teamJql = defaultJql;
      }

      try {
        const data = await jiraSearchAllFrom(server, teamJql, fieldsStr);

        const issues = data.issues.map((issue) => {
          const mapped = {
            key: issue.key,
            summary: issue.fields.summary,
            status: issue.fields.status?.name,
            statusCategory: issue.fields.status?.statusCategory?.key,
            assigneeName: issue.fields.assignee?.displayName || null,
            priority: issue.fields.priority?.name,
            issueType: issue.fields.issuetype?.name,
            labels: issue.fields.labels || [],
            created: issue.fields.created,
            updated: issue.fields.updated,
            dueDate: issue.fields.duedate || null,
            epicKey: getEpicKey(issue.fields),
            parentKey: issue.fields.parent?.key || null,
            originalEstimate: issue.fields.timetracking?.originalEstimate || null,
            commentCount: issue.fields.comment?.total || 0,
            daysSinceUpdate: daysSince(issue.fields.updated),
            teamId: team.id,
            serverId: team.serverId,
            serverUrl: getBrowserUrl(server),
            // Cross-team links
            linkedIssues: (issue.fields.issuelinks || []).map((link) => ({
              type: link.type?.name,
              direction: link.inwardIssue ? "inward" : "outward",
              key: link.inwardIssue?.key || link.outwardIssue?.key,
              summary: link.inwardIssue?.fields?.summary || link.outwardIssue?.fields?.summary,
              status: link.inwardIssue?.fields?.status?.name || link.outwardIssue?.fields?.status?.name,
            })),
          };
          mapped.urgencyFlags = computeUrgency(mapped);
          return mapped;
        });

        const total = issues.length;
        const done = issues.filter((i) => i.statusCategory === "done").length;
        const inProgress = issues.filter((i) => i.statusCategory === "indeterminate").length;
        const todo = total - done - inProgress;
        const overdue = issues.filter((i) =>
          i.dueDate && new Date(i.dueDate).getTime() < now && i.statusCategory !== "done"
        ).length;
        const blocked = issues.filter((i) =>
          (i.labels || []).some((l) => l.toLowerCase().includes("block"))
        ).length;

        // Find epics
        const epics = {};
        for (const issue of issues) {
          if (issue.issueType === "Epic") {
            epics[issue.key] = { ...issue, children: [] };
          }
        }
        for (const issue of issues) {
          if (issue.epicKey && epics[issue.epicKey]) {
            epics[issue.epicKey].children.push(issue);
          }
        }

        const epicList = Object.values(epics).map((epic) => {
          const childTotal = epic.children.length;
          const childDone = epic.children.filter((c) => c.statusCategory === "done").length;
          return {
            key: epic.key,
            summary: epic.summary,
            status: epic.status,
            statusCategory: epic.statusCategory,
            dueDate: epic.dueDate,
            assigneeName: epic.assigneeName,
            progress: childTotal > 0 ? Math.round((childDone / childTotal) * 100) : 0,
            childCount: childTotal,
            childDone,
          };
        });

        // Cross-team dependencies
        const crossTeamDeps = [];
        for (const issue of issues) {
          for (const link of issue.linkedIssues || []) {
            if (link.key && !issues.some((i) => i.key === link.key)) {
              crossTeamDeps.push({
                fromKey: issue.key,
                fromSummary: issue.summary,
                fromTeam: team.id,
                toKey: link.key,
                toSummary: link.summary,
                linkType: link.type,
                direction: link.direction,
                toStatus: link.status,
              });
            }
          }
        }

        teamResults.push({
          team: { id: team.id, name: team.name, color: team.color, projectKey: team.projectKey, jql: team.jql || "", serverUrl: getBrowserUrl(server) },
          stats: { total, done, inProgress, todo, overdue, blocked },
          progress: total > 0 ? Math.round((done / total) * 100) : 0,
          epics: epicList,
          issues,
          crossTeamDeps,
          jqlUsed: teamJql,
        });
      } catch (err) {
        teamResults.push({
          team: { id: team.id, name: team.name, color: team.color, projectKey: team.projectKey, jql: team.jql || "", serverUrl: getBrowserUrl(server) },
          error: err.message,
          stats: { total: 0, done: 0, inProgress: 0, todo: 0, overdue: 0, blocked: 0 },
          progress: 0,
          epics: [],
          issues: [],
          crossTeamDeps: [],
        });
      }
    }

    // Aggregate all cross-team dependencies
    const allCrossTeamDeps = teamResults.flatMap((t) => t.crossTeamDeps);

    // Detect bidirectional dependencies
    const depPairs = [];
    for (const dep of allCrossTeamDeps) {
      const reverse = allCrossTeamDeps.find(
        (d) => d.fromKey === dep.toKey && d.toKey === dep.fromKey
      );
      if (reverse && !depPairs.some((p) =>
        (p.a === dep.fromKey && p.b === dep.toKey) || (p.a === dep.toKey && p.b === dep.fromKey)
      )) {
        depPairs.push({ a: dep.fromKey, b: dep.toKey, bidirectional: true });
      }
    }

    // PI-level stats
    const allIssues = teamResults.flatMap((t) => t.issues);
    const totalIssues = allIssues.length;
    const totalDone = allIssues.filter((i) => i.statusCategory === "done").length;

    // Agile coach warnings for PI
    const piWarnings = [];

    // Check for unbalanced teams
    const teamSizes = teamResults.map((t) => t.stats.total);
    const avgTeamSize = teamSizes.reduce((a, b) => a + b, 0) / teamSizes.length;
    const unbalanced = teamResults.filter(
      (t) => t.stats.total > avgTeamSize * 2 || (t.stats.total < avgTeamSize * 0.3 && t.stats.total > 0)
    );
    if (unbalanced.length > 0 && teamResults.length > 1) {
      piWarnings.push({
        severity: "warning",
        title: "Unbalanced workload across teams",
        detail: `Average tickets per team: ${Math.round(avgTeamSize)}. ${unbalanced.map(
          (t) => `${t.team.name}: ${t.stats.total}`
        ).join(", ")} are significantly different.`,
        category: "workload",
      });
    }

    // Cross-team dependency risks
    if (allCrossTeamDeps.length > 10) {
      piWarnings.push({
        severity: "warning",
        title: `${allCrossTeamDeps.length} cross-team dependencies detected`,
        detail: "High number of cross-team dependencies increases coordination overhead. Consider decoupling work or scheduling sync meetings.",
        category: "dependencies",
      });
    }

    // Teams with high overdue
    const overdueTeams = teamResults.filter(
      (t) => t.stats.overdue > 0 && t.stats.overdue / Math.max(t.stats.total, 1) > 0.2
    );
    if (overdueTeams.length > 0) {
      piWarnings.push({
        severity: "critical",
        title: `${overdueTeams.length} team(s) with >20% overdue tickets`,
        detail: overdueTeams.map((t) => `${t.team.name}: ${t.stats.overdue}/${t.stats.total} overdue`).join(", "),
        category: "delivery",
      });
    }

    // Blocked tickets across PI
    const totalBlocked = teamResults.reduce((sum, t) => sum + t.stats.blocked, 0);
    if (totalBlocked > 0) {
      piWarnings.push({
        severity: totalBlocked > 5 ? "critical" : "warning",
        title: `${totalBlocked} blocked ticket(s) across the PI`,
        detail: "Blocked tickets are the highest priority to unblock. Escalate to remove impediments.",
        category: "blockers",
      });
    }

    res.json({
      piConfig: PI_CONFIG,
      filterMode,
      teams: teamResults.map(({ issues, ...rest }) => rest), // exclude raw issues for overview
      piStats: {
        totalTeams: teamResults.length,
        totalIssues,
        totalDone,
        progress: totalIssues > 0 ? Math.round((totalDone / totalIssues) * 100) : 0,
        totalCrossTeamDeps: allCrossTeamDeps.length,
      },
      crossTeamDeps: allCrossTeamDeps,
      bidirectionalDeps: depPairs,
      piWarnings,
    });
  } catch (err) {
    console.error("Error fetching PI overview:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// Single team detail within PI
app.get("/pi/team/:teamId", async (req, res) => {
  try {
    const team = TEAMS.find((t) => t.id === req.params.teamId);
    if (!team) return res.status(404).json({ error: "Team not found" });

    const server = getServer(team.serverId);
    const jql = req.query.jql || team.jql || `project = ${team.projectKey} ORDER BY status ASC, updated DESC`;
    const epicFields = EPIC_LINK_FIELDS.join(",");
    const fieldsStr = `summary,status,assignee,priority,updated,created,duedate,description,issuetype,labels,comment,${epicFields},parent,timetracking,flagged,issuelinks`;

    const data = await jiraSearchAllFrom(server, jql, fieldsStr);

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
        labels: issue.fields.labels || [],
        created: issue.fields.created,
        updated: issue.fields.updated,
        dueDate: issue.fields.duedate || null,
        epicKey: getEpicKey(issue.fields),
        parentKey: issue.fields.parent?.key || null,
        originalEstimate: issue.fields.timetracking?.originalEstimate || null,
        commentCount: issue.fields.comment?.total || 0,
        daysSinceUpdate: daysSince(issue.fields.updated),
        lastComment: lastComment
          ? { author: lastComment.author?.displayName, body: lastComment.body?.substring(0, 300), date: lastComment.updated || lastComment.created }
          : null,
        linkedIssues: (issue.fields.issuelinks || []).map((link) => ({
          type: link.type?.name,
          direction: link.inwardIssue ? "inward" : "outward",
          key: link.inwardIssue?.key || link.outwardIssue?.key,
          summary: link.inwardIssue?.fields?.summary || link.outwardIssue?.fields?.summary,
          status: link.inwardIssue?.fields?.status?.name || link.outwardIssue?.fields?.status?.name,
        })),
      };
      mapped.urgencyFlags = computeUrgency(mapped);
      return mapped;
    });

    res.json({
      team,
      server: { id: server.id, name: server.name, url: server.url },
      total: data.total,
      issues,
    });
  } catch (err) {
    console.error("Error fetching team data:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// Cross-team follow-up tracker: find all linked issues across team boundaries
app.get("/pi/follow-ups", async (req, res) => {
  try {
    const epicFields = EPIC_LINK_FIELDS.join(",");
    const fieldsStr = `summary,status,assignee,priority,updated,created,duedate,issuetype,labels,issuelinks`;

    const allFollowUps = [];
    for (const team of TEAMS) {
      const server = getServer(team.serverId);
      // Use per-team JQL if configured, else project-based
      const baseJql = team.jql || `project = ${team.projectKey} ORDER BY priority DESC, updated DESC`;
      const fallbackJql = baseJql;

      let data;
      try {
        data = await jiraSearchAllFrom(server, fallbackJql, fieldsStr);
      } catch {
        data = { issues: [] };
      }

      for (const issue of data.issues) {
        const links = (issue.fields.issuelinks || []);
        const externalLinks = links.filter((link) => {
          const linkedKey = link.inwardIssue?.key || link.outwardIssue?.key || "";
          const linkedProject = linkedKey.split("-")[0];
          return linkedProject && linkedProject !== team.projectKey;
        });

        if (externalLinks.length > 0) {
          allFollowUps.push({
            key: issue.key,
            summary: issue.fields.summary,
            status: issue.fields.status?.name,
            statusCategory: issue.fields.status?.statusCategory?.key,
            assigneeName: issue.fields.assignee?.displayName || null,
            priority: issue.fields.priority?.name,
            issueType: issue.fields.issuetype?.name,
            dueDate: issue.fields.duedate,
            teamId: team.id,
            teamName: team.name,
            serverUrl: getBrowserUrl(server),
            externalLinks: externalLinks.map((link) => ({
              type: link.type?.name,
              direction: link.inwardIssue ? "inward" : "outward",
              key: link.inwardIssue?.key || link.outwardIssue?.key,
              summary: link.inwardIssue?.fields?.summary || link.outwardIssue?.fields?.summary,
              status: link.inwardIssue?.fields?.status?.name || link.outwardIssue?.fields?.status?.name,
            })),
          });
        }
      }
    }

    res.json({
      followUps: allFollowUps,
      total: allFollowUps.length,
    });
  } catch (err) {
    console.error("Error fetching follow-ups:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── Program Board: parent project with high-level Features ──
// Maps program-level Features to team-level implementations via Jira issue links.
// The program board holds the "what" (Features/Capabilities), teams hold the "how" (Stories/Tasks).

app.get("/pi/program-board", async (req, res) => {
  try {
    const projectKey = req.query.project || PROGRAM_PROJECT;
    if (!projectKey) {
      return res.json({
        configured: false,
        message: "No program board project configured. Set PROGRAM_PROJECT in .env or configure via Settings.",
        features: [],
        stats: {},
        warnings: [],
      });
    }

    const serverId = req.query.serverId || PROGRAM_SERVER_ID;
    const server = getServer(serverId);
    const epicFields = EPIC_LINK_FIELDS.join(",");
    const fieldsStr = `summary,status,assignee,priority,updated,created,duedate,description,issuetype,labels,comment,${epicFields},parent,timetracking,flagged,issuelinks`;

    // Apply PI date filter if configured and enabled
    const piStart = PI_CONFIG.enabled !== false ? PI_CONFIG.startDate : "";
    const piEnd = PI_CONFIG.enabled !== false ? PI_CONFIG.endDate : "";
    const filterMode = req.query.filter || (piStart && piEnd ? "pi" : "all");

    let jql;
    if (filterMode === "pi" && piStart && piEnd) {
      jql = `project = ${projectKey} AND (created >= "${piStart}" OR updated >= "${piStart}" OR statusCategory != Done) ORDER BY priority DESC, status ASC, updated DESC`;
    } else {
      jql = `project = ${projectKey} ORDER BY priority DESC, status ASC, updated DESC`;
    }
    const data = await jiraSearchAllFrom(server, jql, fieldsStr);
    const now = Date.now();

    // Map all program issues
    const allIssues = data.issues.map((issue) => {
      const mapped = {
        key: issue.key,
        summary: issue.fields.summary,
        description: (issue.fields.description || "").substring(0, 500),
        status: issue.fields.status?.name,
        statusCategory: issue.fields.status?.statusCategory?.key,
        assigneeName: issue.fields.assignee?.displayName || null,
        priority: issue.fields.priority?.name,
        issueType: issue.fields.issuetype?.name,
        labels: issue.fields.labels || [],
        created: issue.fields.created,
        updated: issue.fields.updated,
        dueDate: issue.fields.duedate || null,
        epicKey: getEpicKey(issue.fields),
        parentKey: issue.fields.parent?.key || null,
        commentCount: issue.fields.comment?.total || 0,
        daysSinceUpdate: daysSince(issue.fields.updated),
        linkedIssues: (issue.fields.issuelinks || []).map((link) => ({
          type: link.type?.name,
          direction: link.inwardIssue ? "inward" : "outward",
          key: link.inwardIssue?.key || link.outwardIssue?.key,
          summary: link.inwardIssue?.fields?.summary || link.outwardIssue?.fields?.summary,
          status: link.inwardIssue?.fields?.status?.name || link.outwardIssue?.fields?.status?.name,
          statusCategory: link.inwardIssue?.fields?.status?.statusCategory?.key || link.outwardIssue?.fields?.status?.statusCategory?.key,
          issueType: link.inwardIssue?.fields?.issuetype?.name || link.outwardIssue?.fields?.issuetype?.name,
        })),
      };
      mapped.urgencyFlags = computeUrgency(mapped);
      return mapped;
    });

    // Separate epics (Features) and their children
    const epics = {};
    const nonEpics = [];
    for (const issue of allIssues) {
      if (issue.issueType === "Epic") {
        epics[issue.key] = { ...issue, children: [] };
      } else {
        nonEpics.push(issue);
      }
    }
    for (const issue of nonEpics) {
      if (issue.epicKey && epics[issue.epicKey]) {
        epics[issue.epicKey].children.push(issue);
      }
    }

    // For each feature (epic or top-level story), find team implementations via issue links
    const features = [];
    const featureSources = Object.values(epics).length > 0
      ? Object.values(epics)
      : allIssues.filter((i) => !i.parentKey && !i.epicKey); // fallback: top-level issues

    for (const feature of featureSources) {
      // Collect all linked issues from this feature AND its children
      const allLinked = [...(feature.linkedIssues || [])];
      for (const child of feature.children || []) {
        for (const link of child.linkedIssues || []) {
          allLinked.push({ ...link, fromChild: child.key });
        }
      }

      // Group linked issues by team project
      const teamImplementations = {};
      for (const link of allLinked) {
        if (!link.key) continue;
        const linkedProject = link.key.split("-")[0];
        // Skip links back to the same program project
        if (linkedProject === projectKey) continue;

        // Find which team owns this project
        const team = TEAMS.find((t) => t.projectKey === linkedProject);
        const teamId = team?.id || linkedProject.toLowerCase();
        const teamName = team?.name || linkedProject;
        const teamColor = team?.color || "#6B7280";

        if (!teamImplementations[teamId]) {
          teamImplementations[teamId] = {
            teamId,
            teamName,
            teamColor,
            projectKey: linkedProject,
            issues: [],
          };
        }
        teamImplementations[teamId].issues.push({
          key: link.key,
          summary: link.summary,
          status: link.status,
          statusCategory: link.statusCategory,
          issueType: link.issueType,
          linkType: link.type,
          direction: link.direction,
          fromChild: link.fromChild || null,
        });
      }

      // Compute progress across all team implementations
      const allTeamIssues = Object.values(teamImplementations).flatMap((t) => t.issues);
      const implTotal = allTeamIssues.length;
      const implDone = allTeamIssues.filter((i) => i.statusCategory === "done").length;
      const implInProgress = allTeamIssues.filter((i) => i.statusCategory === "indeterminate").length;

      // Also count children progress within the program board itself
      const childTotal = (feature.children || []).length;
      const childDone = (feature.children || []).filter((c) => c.statusCategory === "done").length;

      features.push({
        key: feature.key,
        summary: feature.summary,
        description: feature.description,
        status: feature.status,
        statusCategory: feature.statusCategory,
        priority: feature.priority,
        assigneeName: feature.assigneeName,
        dueDate: feature.dueDate,
        labels: feature.labels,
        childCount: childTotal,
        childDone,
        teamImplementations: Object.values(teamImplementations),
        implementationStats: {
          total: implTotal,
          done: implDone,
          inProgress: implInProgress,
          todo: implTotal - implDone - implInProgress,
          progress: implTotal > 0 ? Math.round((implDone / implTotal) * 100) : 0,
        },
        // Overall progress: combine program children + team implementations
        overallProgress: (() => {
          const total = childTotal + implTotal;
          const done = childDone + implDone;
          return total > 0 ? Math.round((done / total) * 100) : 0;
        })(),
        warnings: [],
      });
    }

    // Add warnings per feature
    for (const feature of features) {
      if (feature.teamImplementations.length === 0 && feature.statusCategory !== "done") {
        feature.warnings.push({
          severity: "warning",
          message: `Feature "${feature.summary}" has no linked team implementations. Teams may not be aware of this requirement.`,
        });
      }
      if (feature.dueDate && new Date(feature.dueDate).getTime() < now && feature.statusCategory !== "done") {
        feature.warnings.push({
          severity: "critical",
          message: `Feature "${feature.summary}" is overdue (due ${feature.dueDate}).`,
        });
      }
      if (feature.implementationStats.total > 0 && feature.implementationStats.progress < 25 && feature.statusCategory !== "new") {
        feature.warnings.push({
          severity: "warning",
          message: `Feature "${feature.summary}" is ${feature.status} but team implementations are only ${feature.implementationStats.progress}% done.`,
        });
      }
    }

    // Aggregate stats
    const totalFeatures = features.length;
    const featuresWithTeams = features.filter((f) => f.teamImplementations.length > 0).length;
    const featuresOrphaned = totalFeatures - featuresWithTeams;
    const avgProgress = features.length > 0
      ? Math.round(features.reduce((sum, f) => sum + f.overallProgress, 0) / features.length)
      : 0;
    const featuresDone = features.filter((f) => f.statusCategory === "done").length;

    // Team coverage: which teams are implementing features
    const teamCoverage = {};
    for (const feature of features) {
      for (const impl of feature.teamImplementations) {
        if (!teamCoverage[impl.teamId]) {
          teamCoverage[impl.teamId] = { teamId: impl.teamId, teamName: impl.teamName, teamColor: impl.teamColor, featureCount: 0, issueCount: 0, doneCount: 0 };
        }
        teamCoverage[impl.teamId].featureCount++;
        teamCoverage[impl.teamId].issueCount += impl.issues.length;
        teamCoverage[impl.teamId].doneCount += impl.issues.filter((i) => i.statusCategory === "done").length;
      }
    }

    // Program-level warnings
    const warnings = [];
    if (featuresOrphaned > 0) {
      warnings.push({
        severity: featuresOrphaned > totalFeatures * 0.3 ? "critical" : "warning",
        title: `${featuresOrphaned} feature(s) without team implementations`,
        detail: "These features have no linked issues in team boards. Teams may not know about these requirements. Link team stories/tasks to program features.",
        category: "traceability",
      });
    }

    const teamsWithNoFeatures = TEAMS.filter((t) => !teamCoverage[t.id] && t.projectKey !== projectKey);
    if (teamsWithNoFeatures.length > 0) {
      warnings.push({
        severity: "warning",
        title: `${teamsWithNoFeatures.length} team(s) with no linked program features`,
        detail: `Teams not linked to any program feature: ${teamsWithNoFeatures.map((t) => t.name).join(", ")}. Ensure all teams have traceability back to program objectives.`,
        category: "coverage",
      });
    }

    const overdueFeatures = features.filter((f) => f.dueDate && new Date(f.dueDate).getTime() < now && f.statusCategory !== "done");
    if (overdueFeatures.length > 0) {
      warnings.push({
        severity: "critical",
        title: `${overdueFeatures.length} overdue program feature(s)`,
        detail: overdueFeatures.map((f) => `${f.key}: ${f.summary}`).join("; "),
        category: "delivery",
      });
    }

    res.json({
      configured: true,
      projectKey,
      serverUrl: getBrowserUrl(server),
      features,
      stats: {
        totalFeatures,
        featuresDone,
        featuresWithTeams,
        featuresOrphaned,
        avgProgress,
        totalTeamIssues: Object.values(teamCoverage).reduce((sum, t) => sum + t.issueCount, 0),
      },
      teamCoverage: Object.values(teamCoverage),
      warnings,
    });
  } catch (err) {
    console.error("Error fetching program board:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
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

// ─── Compliance: PI Planning Cross-Project Health ─────────
app.get("/compliance/pi", async (req, res) => {
  try {
    const FIELDS = "summary,status,issuetype,priority,assignee,created,updated,duedate,description,issuelinks," +
      (EPIC_LINK_FIELDS.join(",") || "customfield_10014") + ",labels,components";
    const NOW = Date.now();
    const DAY = 86400000;
    const checks = [];

    // Gather all team data
    const teamDataMap = {};
    let allIssues = [];
    let allCrossTeamDeps = [];

    await Promise.all(TEAMS.map(async (team) => {
      const server = getServer(team.serverId);
      const userJql = req.query.jql;
      let baseJql = team.jql || `project = ${team.projectKey}`;
      const jql = userJql ? `(${baseJql}) AND (${stripOrderBy(userJql)}) ORDER BY status ASC, updated DESC` : `${baseJql} ORDER BY status ASC, updated DESC`;
      try {
        const data = await jiraSearchAllFrom(server, jql, FIELDS);
        teamDataMap[team.id] = { team, server, issues: data.issues };
        allIssues = allIssues.concat(data.issues);

        // Detect cross-team deps
        data.issues.forEach((issue) => {
          (issue.fields.issuelinks || []).forEach((link) => {
            const linked = link.outwardIssue || link.inwardIssue;
            if (!linked) return;
            const linkedProject = linked.key.split("-")[0];
            if (linkedProject !== team.projectKey) {
              allCrossTeamDeps.push({
                fromTeam: team.id,
                fromKey: issue.key,
                toKey: linked.key,
                toProject: linkedProject,
                linkType: link.type?.name || "relates",
              });
            }
          });
        });
      } catch {
        teamDataMap[team.id] = { team, server, issues: [] };
      }
    }));

    // Fetch program board data if configured
    let programFeatures = [];
    let programServer = null;
    if (PROGRAM_PROJECT) {
      programServer = getServer(PROGRAM_SERVER_ID);
      try {
        const progData = await jiraSearchAllFrom(programServer,
          `project = ${PROGRAM_PROJECT} ORDER BY priority DESC`, FIELDS + ",issuelinks");
        programFeatures = progData.issues;
      } catch {}
    }

    // ── CHECK 1: Program Feature Traceability (15 pts)
    if (PROGRAM_PROJECT && programFeatures.length > 0) {
      const featuresWithLinks = programFeatures.filter((f) => {
        const links = f.fields.issuelinks || [];
        return links.some((l) => {
          const linked = l.outwardIssue || l.inwardIssue;
          if (!linked) return false;
          const proj = linked.key.split("-")[0];
          return proj !== PROGRAM_PROJECT;
        });
      });
      const tracePct = Math.round((featuresWithLinks.length / programFeatures.length) * 100);
      const traceScore = Math.round((tracePct / 100) * 15);
      const orphanFeatures = programFeatures.filter((f) => !featuresWithLinks.includes(f)).slice(0, 5);
      checks.push({
        id: "feature-traceability", name: "Program Feature → Team Traceability", score: traceScore, maxScore: 15,
        status: traceScore >= 12 ? "pass" : traceScore >= 8 ? "warning" : "fail",
        description: `${tracePct}% of program features (${featuresWithLinks.length}/${programFeatures.length}) are linked to team implementations. Every program feature MUST have at least one team story/task linked. Orphaned features mean teams may not know about requirements.`,
        detail: `${programFeatures.length - featuresWithLinks.length} features have no team links.`,
        action: orphanFeatures.length > 0 ? { label: "Link features to teams", keys: orphanFeatures.map((f) => f.key), serverUrl: getBrowserUrl(programServer) } : null,
      });
    } else {
      checks.push({
        id: "feature-traceability", name: "Program Feature → Team Traceability", score: 0, maxScore: 15,
        status: PROGRAM_PROJECT ? "fail" : "warning",
        description: PROGRAM_PROJECT
          ? "No program features found. Create Features/Epics in the program project to track high-level requirements that flow down to team boards."
          : "Program Board not configured. Set PROGRAM_PROJECT to enable feature-to-team traceability tracking. This is critical for SAFe PI planning.",
        detail: PROGRAM_PROJECT ? "0 features in program project." : "PROGRAM_PROJECT not set.",
        action: null,
      });
    }

    // ── CHECK 2: Cross-Team Dependency Coverage (15 pts)
    const uniqueDeps = new Map();
    allCrossTeamDeps.forEach((d) => {
      const key = [d.fromKey, d.toKey].sort().join(":");
      if (!uniqueDeps.has(key)) uniqueDeps.set(key, d);
    });
    const depCount = uniqueDeps.size;
    const teamsWithDeps = new Set(allCrossTeamDeps.map((d) => d.fromTeam));
    // Good if deps exist AND are documented (linked)
    const depDocScore = TEAMS.length > 1
      ? (depCount > 0 ? Math.min(15, Math.round((depCount / (TEAMS.length * 2)) * 15)) : 5)
      : 15;
    checks.push({
      id: "dependency-tracking", name: "Cross-Team Dependency Tracking", score: depDocScore, maxScore: 15,
      status: depDocScore >= 12 ? "pass" : depDocScore >= 8 ? "warning" : "fail",
      description: `${depCount} cross-team dependencies tracked across ${teamsWithDeps.size} teams. Dependencies are the #1 cause of PI delivery failure. Every inter-team handoff must be an explicit Jira issue link so it appears on the dependency board.`,
      detail: `${depCount} unique cross-team links found. ${TEAMS.length - teamsWithDeps.size} team(s) have zero tracked dependencies.`,
      action: null,
    });

    // ── CHECK 3: Bidirectional Dependency Risk (10 pts)
    const depPairs = {};
    allCrossTeamDeps.forEach((d) => {
      const k1 = `${d.fromKey}:${d.toKey}`;
      const k2 = `${d.toKey}:${d.fromKey}`;
      if (depPairs[k2]) depPairs[k2].bidir = true;
      else depPairs[k1] = { ...d, bidir: false };
    });
    const bidirCount = Object.values(depPairs).filter((d) => d.bidir).length;
    const bidirScore = bidirCount === 0 ? 10 : bidirCount <= 2 ? 6 : bidirCount <= 5 ? 3 : 0;
    checks.push({
      id: "bidirectional-deps", name: "No Circular Dependencies", score: bidirScore, maxScore: 10,
      status: bidirScore >= 8 ? "pass" : bidirScore >= 5 ? "warning" : "fail",
      description: `${bidirCount} bidirectional (circular) dependencies found. Circular dependencies create deadlocks where neither team can progress. Resolve by: breaking the cycle, introducing a shared service, or sequencing the work.`,
      detail: bidirCount > 0 ? `${bidirCount} ticket pairs block each other in both directions.` : "No circular dependencies detected.",
      action: null,
    });

    // ── CHECK 4: Team Workload Balance (10 pts)
    const teamSizes = TEAMS.map((t) => teamDataMap[t.id]?.issues.length || 0);
    const avgSize = teamSizes.reduce((a, b) => a + b, 0) / Math.max(teamSizes.length, 1);
    const maxDeviation = avgSize > 0 ? Math.max(...teamSizes.map((s) => Math.abs(s - avgSize) / avgSize)) : 0;
    const balanceScore = maxDeviation <= 0.3 ? 10 : maxDeviation <= 0.5 ? 7 : maxDeviation <= 0.8 ? 4 : 1;
    const overloaded = TEAMS.filter((t) => (teamDataMap[t.id]?.issues.length || 0) > avgSize * 1.5).map((t) => t.name);
    const underloaded = TEAMS.filter((t) => (teamDataMap[t.id]?.issues.length || 0) < avgSize * 0.5 && (teamDataMap[t.id]?.issues.length || 0) > 0).map((t) => t.name);
    checks.push({
      id: "workload-balance", name: "Team Workload Balance", score: balanceScore, maxScore: 10,
      status: balanceScore >= 8 ? "pass" : balanceScore >= 5 ? "warning" : "fail",
      description: `Team workload deviation: ${Math.round(maxDeviation * 100)}%. Balanced teams deliver more predictably. If one team is overloaded, redistribute scope or add capacity. Review in PI planning.`,
      detail: TEAMS.map((t) => `${t.name}: ${teamDataMap[t.id]?.issues.length || 0} issues`).join(", ") +
        (overloaded.length > 0 ? ` | Overloaded: ${overloaded.join(", ")}` : "") +
        (underloaded.length > 0 ? ` | Underloaded: ${underloaded.join(", ")}` : ""),
      action: null,
    });

    // ── CHECK 5: Cross-Team Stale Items (10 pts)
    const staleThreshold = 14 * DAY;
    const allNotDone = allIssues.filter((i) => i.fields.status?.statusCategory?.key !== "done");
    const allStale = allNotDone.filter((i) => (NOW - new Date(i.fields.updated).getTime()) > staleThreshold);
    const stalePct = allNotDone.length > 0 ? Math.round(((allNotDone.length - allStale.length) / allNotDone.length) * 100) : 100;
    const piStaleScore = Math.round(stalePct / 10);
    checks.push({
      id: "pi-stale-tickets", name: "PI Backlog Freshness", score: piStaleScore, maxScore: 10,
      status: piStaleScore >= 8 ? "pass" : piStaleScore >= 5 ? "warning" : "fail",
      description: `${allStale.length} tickets across all teams haven't been updated in 14+ days (${100 - stalePct}% stale). During a PI, every active item should show regular updates. Stale items signal blocked work, lost context, or abandoned scope.`,
      detail: `${allStale.length}/${allNotDone.length} active tickets are stale across ${TEAMS.length} teams.`,
      action: null,
    });

    // ── CHECK 6: Description Quality Across PI (10 pts)
    const allEstimable = allNotDone.filter((i) => ["Story", "Task", "Bug"].includes(i.fields.issuetype?.name));
    const allWithDesc = allEstimable.filter((i) => i.fields.description && i.fields.description.length >= 30);
    const piDescPct = allEstimable.length > 0 ? Math.round((allWithDesc.length / allEstimable.length) * 100) : 100;
    const piDescScore = Math.round(piDescPct / 10);
    checks.push({
      id: "pi-descriptions", name: "PI-Wide Story Quality", score: piDescScore, maxScore: 10,
      status: piDescScore >= 8 ? "pass" : piDescScore >= 5 ? "warning" : "fail",
      description: `${piDescPct}% of stories across all teams have meaningful descriptions. During PI planning, every committed story must be well-defined. Vague stories lead to misunderstandings and rework across teams.`,
      detail: `${allWithDesc.length}/${allEstimable.length} stories/tasks have descriptions ≥30 chars.`,
      action: null,
    });

    // ── CHECK 7: PI Progress On Track (10 pts)
    const piDone = allIssues.filter((i) => i.fields.status?.statusCategory?.key === "done").length;
    const piTotal = allIssues.length;
    const piProgress = piTotal > 0 ? Math.round((piDone / piTotal) * 100) : 0;
    // Check against elapsed time in PI
    let expectedProgress = 50; // default midpoint
    if (PI_CONFIG.enabled !== false && PI_CONFIG.startDate && PI_CONFIG.endDate) {
      const piStart = new Date(PI_CONFIG.startDate).getTime();
      const piEnd = new Date(PI_CONFIG.endDate).getTime();
      const piDuration = piEnd - piStart;
      const elapsed = Math.max(0, Math.min(NOW - piStart, piDuration));
      expectedProgress = piDuration > 0 ? Math.round((elapsed / piDuration) * 100) : 50;
    }
    const progressDelta = piProgress - expectedProgress;
    const onTrackScore = progressDelta >= -5 ? 10 : progressDelta >= -15 ? 7 : progressDelta >= -30 ? 4 : 1;
    checks.push({
      id: "pi-on-track", name: "PI Delivery On Track", score: onTrackScore, maxScore: 10,
      status: onTrackScore >= 8 ? "pass" : onTrackScore >= 5 ? "warning" : "fail",
      description: `PI is ${piProgress}% done vs ${expectedProgress}% expected (${progressDelta >= 0 ? "+" : ""}${progressDelta}%). Compare actual completion against time elapsed to detect if the PI is falling behind. Adjust scope or add capacity early.`,
      detail: `${piDone}/${piTotal} issues done. PI elapsed: ~${expectedProgress}%. Delta: ${progressDelta >= 0 ? "+" : ""}${progressDelta}%.`,
      action: null,
    });

    // ── CHECK 8: Consistent Team Velocity (10 pts) — all teams showing throughput
    const teamsWithDone = TEAMS.filter((t) => {
      const issues = teamDataMap[t.id]?.issues || [];
      return issues.some((i) => i.fields.status?.statusCategory?.key === "done");
    });
    const velocityPct = TEAMS.length > 0 ? Math.round((teamsWithDone.length / TEAMS.length) * 100) : 100;
    const velocityScore = Math.round(velocityPct / 10);
    const zeroVelocityTeams = TEAMS.filter((t) => {
      const issues = teamDataMap[t.id]?.issues || [];
      return !issues.some((i) => i.fields.status?.statusCategory?.key === "done");
    }).map((t) => t.name);
    checks.push({
      id: "team-velocity", name: "All Teams Delivering", score: velocityScore, maxScore: 10,
      status: velocityScore >= 8 ? "pass" : velocityScore >= 5 ? "warning" : "fail",
      description: `${teamsWithDone.length}/${TEAMS.length} teams have completed at least one ticket. Every team should show delivery progress during a PI. Zero throughput indicates blockers, misalignment, or capacity issues.`,
      detail: zeroVelocityTeams.length > 0 ? `Teams with zero completed: ${zeroVelocityTeams.join(", ")}` : "All teams are delivering.",
      action: null,
    });

    // ── CHECK 9: PI Config Completeness (5 pts)
    const piConfigChecks = [PI_CONFIG.name, PI_CONFIG.startDate, PI_CONFIG.endDate, PI_CONFIG.sprintCount > 0, PI_CONFIG.sprintDuration > 0];
    const piConfigDone = piConfigChecks.filter(Boolean).length;
    const piConfigScore = Math.round((piConfigDone / piConfigChecks.length) * 5);
    checks.push({
      id: "pi-config", name: "PI Configuration Complete", score: piConfigScore, maxScore: 5,
      status: piConfigScore >= 4 ? "pass" : piConfigScore >= 2 ? "warning" : "fail",
      description: `${piConfigDone}/${piConfigChecks.length} PI config fields set. A fully configured PI (name, dates, sprint count, duration) enables time-based tracking, burndown charts, and progress forecasting. Complete the PI config in Settings.`,
      detail: `Name: ${PI_CONFIG.name || "❌"}, Start: ${PI_CONFIG.startDate || "❌"}, End: ${PI_CONFIG.endDate || "❌"}, Sprints: ${PI_CONFIG.sprintCount || "❌"}, Duration: ${PI_CONFIG.sprintDuration || "❌"}`,
      action: null,
    });

    // ── CHECK 10: Team JQL Customization (5 pts) — teams with custom JQL
    const teamsWithJql = TEAMS.filter((t) => t.jql && t.jql.trim().length > 0);
    const jqlPct = TEAMS.length > 0 ? Math.round((teamsWithJql.length / TEAMS.length) * 100) : 100;
    const jqlScore = jqlPct >= 50 ? 5 : jqlPct > 0 ? 3 : 1;
    checks.push({
      id: "team-jql", name: "Per-Team JQL Filters", score: jqlScore, maxScore: 5,
      status: jqlScore >= 4 ? "pass" : jqlScore >= 2 ? "warning" : "fail",
      description: `${teamsWithJql.length}/${TEAMS.length} teams have custom JQL queries. Custom JQL lets each team scope their PI view precisely (e.g., by sprint, label, or component). Without it, teams see all project issues without filtering.`,
      detail: teamsWithJql.map((t) => t.name).join(", ") || "No teams have custom JQL.",
      action: null,
    });

    // ── CHECK 11: PI Architecture Health (10 pts) — cross-team issue definition quality
    const acRegexPi = /acceptance\s*criteria|given\s.*when\s.*then|\bAC[:\s]|definition\s*of\s*done|\[x\]|\[ \]/i;
    let piArchTotal = 0, piArchScore = 0;
    const poorTeams = [];
    for (const team of TEAMS) {
      const issues = teamDataMap[team.id]?.issues || [];
      const notDoneT = issues.filter((i) => i.fields.status?.statusCategory?.key !== "done");
      if (notDoneT.length === 0) continue;
      const epics = notDoneT.filter((i) => i.fields.issuetype?.name === "Epic");
      const storiesTasks = notDoneT.filter((i) => ["Story", "Task", "Bug"].includes(i.fields.issuetype?.name));
      let teamCriteria = 0, teamMet = 0;
      // Epics: desc ≥50 + AC + due date
      for (const e of epics) {
        teamCriteria += 3;
        if (e.fields.description && e.fields.description.length >= 50) teamMet++;
        if (e.fields.description && acRegexPi.test(e.fields.description)) teamMet++;
        if (e.fields.duedate) teamMet++;
      }
      // Stories/Tasks: desc + AC + estimate + assignee
      for (const s of storiesTasks) {
        teamCriteria += 4;
        if (s.fields.description && s.fields.description.length >= 30) teamMet++;
        if (s.fields.description && acRegexPi.test(s.fields.description)) teamMet++;
        if (s.fields.timetracking?.originalEstimate || s.fields.timetracking?.remainingEstimate || s.fields.customfield_10016) teamMet++;
        if (s.fields.assignee) teamMet++;
      }
      piArchTotal += teamCriteria;
      piArchScore += teamMet;
      if (teamCriteria > 0) {
        const teamPct = Math.round((teamMet / teamCriteria) * 100);
        if (teamPct < 50) poorTeams.push(`${team.name} (${teamPct}%)`);
      }
    }
    const piArchPct = piArchTotal > 0 ? Math.round((piArchScore / piArchTotal) * 100) : 100;
    const piArchFinal = Math.round(piArchPct / 10);
    checks.push({
      id: "pi-architecture", name: "PI Architecture Health", score: piArchFinal, maxScore: 10,
      status: piArchFinal >= 8 ? "pass" : piArchFinal >= 5 ? "warning" : "fail",
      description: `${piArchPct}% of issue definition criteria met across all teams. Measures whether epics have scope (description + AC + due date) and stories are dev-ready (description + AC + estimate + assignee). Low scores mean teams are working from poorly defined tickets.`,
      detail: poorTeams.length > 0 ? `Teams below 50%: ${poorTeams.join(", ")}` : "All teams meet minimum definition quality.",
      action: null,
    });

    // ── CHECK 12: Hierarchy Depth Coverage (10 pts) — proper epic→story→subtask hierarchy
    let totalHierarchyItems = 0, wellStructured = 0;
    const flatTeams = [];
    for (const team of TEAMS) {
      const issues = teamDataMap[team.id]?.issues || [];
      const notDoneT = issues.filter((i) => i.fields.status?.statusCategory?.key !== "done");
      if (notDoneT.length === 0) continue;
      const hasEpics = notDoneT.some((i) => i.fields.issuetype?.name === "Epic");
      const hasStories = notDoneT.some((i) => ["Story", "Task"].includes(i.fields.issuetype?.name));
      const hasSubs = notDoneT.some((i) => {
        const tn = (i.fields.issuetype?.name || "").toLowerCase();
        return tn === "sub-task" || tn === "subtask" || i.fields.issuetype?.subtask === true;
      });
      totalHierarchyItems++;
      const depth = (hasEpics ? 1 : 0) + (hasStories ? 1 : 0) + (hasSubs ? 1 : 0);
      if (depth >= 2) wellStructured++;
      else flatTeams.push(team.name);
    }
    const hierPct = totalHierarchyItems > 0 ? Math.round((wellStructured / totalHierarchyItems) * 100) : 100;
    const hierScore = Math.round(hierPct / 10);
    checks.push({
      id: "pi-hierarchy", name: "Hierarchy Depth Coverage", score: hierScore, maxScore: 10,
      status: hierScore >= 8 ? "pass" : hierScore >= 5 ? "warning" : "fail",
      description: `${wellStructured}/${totalHierarchyItems} teams use at least 2 hierarchy levels (epic→story→subtask). Flat backlogs (only stories, no epics or subtasks) make it hard to plan, estimate, and track progress at multiple levels. Use epics for goals, stories for features, subtasks for work items.`,
      detail: flatTeams.length > 0 ? `Flat teams: ${flatTeams.join(", ")}` : "All teams use proper hierarchy.",
      action: null,
    });

    // ── CHECK 13: Overdue & At-Risk Items (10 pts) — PI-wide deadline health
    let piOverdue = 0, piDueSoon = 0, piDated = 0;
    for (const team of TEAMS) {
      const issues = teamDataMap[team.id]?.issues || [];
      const nd = issues.filter((i) => i.fields.status?.statusCategory?.key !== "done");
      for (const i of nd) {
        if (!i.fields.duedate) continue;
        piDated++;
        const daysLeft = Math.floor((new Date(i.fields.duedate).getTime() - NOW) / (86400000));
        if (daysLeft < 0) piOverdue++;
        else if (daysLeft <= 3) piDueSoon++;
      }
    }
    const piAtRisk = piOverdue + piDueSoon;
    const piAtRiskPct = piDated > 0 ? Math.round((piAtRisk / piDated) * 100) : 0;
    const piDeadlineScore = piAtRiskPct <= 10 ? 10 : piAtRiskPct <= 20 ? 8 : piAtRiskPct <= 35 ? 5 : piAtRiskPct <= 50 ? 3 : 1;
    checks.push({
      id: "pi-deadlines", name: "PI Deadline Health", score: piDeadlineScore, maxScore: 10,
      status: piDeadlineScore >= 8 ? "pass" : piDeadlineScore >= 5 ? "warning" : "fail",
      description: `${piAtRisk} tickets are overdue or due within 3 days across all teams (${piAtRiskPct}% of ${piDated} dated items). Cluster overdue items signal systemic estimation or capacity issues, not just individual delays.`,
      detail: `${piOverdue} overdue + ${piDueSoon} due in ≤3 days across ${TEAMS.length} teams.`,
      action: null,
    });

    // ── CHECK 14: Dependency Risk (10 pts) — blocked cross-team items
    let blockedCrossTeam = 0, totalCrossTeamLinked = 0;
    const teamProjectKeys = new Set(TEAMS.map((t) => t.projectKey));
    for (const team of TEAMS) {
      const issues = teamDataMap[team.id]?.issues || [];
      const nd = issues.filter((i) => i.fields.status?.statusCategory?.key !== "done");
      for (const i of nd) {
        const links = i.fields.issuelinks || [];
        const hasCrossTeamDep = links.some((l) => {
          const linked = l.inwardIssue || l.outwardIssue;
          if (!linked) return false;
          const linkedProject = linked.key?.split("-")[0];
          return linkedProject && linkedProject !== team.projectKey && teamProjectKeys.has(linkedProject);
        });
        if (hasCrossTeamDep) {
          totalCrossTeamLinked++;
          const isBlocked = i.fields.status?.statusCategory?.key === "new" ||
            (i.fields.labels || []).some((l) => l.toLowerCase().includes("block"));
          if (isBlocked) blockedCrossTeam++;
        }
      }
    }
    const depRiskPct = totalCrossTeamLinked > 0 ? Math.round((blockedCrossTeam / totalCrossTeamLinked) * 100) : 0;
    const depRiskScore = depRiskPct <= 5 ? 10 : depRiskPct <= 15 ? 8 : depRiskPct <= 30 ? 5 : depRiskPct <= 50 ? 3 : 1;
    checks.push({
      id: "dependency-risk", name: "Dependency Risk", score: depRiskScore, maxScore: 10,
      status: depRiskScore >= 8 ? "pass" : depRiskScore >= 5 ? "warning" : "fail",
      description: `${blockedCrossTeam}/${totalCrossTeamLinked} cross-team linked items are blocked or not started (${depRiskPct}%). Blocked dependencies cascade across teams — one team's delay becomes another team's blocker. Escalate and unblock.`,
      detail: `${totalCrossTeamLinked} cross-team items, ${blockedCrossTeam} blocked/not started.`,
      action: null,
    });

    // Filter out disabled checks
    const activeChecks = checks.filter((c) => !DISABLED_PI_CHECKS.includes(c.id));
    const totalScore = activeChecks.reduce((s, c) => s + c.score, 0);
    const maxPossible = activeChecks.reduce((s, c) => s + c.maxScore, 0);
    const overallPct = maxPossible > 0 ? Math.round((totalScore / maxPossible) * 100) : 100;

    res.json({
      score: overallPct,
      totalScore,
      maxPossible,
      checks: activeChecks,
      disabledChecks: DISABLED_PI_CHECKS,
      allCheckIds: checks.map((c) => ({ id: c.id, name: c.name })),
      piConfig: PI_CONFIG,
      teamCount: TEAMS.length,
      totalIssues: allIssues.length,
      crossTeamDeps: depCount,
    });
  } catch (err) {
    console.error("Error in compliance/pi:", err.message);
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
    const jql = req.query.jql || `project = ${JIRA_PROJECT_KEY} AND statusCategory = Done ORDER BY resolutiondate DESC`;
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

    res.json({
      throughput: weeklyThroughput,
      avgThroughput: weeklyThroughput.length > 0 ? Math.round(weeklyThroughput.reduce((s, w) => s + w.completed, 0) / weeklyThroughput.length) : 0,
      wipItems,
      wipCount: wipItems.length,
      avgWipAge,
      statusDistribution: statusDist,
      totalIssues: data.issues.length,
    });
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
    const team = TEAMS[0];
    const server = getServer(team?.serverId);
    let boardId = team?.boardId;

    if (!boardId) {
      const boards = await jiraFetchAgileFrom(server, `/board?projectKeyOrId=${team?.projectKey || JIRA_PROJECT_KEY}&maxResults=1`);
      boardId = boards.values?.[0]?.id;
      if (!boardId) return res.json({ sprint: null, message: "No board found" });
    }

    // Get active sprint
    const sprintData = await jiraFetchAgileFrom(server, `/board/${boardId}/sprint?state=active&maxResults=1`);
    const activeSprint = sprintData.values?.[0];
    if (!activeSprint) return res.json({ sprint: null, message: "No active sprint" });

    // Get sprint issues
    const userJql = req.query.jql;
    const jql = userJql ? `sprint = ${activeSprint.id} AND (${stripOrderBy(userJql)}) ORDER BY status DESC, priority ASC` : `sprint = ${activeSprint.id} ORDER BY status DESC, priority ASC`;
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

    res.json({
      sprint: {
        id: activeSprint.id, name: activeSprint.name,
        goal: activeSprint.goal || "",
        startDate: activeSprint.startDate, endDate: activeSprint.endDate,
      },
      stats: { total: issues.length, done, inProgress, todo, completionRate: issues.length > 0 ? Math.round((done / issues.length) * 100) : 0 },
      epicGroups: Object.values(epicGroups).sort((a, b) => b.total - a.total),
      issues,
    });
  } catch (err) {
    console.error("Error fetching sprint review:", err.message);
    res.status(500).json(errorResponse(req, err));
  }
});

// ─── Definition of Ready Gate ────────────────────────────

app.get("/dor", async (req, res) => {
  try {
    const jql = req.query.jql || `project = ${JIRA_PROJECT_KEY} AND statusCategory != Done ORDER BY priority ASC, created DESC`;
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

// ─── ROAM Risk Board (in-memory store) ───────────────────

let roamRisks = {};

app.get("/roam/risks", (req, res) => {
  const risks = Object.values(roamRisks)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(risks);
});

app.post("/roam/risks", (req, res) => {
  const { id, title, description, category, owner, linkedIssues, severity } = req.body;
  if (!title || !category) return res.status(400).json({ error: "Missing title or category" });

  const riskId = id || `risk-${Date.now()}`;
  const existing = roamRisks[riskId];
  roamRisks[riskId] = {
    id: riskId,
    title,
    description: description || "",
    category, // "resolved" | "owned" | "accepted" | "mitigated"
    owner: owner || "",
    linkedIssues: linkedIssues || [],
    severity: severity || "medium", // "low" | "medium" | "high" | "critical"
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  res.json(roamRisks[riskId]);
});

app.delete("/roam/risks/:id", (req, res) => {
  delete roamRisks[req.params.id];
  res.json({ ok: true });
});

// ─── Team Health Check (in-memory store) ─────────────────

let healthChecks = {};

app.get("/health-check/sessions", (req, res) => {
  const sessions = Object.values(healthChecks)
    .map(({ id, title, createdAt, responses }) => ({
      id, title, createdAt, responseCount: responses.length,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(sessions);
});

app.post("/health-check/sessions", (req, res) => {
  const id = `hc-${Date.now()}`;
  const session = {
    id,
    title: req.body.title || `Health Check ${new Date().toISOString().split("T")[0]}`,
    createdAt: new Date().toISOString(),
    categories: [
      { id: "mission", label: "Mission & Purpose", emoji: "🎯" },
      { id: "speed", label: "Delivery Speed", emoji: "🚀" },
      { id: "quality", label: "Code Quality", emoji: "✨" },
      { id: "fun", label: "Fun & Teamwork", emoji: "🎉" },
      { id: "learning", label: "Learning & Growth", emoji: "📚" },
      { id: "support", label: "Support & Tools", emoji: "🛠️" },
      { id: "communication", label: "Communication", emoji: "💬" },
      { id: "autonomy", label: "Autonomy", emoji: "🗽" },
    ],
    responses: [],
  };
  healthChecks[id] = session;
  res.json(session);
});

app.get("/health-check/sessions/:id", (req, res) => {
  const session = healthChecks[req.params.id];
  if (!session) return res.status(404).json({ error: "Session not found" });

  // Aggregate scores
  const aggregated = {};
  for (const cat of session.categories) {
    const catResponses = session.responses.filter(r => r.categoryId === cat.id);
    const scores = catResponses.map(r => r.score);
    aggregated[cat.id] = {
      ...cat,
      avg: scores.length > 0 ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10 : 0,
      count: scores.length,
      distribution: { green: scores.filter(s => s >= 4).length, yellow: scores.filter(s => s === 3).length, red: scores.filter(s => s <= 2).length },
    };
  }

  res.json({ ...session, aggregated });
});

app.post("/health-check/sessions/:id/vote", (req, res) => {
  const session = healthChecks[req.params.id];
  if (!session) return res.status(404).json({ error: "Session not found" });

  const { voter, categoryId, score, comment } = req.body;
  if (!categoryId || score == null) return res.status(400).json({ error: "Missing categoryId or score" });

  session.responses.push({
    id: `vote-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    voter: voter || "Anonymous",
    categoryId,
    score: Math.min(5, Math.max(1, parseInt(score))),
    comment: comment || "",
    createdAt: new Date().toISOString(),
  });
  res.json({ ok: true });
});

app.delete("/health-check/sessions/:id", (req, res) => {
  delete healthChecks[req.params.id];
  res.json({ ok: true });
});

// ─── Sprint Goals Tracker (in-memory store) ──────────────

let sprintGoals = {};

app.get("/sprint-goals", (req, res) => {
  const goals = Object.values(sprintGoals)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(goals);
});

app.post("/sprint-goals", (req, res) => {
  const { id, sprintName, goals } = req.body;
  if (!sprintName || !goals || !Array.isArray(goals)) {
    return res.status(400).json({ error: "Missing sprintName or goals array" });
  }

  const goalId = id || `sg-${Date.now()}`;
  const existing = sprintGoals[goalId];
  sprintGoals[goalId] = {
    id: goalId,
    sprintName,
    goals: goals.map((g, i) => ({
      id: g.id || `g-${Date.now()}-${i}`,
      text: g.text,
      status: g.status || "not_started", // "not_started" | "in_progress" | "achieved" | "missed"
      linkedIssues: g.linkedIssues || [],
      notes: g.notes || "",
    })),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  res.json(sprintGoals[goalId]);
});

app.delete("/sprint-goals/:id", (req, res) => {
  delete sprintGoals[req.params.id];
  res.json({ ok: true });
});

// ─── AI Coach Endpoint ───────────────────────────────────

app.post("/ai/coach", async (req, res) => {
  try {
    const { context, question, data } = req.body;
    if (!context || !question) {
      return res.status(400).json({ error: "Missing context or question" });
    }

    // Build the prompt and return it — no external AI provider call
    const prompt = `You are an experienced Agile Coach and Scrum Master. You help teams improve their agile practices, identify process issues, and suggest actionable improvements.

CONTEXT: ${context}

DATA:
${JSON.stringify(data || {}, null, 2).substring(0, 8000)}

USER QUESTION: ${question}

Provide a helpful, actionable response. Be specific and reference the data when possible. Keep your response concise but thorough. Use bullet points for recommendations. If suggesting process changes, explain the "why" behind each suggestion.`;

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
        const edge = {
          from: link.outwardIssue ? issue.key : target.key,
          to: link.outwardIssue ? target.key : issue.key,
          type: link.type?.name,
          direction: link.outwardIssue ? link.type?.outward : link.type?.inward,
          fromProject: link.outwardIssue ? project : targetProject,
          toProject: link.outwardIssue ? targetProject : project,
          isCrossProject: project !== targetProject,
          targetStatus: target.fields?.status?.name,
          targetStatusCategory: target.fields?.status?.statusCategory?.key,
          targetSummary: target.fields?.summary,
          targetPriority: target.fields?.priority?.name,
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

    // Project-to-project matrix
    const projectMatrix = {};
    for (const edge of crossProjectEdges) {
      const pairKey = [edge.fromProject, edge.toProject].sort().join(" <-> ");
      if (!projectMatrix[pairKey]) projectMatrix[pairKey] = { pair: pairKey, projects: [edge.fromProject, edge.toProject].sort(), count: 0, blocking: 0, edges: [] };
      projectMatrix[pairKey].count++;
      if (edge.direction?.toLowerCase().includes("block")) projectMatrix[pairKey].blocking++;
      projectMatrix[pairKey].edges.push(edge);
    }

    // Critical path: issues that block the most other issues
    const blockCount = {};
    for (const edge of blockingEdges) {
      blockCount[edge.from] = (blockCount[edge.from] || 0) + 1;
    }
    const criticalBlockers = Object.entries(blockCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => ({ ...nodes[key], blocksCount: count }));

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
app.listen(PORT, async () => {
  console.log(`Dashboard API running on port ${PORT}`);
  console.log(`Config loaded from: ${configSource}`);
  console.log(`Jira: ${defaultServer().url}`);
  console.log(`Teams: ${TEAMS.map((t) => t.name).join(", ")}`);
  console.log(`Servers: ${JIRA_SERVERS.map((s) => s.name).join(", ")}`);
  await detectEpicFields();
});
