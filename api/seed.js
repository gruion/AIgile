/**
 * Jira Seed Script
 *
 * Populates a Jira instance with a realistic project, epics, and tickets
 * so the dashboard has data to display immediately.
 *
 * Usage:
 *   JIRA_BASE_URL=http://localhost:9080 JIRA_USERNAME=admin JIRA_API_TOKEN=xxx node seed.js
 *
 * Or via npm:
 *   npm run seed
 */

// Load ../.env file (no dotenv dependency needed)
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envFile = readFileSync(resolve(__dirname, "../.env"), "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {}

const JIRA_BASE_URL = process.env.JIRA_BASE_URL || "http://localhost:9080";
const JIRA_USERNAME = process.env.JIRA_USERNAME || "admin";
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN || "";
const PROJECT_KEY = process.env.JIRA_PROJECT_KEY || "TEAM";
const PROJECT_NAME = "Team Dashboard";

// ─── Helpers ─────────────────────────────────────────────

function auth() {
  return "Basic " + Buffer.from(`${JIRA_USERNAME}:${JIRA_API_TOKEN}`).toString("base64");
}

async function jiraPost(path, body) {
  const res = await fetch(`${JIRA_BASE_URL}/rest/api/2${path}`, {
    method: "POST",
    headers: { Authorization: auth(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function jiraPut(path, body) {
  const res = await fetch(`${JIRA_BASE_URL}/rest/api/2${path}`, {
    method: "PUT",
    headers: { Authorization: auth(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${path} → ${res.status}: ${text}`);
  }
  // PUT often returns 204 No Content
  if (res.status === 204) return {};
  return res.json();
}

async function jiraGet(path) {
  const res = await fetch(`${JIRA_BASE_URL}/rest/api/2${path}`, {
    headers: { Authorization: auth(), Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function addComment(issueKey, body) {
  return jiraPost(`/issue/${issueKey}/comment`, { body });
}

async function transitionIssue(issueKey, targetStatusName) {
  const { transitions } = await jiraGet(`/issue/${issueKey}/transitions`);
  const match = transitions.find(
    (t) => t.name.toLowerCase() === targetStatusName.toLowerCase()
  );
  if (!match) {
    console.warn(`  ⚠ No transition "${targetStatusName}" for ${issueKey}. Available: ${transitions.map((t) => t.name).join(", ")}`);
    return;
  }
  await jiraPost(`/issue/${issueKey}/transitions`, { transition: { id: match.id } });
}

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function log(msg) {
  console.log(`  ${msg}`);
}

// ─── Seed Data ───────────────────────────────────────────

const EPICS = [
  {
    summary: "User Authentication & Onboarding",
    description:
      "Complete auth flow including login, registration, password reset, 2FA, and new user onboarding wizard.",
    tickets: [
      {
        summary: "Implement email/password login endpoint",
        type: "Task",
        priority: "High",
        status: "Done",
        dueDate: daysFromNow(-10),
        labels: ["backend", "auth"],
        comments: [
          "Login endpoint implemented with bcrypt hashing and JWT tokens.",
          "Code review passed. Merged to main.",
        ],
      },
      {
        summary: "Build registration form with validation",
        type: "Task",
        priority: "High",
        status: "Done",
        dueDate: daysFromNow(-7),
        labels: ["frontend", "auth"],
        comments: [
          "Form built with Formik + Yup validation. Includes email, password strength meter.",
          "QA approved — all edge cases handled.",
        ],
      },
      {
        summary: "Add Google OAuth integration",
        type: "Task",
        priority: "Medium",
        status: "In Progress",
        dueDate: daysFromNow(2),
        labels: ["backend", "auth"],
        comments: [
          "Using passport-google-oauth20. Redirect flow working in dev.",
          "Need to get production OAuth credentials from DevOps — waiting on their response.",
        ],
      },
      {
        summary: "Implement password reset flow",
        type: "Task",
        priority: "Medium",
        status: "In Progress",
        dueDate: daysFromNow(5),
        labels: ["backend", "auth"],
        comments: ["Email template created. Token generation logic done. Need to wire up the reset page."],
      },
      {
        summary: "Two-factor authentication (2FA) with TOTP",
        type: "Task",
        priority: "Low",
        status: "To Do",
        dueDate: daysFromNow(20),
        labels: ["backend", "auth", "security"],
        comments: [],
      },
      {
        summary: "New user onboarding wizard",
        type: "Story",
        priority: "Medium",
        status: "To Do",
        dueDate: daysFromNow(15),
        labels: ["frontend", "ux"],
        comments: ["Design mockups available in Figma — link shared in #design channel."],
      },
    ],
  },
  {
    summary: "Payment & Billing System",
    description:
      "Stripe integration, subscription management, invoicing, and payment failure handling.",
    tickets: [
      {
        summary: "Integrate Stripe checkout for subscriptions",
        type: "Task",
        priority: "Highest",
        status: "In Progress",
        dueDate: daysFromNow(-2),
        labels: ["backend", "payments", "blocked"],
        comments: [
          "Checkout session creation works. Webhook handler partially done.",
          "BLOCKED: Stripe test API key expired. Waiting on finance team to renew.",
          "This is blocking the entire billing milestone — need to escalate.",
        ],
      },
      {
        summary: "Build subscription management UI",
        type: "Task",
        priority: "High",
        status: "To Do",
        dueDate: daysFromNow(7),
        labels: ["frontend", "payments"],
        comments: ["Depends on Stripe integration being completed first."],
      },
      {
        summary: "Implement webhook handler for payment events",
        type: "Task",
        priority: "Highest",
        status: "In Progress",
        dueDate: daysFromNow(1),
        labels: ["backend", "payments"],
        comments: [
          "Handling checkout.session.completed and invoice.payment_failed events.",
          "Need to add idempotency keys to prevent duplicate processing.",
        ],
      },
      {
        summary: "PDF invoice generation",
        type: "Task",
        priority: "Medium",
        status: "To Do",
        dueDate: daysFromNow(14),
        labels: ["backend", "payments"],
        comments: [],
      },
      {
        summary: "Payment failure retry logic and dunning emails",
        type: "Task",
        priority: "High",
        status: "To Do",
        dueDate: daysFromNow(10),
        labels: ["backend", "payments"],
        comments: ["Stripe handles retries but we need custom dunning emails. See RFC-042."],
      },
      {
        summary: "Add usage-based billing metering",
        type: "Story",
        priority: "Low",
        status: "To Do",
        dueDate: daysFromNow(30),
        labels: ["backend", "payments"],
        comments: [],
      },
    ],
  },
  {
    summary: "Dashboard & Analytics",
    description: "Build the main analytics dashboard with charts, metrics, and data export.",
    tickets: [
      {
        summary: "Design dashboard wireframes",
        type: "Task",
        priority: "High",
        status: "Done",
        dueDate: daysFromNow(-20),
        labels: ["design"],
        comments: [
          "Wireframes approved by product. Final mockups in Figma.",
          "Shared with frontend team for implementation.",
        ],
      },
      {
        summary: "Implement KPI summary cards",
        type: "Task",
        priority: "High",
        status: "Done",
        dueDate: daysFromNow(-5),
        labels: ["frontend", "dashboard"],
        comments: ["Cards show MRR, active users, churn rate, and NPS."],
      },
      {
        summary: "Build line chart component for revenue trends",
        type: "Task",
        priority: "Medium",
        status: "In Progress",
        dueDate: daysFromNow(3),
        labels: ["frontend", "dashboard"],
        comments: [
          "Using Recharts. Weekly and monthly views implemented.",
          "Need to add date range picker — currently hardcoded to last 30 days.",
        ],
      },
      {
        summary: "Create data export to CSV/Excel",
        type: "Task",
        priority: "Low",
        status: "To Do",
        dueDate: daysFromNow(18),
        labels: ["backend", "dashboard"],
        comments: [],
      },
      {
        summary: "Add real-time data refresh with WebSocket",
        type: "Task",
        priority: "Low",
        status: "To Do",
        dueDate: null,
        labels: ["backend", "frontend"],
        comments: ["Nice to have — not blocking launch. Revisit in Q3."],
      },
    ],
  },
  {
    summary: "API Performance & Infrastructure",
    description: "Optimize API response times, add caching, improve monitoring, and prepare for scale.",
    tickets: [
      {
        summary: "Add Redis caching layer for frequent queries",
        type: "Task",
        priority: "High",
        status: "Done",
        dueDate: daysFromNow(-14),
        labels: ["backend", "performance"],
        comments: [
          "Caching user profiles and dashboard data. TTL: 5min.",
          "Reduced p95 latency from 800ms to 120ms on dashboard endpoint.",
        ],
      },
      {
        summary: "Set up database connection pooling",
        type: "Task",
        priority: "High",
        status: "Done",
        dueDate: daysFromNow(-12),
        labels: ["backend", "infra"],
        comments: ["Using pgBouncer. Pool size: 20. Monitoring via Grafana."],
      },
      {
        summary: "Optimize N+1 queries in user listing API",
        type: "Bug",
        priority: "Highest",
        status: "In Progress",
        dueDate: daysFromNow(-5),
        labels: ["backend", "performance"],
        comments: [
          "Identified 3 N+1 patterns in /api/users endpoint. Each request was making 50+ DB queries.",
          "Fixed 2 of 3 with eager loading. Last one needs a schema change — discussing with DBA.",
          "This is causing timeouts for customers with 500+ team members.",
        ],
      },
      {
        summary: "Set up APM monitoring with Datadog",
        type: "Task",
        priority: "Medium",
        status: "To Do",
        dueDate: daysFromNow(7),
        labels: ["infra", "observability"],
        comments: ["Datadog account provisioned. Need to add dd-trace-js to the API."],
      },
      {
        summary: "Implement rate limiting on public endpoints",
        type: "Task",
        priority: "High",
        status: "To Do",
        dueDate: daysFromNow(5),
        labels: ["backend", "security"],
        comments: [],
      },
      {
        summary: "Migrate from Express to Fastify for throughput",
        type: "Story",
        priority: "Low",
        status: "To Do",
        dueDate: null,
        labels: ["backend", "tech-debt"],
        comments: ["Benchmarks show 2-3x improvement. Low priority until we actually hit limits."],
      },
    ],
  },
  {
    summary: "Mobile App v2",
    description:
      "Major mobile app update: redesigned navigation, offline mode, push notifications, and performance improvements.",
    tickets: [
      {
        summary: "Redesign bottom navigation bar",
        type: "Task",
        priority: "High",
        status: "Done",
        dueDate: daysFromNow(-8),
        labels: ["mobile", "design"],
        comments: ["New nav bar shipped in build 2.0.1-beta. Positive feedback from beta testers."],
      },
      {
        summary: "Implement offline data sync",
        type: "Story",
        priority: "Highest",
        status: "In Progress",
        dueDate: daysFromNow(4),
        labels: ["mobile", "offline"],
        comments: [
          "Using WatermelonDB for local storage. Sync logic 70% complete.",
          "Conflict resolution strategy: last-write-wins for now. Need product input on merge conflicts for shared resources.",
        ],
      },
      {
        summary: "Add push notification support (FCM + APNs)",
        type: "Task",
        priority: "High",
        status: "In Progress",
        dueDate: daysFromNow(6),
        labels: ["mobile", "notifications"],
        comments: [
          "FCM integration done for Android. APNs certificate generated.",
          "iOS push working in debug but not in TestFlight builds — investigating provisioning profile.",
        ],
      },
      {
        summary: "Reduce app startup time from 4s to under 2s",
        type: "Bug",
        priority: "High",
        status: "To Do",
        dueDate: daysFromNow(8),
        labels: ["mobile", "performance"],
        comments: [
          "Profiling shows 1.5s spent in synchronous storage reads on launch.",
          "Plan: move to lazy initialization + skeleton screens.",
        ],
      },
      {
        summary: "Dark mode support",
        type: "Task",
        priority: "Low",
        status: "To Do",
        dueDate: daysFromNow(25),
        labels: ["mobile", "design"],
        comments: [],
      },
      {
        summary: "Fix crash on Android 12 when opening camera",
        type: "Bug",
        priority: "Highest",
        status: "To Do",
        dueDate: daysFromNow(1),
        labels: ["mobile", "bug", "blocked"],
        comments: [
          "Crash report: java.lang.SecurityException — missing CAMERA permission post-Android 12.",
          "Affects ~15% of Android users. Needs hotfix ASAP.",
        ],
      },
    ],
  },
];

// Standalone tickets (no epic)
const STANDALONE_TICKETS = [
  {
    summary: "Update dependencies to fix npm audit vulnerabilities",
    type: "Task",
    priority: "Medium",
    status: "To Do",
    dueDate: daysFromNow(3),
    labels: ["maintenance", "security"],
    comments: ["12 moderate, 3 high vulnerabilities reported by npm audit."],
  },
  {
    summary: "Write API documentation for external partners",
    type: "Task",
    priority: "Medium",
    status: "In Progress",
    dueDate: daysFromNow(10),
    labels: ["docs"],
    comments: [
      "Using Swagger/OpenAPI 3.0. Auth and Users endpoints documented.",
      "Still need: Billing, Webhooks, and Analytics endpoints.",
    ],
  },
  {
    summary: "Fix timezone handling in scheduled reports",
    type: "Bug",
    priority: "High",
    status: "To Do",
    dueDate: daysFromNow(-3),
    labels: ["backend", "bug"],
    comments: [
      "Reports for APAC customers are sent at wrong time — using server TZ instead of user TZ.",
      "Customer complaint from Acme Corp — they're on our enterprise plan.",
    ],
  },
  {
    summary: "Refactor shared UI component library",
    type: "Task",
    priority: "Low",
    status: "To Do",
    dueDate: null,
    labels: ["frontend", "tech-debt"],
    comments: [],
  },
];

// ─── Main Seed Logic ─────────────────────────────────────

async function ensureProject() {
  try {
    const project = await jiraGet(`/project/${PROJECT_KEY}`);
    log(`Project ${PROJECT_KEY} already exists (id: ${project.id})`);
    return project;
  } catch {
    log(`Creating project "${PROJECT_NAME}" (${PROJECT_KEY})...`);

    // Get current user account to use as lead
    const myself = await jiraGet("/myself");

    const project = await jiraPost("/project", {
      key: PROJECT_KEY,
      name: PROJECT_NAME,
      projectTypeKey: "software",
      projectTemplateKey: "com.pyxis.greenhopper.jira:gh-scrum-template",
      lead: myself.name || myself.key,
    });
    log(`Project created (id: ${project.id})`);
    return project;
  }
}

async function getIssueTypes() {
  // Jira 9.x uses the v2 createmeta endpoint
  const meta = await jiraGet(`/issue/createmeta/${PROJECT_KEY}/issuetypes`);
  const types = {};
  for (const it of meta.values) {
    types[it.name] = it.id;
  }
  log(`Issue types: ${Object.entries(types).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  return types;
}

async function getPriorities() {
  const data = await jiraGet("/priority");
  const priorities = {};
  for (const p of data) {
    priorities[p.name] = p.id;
  }
  return priorities;
}

async function createIssue(fields) {
  const result = await jiraPost("/issue", { fields });
  return result;
}

async function seed() {
  console.log("\n=== Jira Seed Script ===\n");
  console.log(`Target: ${JIRA_BASE_URL}`);
  console.log(`Project: ${PROJECT_KEY}\n`);

  // 1. Ensure project exists
  await ensureProject();

  // 2. Get issue types and priorities
  const issueTypes = await getIssueTypes();
  const priorities = await getPriorities();

  const epicType = issueTypes["Epic"];
  const storyType = issueTypes["Story"];
  const taskType = issueTypes["Task"];
  const bugType = issueTypes["Bug"];

  const typeMap = {
    Epic: epicType,
    Story: storyType || taskType,
    Task: taskType,
    Bug: bugType || taskType,
  };

  // Detect epic fields — works for Jira 9.x and 10.x
  let epicNameField = null;
  let epicLinkField = null;
  let useParentField = false;

  // Method 1: createmeta (Jira 9.x+)
  try {
    const epicMeta = await jiraGet(`/issue/createmeta/${PROJECT_KEY}/issuetypes/${epicType}`);
    for (const field of epicMeta.values || []) {
      if (field.name === "Epic Name") epicNameField = field.fieldId;
      if (field.name === "Epic Link") epicLinkField = field.fieldId;
    }
  } catch {
    log("createmeta not available, trying /field endpoint");
  }

  // Method 2: /field endpoint (fallback)
  if (!epicNameField && !epicLinkField) {
    try {
      const allFields = await jiraGet("/field");
      const epicNameDef = allFields.find((f) => f.name === "Epic Name");
      const epicLinkDef = allFields.find(
        (f) => f.name === "Epic Link" || f.clauseNames?.includes("'Epic Link'")
      );
      if (epicNameDef) epicNameField = epicNameDef.id;
      if (epicLinkDef) epicLinkField = epicLinkDef.id;
    } catch {
      log("Could not detect epic fields from /field endpoint");
    }
  }

  // Jira 10.x: if no epic custom fields found, use parent field
  if (!epicNameField && !epicLinkField) {
    useParentField = true;
    log("No Epic Link/Name custom fields detected — using parent field (Jira 10.x mode)");
  } else {
    if (!epicNameField) epicNameField = "customfield_10011";
    if (!epicLinkField) epicLinkField = "customfield_10014";
    log(`Epic Name field: ${epicNameField}`);
    log(`Epic Link field: ${epicLinkField}`);
  }

  console.log("\n--- Creating Epics & Tickets ---\n");

  for (const epic of EPICS) {
    // Create epic
    log(`Creating epic: ${epic.summary}`);
    const epicFields = {
      project: { key: PROJECT_KEY },
      summary: epic.summary,
      description: epic.description,
      issuetype: { id: epicType },
    };
    // Jira 9.x requires Epic Name custom field; Jira 10.x doesn't
    if (epicNameField && !useParentField) {
      epicFields[epicNameField] = epic.summary;
    }

    let epicIssue;
    try {
      epicIssue = await createIssue(epicFields);
      log(`  ✓ ${epicIssue.key}`);
    } catch (err) {
      console.error(`  ✗ Failed to create epic: ${err.message}`);
      continue;
    }

    // Create child tickets
    for (const ticket of epic.tickets) {
      const issueTypeId = typeMap[ticket.type] || taskType;
      const priorityId = priorities[ticket.priority] || priorities["Medium"];

      const fields = {
        project: { key: PROJECT_KEY },
        summary: ticket.summary,
        issuetype: { id: issueTypeId },
        priority: { id: priorityId },
        labels: ticket.labels || [],
      };

      // Link to epic — try Epic Link field first, fall back to parent (Jira 10.x)
      if (!useParentField && epicLinkField) {
        fields[epicLinkField] = epicIssue.key;
      } else {
        fields.parent = { key: epicIssue.key };
      }

      let createdIssue;
      try {
        createdIssue = await createIssue(fields);
        log(`  ✓ ${createdIssue.key} — ${ticket.summary.substring(0, 50)}`);
      } catch (err) {
        // If epic link field doesn't work, try parent field (next-gen / Jira 10.x)
        if (!useParentField && epicLinkField) {
          try {
            delete fields[epicLinkField];
            fields.parent = { key: epicIssue.key };
            createdIssue = await createIssue(fields);
            log(`  ✓ ${createdIssue.key} — ${ticket.summary.substring(0, 50)} (via parent)`);
          } catch (err2) {
            console.error(`  ✗ Failed: ${err2.message.substring(0, 100)}`);
            continue;
          }
        } else {
          console.error(`  ✗ Failed: ${err.message.substring(0, 100)}`);
          continue;
        }
      }

      // Set due date via PUT (not available on create screen)
      if (ticket.dueDate) {
        try {
          await jiraPut(`/issue/${createdIssue.key}`, { fields: { duedate: ticket.dueDate } });
        } catch {}
      }

      // Add comments
      for (const comment of ticket.comments) {
        try {
          await addComment(createdIssue.key, comment);
        } catch {
          // Comments are non-critical, continue
        }
      }

      // Transition to target status
      if (ticket.status === "In Progress") {
        try {
          await transitionIssue(createdIssue.key, "In Progress");
        } catch {
          // Try alternative names
          try { await transitionIssue(createdIssue.key, "Start Progress"); } catch {}
        }
      } else if (ticket.status === "Done") {
        try {
          await transitionIssue(createdIssue.key, "In Progress");
        } catch {
          try { await transitionIssue(createdIssue.key, "Start Progress"); } catch {}
        }
        try {
          await transitionIssue(createdIssue.key, "Done");
        } catch {
          try { await transitionIssue(createdIssue.key, "Resolve Issue"); } catch {}
        }
      }
    }
  }

  // Standalone tickets
  console.log("\n--- Creating Standalone Tickets ---\n");

  for (const ticket of STANDALONE_TICKETS) {
    const issueTypeId = typeMap[ticket.type] || taskType;
    const priorityId = priorities[ticket.priority] || priorities["Medium"];

    const fields = {
      project: { key: PROJECT_KEY },
      summary: ticket.summary,
      issuetype: { id: issueTypeId },
      priority: { id: priorityId },
      labels: ticket.labels || [],
    };

    let createdIssue;
    try {
      createdIssue = await createIssue(fields);
      log(`✓ ${createdIssue.key} — ${ticket.summary.substring(0, 50)}`);
    } catch (err) {
      console.error(`✗ Failed: ${err.message.substring(0, 100)}`);
      continue;
    }

    if (ticket.dueDate) {
      try {
        await jiraPut(`/issue/${createdIssue.key}`, { fields: { duedate: ticket.dueDate } });
      } catch {}
    }

    for (const comment of ticket.comments) {
      try {
        await addComment(createdIssue.key, comment);
      } catch {}
    }

    if (ticket.status === "In Progress") {
      try { await transitionIssue(createdIssue.key, "In Progress"); } catch {
        try { await transitionIssue(createdIssue.key, "Start Progress"); } catch {}
      }
    } else if (ticket.status === "Done") {
      try { await transitionIssue(createdIssue.key, "In Progress"); } catch {
        try { await transitionIssue(createdIssue.key, "Start Progress"); } catch {}
      }
      try { await transitionIssue(createdIssue.key, "Done"); } catch {
        try { await transitionIssue(createdIssue.key, "Resolve Issue"); } catch {}
      }
    }
  }

  console.log("\n=== Seed Complete ===\n");

  // Print summary
  const totalTickets = EPICS.reduce((sum, e) => sum + e.tickets.length, 0) + STANDALONE_TICKETS.length;
  console.log(`Created:`);
  console.log(`  ${EPICS.length} epics`);
  console.log(`  ${totalTickets} tickets (${STANDALONE_TICKETS.length} standalone)`);
  console.log(`\nDashboard: http://localhost:3010`);
  console.log(`Jira:      ${JIRA_BASE_URL}/projects/${PROJECT_KEY}/board\n`);
}

seed().catch((err) => {
  console.error("\nSeed failed:", err.message);
  console.error("\nMake sure:");
  console.error("  1. Jira is running and setup is complete");
  console.error("  2. .env has correct JIRA_USERNAME and JIRA_API_TOKEN");
  console.error(`  3. You can access ${JIRA_BASE_URL} in your browser\n`);
  process.exit(1);
});
