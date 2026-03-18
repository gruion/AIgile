import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

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
const HASURA_GRAPHQL_URL = process.env.HASURA_GRAPHQL_URL || "http://localhost:9081/v1/graphql";
const HASURA_ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET || "";
const DEFAULT_JQL = process.env.JIRA_DEFAULT_JQL || `project = ${JIRA_PROJECT_KEY} ORDER BY status ASC, updated DESC`;

// Custom JQL template for finding epic children — use {EPIC_KEY} as placeholder
// Example: 'labels = "{EPIC_KEY}" ORDER BY status ASC'
let EPIC_CHILDREN_JQL_TEMPLATE = process.env.EPIC_CHILDREN_JQL_TEMPLATE || "";

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

// ─── Helpers ─────────────────────────────────────────────
const jiraHeaders = () => ({
  Authorization:
    "Basic " +
    Buffer.from(`${JIRA_USERNAME}:${JIRA_API_TOKEN}`).toString("base64"),
  "Content-Type": "application/json",
  Accept: "application/json",
});

async function jiraFetch(path) {
  const url = `${JIRA_BASE_URL}/rest/api/2${path}`;
  const res = await fetch(url, { headers: jiraHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API ${res.status}: ${text}`);
  }
  return res.json();
}

async function jiraFetchAgile(path) {
  const url = `${JIRA_BASE_URL}/rest/agile/1.0${path}`;
  const res = await fetch(url, { headers: jiraHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira Agile API ${res.status}: ${text}`);
  }
  return res.json();
}

// Paginated search — fetches ALL matching issues, not just one page
async function jiraSearchAll(jql, fieldsStr, pageSize = 100) {
  let startAt = 0;
  let allIssues = [];
  let total = 0;

  do {
    const data = await jiraFetch(
      `/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${pageSize}&fields=${fieldsStr}`
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

async function hasuraQuery(query, variables = {}) {
  const res = await fetch(HASURA_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": HASURA_ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
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

// Settings — runtime config for epic children JQL, etc.
app.get("/settings", (req, res) => {
  res.json({
    epicChildrenJqlTemplate: EPIC_CHILDREN_JQL_TEMPLATE,
    hasEpicLinkJql: HAS_EPIC_LINK_JQL,
    epicLinkFields: EPIC_LINK_FIELDS,
    defaultJql: DEFAULT_JQL,
  });
});

app.post("/settings", (req, res) => {
  const { epicChildrenJqlTemplate } = req.body;
  if (typeof epicChildrenJqlTemplate === "string") {
    EPIC_CHILDREN_JQL_TEMPLATE = epicChildrenJqlTemplate;
    console.log(`Epic children JQL template updated: ${EPIC_CHILDREN_JQL_TEMPLATE || "(auto-detect)"}`);
  }
  res.json({
    epicChildrenJqlTemplate: EPIC_CHILDREN_JQL_TEMPLATE,
    hasEpicLinkJql: HAS_EPIC_LINK_JQL,
  });
});

// Jira saved filters — favourite filters, board filters, and quick links
app.get("/filters", async (req, res) => {
  try {
    const results = { favourite: [], boards: [], recent: [] };

    // 1. User's favourite/starred filters
    try {
      const favFilters = await jiraFetch("/filter/favourite");
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
      const boardData = await jiraFetchAgile("/board?maxResults=50");
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
          const boardConfig = await jiraFetchAgile(`/board/${board.id}/configuration`);
          if (boardConfig.filter?.id) {
            const boardFilter = await jiraFetch(`/filter/${boardConfig.filter.id}`);
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
      const myFilters = await jiraFetch("/filter/search?maxResults=20&orderBy=IS_FAVOURITE&expand=jql");
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
        const props = await jiraFetchAgile(`/board/${board.id}/properties/GreenHopper.quickFilters`);
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
    res.status(500).json({ error: err.message });
  }
});

// Main endpoint: issues grouped by epic with urgency flags
app.get("/issues", async (req, res) => {
  try {
    const jql = req.query.jql || DEFAULT_JQL;

    const epicFields = EPIC_LINK_FIELDS.join(",");
    const fieldsStr = `summary,status,assignee,priority,updated,created,duedate,description,issuetype,labels,comment,${epicFields},parent,timetracking,flagged`;

    // Paginate to get ALL issues
    const data = await jiraSearchAll(jql, fieldsStr);

    const issues = data.issues.map((issue) => {
      const lastComment = issue.fields.comment?.comments?.slice(-1)[0];
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
    res.status(500).json({ error: err.message });
  }
});

app.get("/issues/:key", async (req, res) => {
  try {
    const data = await jiraFetch(`/issue/${req.params.key}`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
        `/issue/${epicKey}?fields=summary,status,assignee,priority,created,updated,duedate,description,labels,comment,issuetype`
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
    const data = await jiraSearchAll(jql, fieldsStr);

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
    res.status(500).json({ error: err.message });
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
    const jql = req.query.jql || DEFAULT_JQL;
    const epicFields = EPIC_LINK_FIELDS.join(",");
    const fieldsStr = `summary,status,assignee,priority,updated,created,duedate,description,issuetype,labels,comment,${epicFields},parent,timetracking,flagged`;

    const data = await jiraSearchAll(jql, fieldsStr);
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
    });
  } catch (err) {
    console.error("Error computing analytics:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── AI endpoints (called by n8n) ───────────────────────

let aiProvider = null;
async function getProvider() {
  if (!aiProvider) {
    const { getAIProvider } = await import("../ai-lib/index.js");
    aiProvider = getAIProvider();
  }
  return aiProvider;
}

app.post("/ai/summarize-ticket", async (req, res) => {
  try {
    const ticketData = req.body;
    if (!ticketData || !ticketData.key) {
      return res.status(400).json({ error: "Missing ticket data (need at least 'key')" });
    }
    const provider = await getProvider();
    const summary = await provider.summarizeTicket(ticketData);
    res.json({ issue_key: ticketData.key, ...summary });
  } catch (err) {
    console.error("Error summarizing ticket:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/ai/summarize-board", async (req, res) => {
  try {
    const { tickets, jql } = req.body;
    if (!tickets || !Array.isArray(tickets)) {
      return res.status(400).json({ error: "Missing 'tickets' array in body" });
    }
    const provider = await getProvider();
    const summary = await provider.summarizeBoard(tickets);
    res.json({ jql: jql || "unknown", total_issues: tickets.length, ...summary });
  } catch (err) {
    console.error("Error summarizing board:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Insights endpoints (called by frontend) ────────────

app.get("/insights/summaries", async (req, res) => {
  try {
    const data = await hasuraQuery(`
      query {
        ai_summaries(order_by: { generated_at: desc }) {
          issue_key
          jira_updated_at
          tldr
          status_insight
          action_needed
          risk_level
          risk_reason
          staleness_days
          generated_at
        }
      }
    `);
    res.json(data.ai_summaries || []);
  } catch (err) {
    console.error("Error fetching summaries:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/insights/board-summary", async (req, res) => {
  try {
    const data = await hasuraQuery(`
      query {
        ai_board_summaries(order_by: { generated_at: desc }, limit: 1) {
          jql_hash
          jql
          executive_summary
          blocked_tickets
          stale_tickets
          team_workload
          recommendations
          total_issues
          generated_at
        }
      }
    `);
    res.json(data.ai_board_summaries?.[0] || null);
  } catch (err) {
    console.error("Error fetching board summary:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`Dashboard API running on port ${PORT}`);
  console.log(`Jira: ${JIRA_BASE_URL}`);
  await detectEpicFields();
});
