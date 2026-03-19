/**
 * Multi-Project Seed Script for PI Planning
 *
 * Creates 6 team projects with realistic data including:
 * - Epics, Stories, Tasks, Sub-tasks, Bugs per project
 * - Cross-team issue links (dependencies)
 * - Varied statuses, priorities, assignees, labels
 * - Realistic comments and due dates
 *
 * Usage:
 *   node seed-multi.js
 *   npm run seed:multi
 */

import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

const JIRA_BASE_URL = process.env.JIRA_BASE_URL || "http://localhost:9080";
const JIRA_USERNAME = process.env.JIRA_USERNAME || "admin";
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN || "";

// ─── 6 Teams / Projects ─────────────────────────────────

const PROJECTS = [
  { key: "PROG", name: "Program Board", color: "#1E293B" },
  { key: "PLAT", name: "Platform Core", color: "#3B82F6" },
  { key: "FRONT", name: "Frontend Squad", color: "#10B981" },
  { key: "MOBILE", name: "Mobile Team", color: "#F59E0B" },
  { key: "DATA", name: "Data & Analytics", color: "#8B5CF6" },
  { key: "INFRA", name: "Infrastructure & DevOps", color: "#EF4444" },
  { key: "QA", name: "Quality & Release", color: "#EC4899" },
];

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
  if (res.status === 204) return {};
  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text);
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
  if (!match) return false;
  await jiraPost(`/issue/${issueKey}/transitions`, { transition: { id: match.id } });
  return true;
}

async function createIssueLink(inwardKey, outwardKey, linkTypeName) {
  try {
    await jiraPost("/issueLink", {
      type: { name: linkTypeName },
      inwardIssue: { key: inwardKey },
      outwardIssue: { key: outwardKey },
    });
    return true;
  } catch (err) {
    console.warn(`  ⚠ Failed to link ${inwardKey} → ${outwardKey}: ${err.message.substring(0, 80)}`);
    return false;
  }
}

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function log(msg) {
  console.log(`  ${msg}`);
}

// ─── Seed Data per Project ───────────────────────────────

const PROJECT_DATA = {
  // ─── PROGRAM BOARD: High-level Features & Capabilities ───
  // This is the parent board that instructs all teams. Each epic here is a "Feature"
  // that one or more teams must implement. Links to team issues are created after seeding.
  PROG: {
    epics: [
      {
        summary: "F1: Unified Authentication & Identity Platform",
        description: "Deliver a single authentication service supporting SSO, MFA, OAuth2, and federated identity across all products. All teams must integrate with the new auth service by end of PI.",
        tickets: [
          { summary: "Define auth service API contract and integration guide", type: "Task", priority: "Highest", status: "Done", dueDate: -12, labels: ["program", "auth", "architecture"], comments: ["Contract reviewed by all 6 teams. API guide published in Confluence.", "All teams have acknowledged the migration timeline."] },
          { summary: "Coordinate auth migration rollout across all teams", type: "Story", priority: "Highest", status: "In Progress", dueDate: 5, labels: ["program", "auth", "coordination"], comments: ["PLAT team leading. FRONT and MOBILE need to update their login flows.", "QA team preparing regression test suite for auth changes."] },
          { summary: "Enterprise SSO onboarding — 3 pilot customers", type: "Task", priority: "High", status: "To Do", dueDate: 21, labels: ["program", "auth", "enterprise"], comments: ["Pilot customers: Acme Corp, Globex, Initech. Need PLAT SSO + FRONT portal changes."] },
        ],
      },
      {
        summary: "F2: Real-Time Customer Analytics Platform",
        description: "Build end-to-end real-time analytics from data ingestion to customer-facing dashboards. Requires DATA pipeline, PLAT event streaming, and FRONT dashboard components.",
        tickets: [
          { summary: "Define event schema standards across all services", type: "Task", priority: "Highest", status: "Done", dueDate: -14, labels: ["program", "data", "architecture"], comments: ["Avro schema registry set up. 15 event types defined. All teams using the standard."] },
          { summary: "End-to-end latency target: events visible in dashboard within 60s", type: "Story", priority: "High", status: "In Progress", dueDate: 10, labels: ["program", "data", "performance"], comments: ["Current latency: ~3min. DATA team optimizing Flink jobs. FRONT team adding real-time WebSocket."] },
          { summary: "Customer-facing analytics dashboard MVP", type: "Story", priority: "High", status: "In Progress", dueDate: 12, labels: ["program", "data", "customer"], comments: ["FRONT team building UI. DATA team providing API. Target: DAU/WAU/MAU, retention, revenue metrics."] },
          { summary: "Data quality SLA: 99.5% completeness, <5min freshness", type: "Task", priority: "Medium", status: "To Do", dueDate: 18, labels: ["program", "data", "quality"], comments: [] },
        ],
      },
      {
        summary: "F3: Mobile Offline-First Experience",
        description: "Enable full offline mode for the mobile app with seamless sync. Requires MOBILE offline architecture, PLAT sync API, and DATA conflict resolution strategy.",
        tickets: [
          { summary: "Define sync protocol and conflict resolution strategy", type: "Task", priority: "Highest", status: "Done", dueDate: -10, labels: ["program", "mobile", "architecture"], comments: ["CRDTs for collaborative data, last-write-wins for simple fields. Protocol doc approved.", "MOBILE and PLAT teams aligned on implementation approach."] },
          { summary: "Offline mode user acceptance criteria", type: "Story", priority: "High", status: "In Progress", dueDate: 8, labels: ["program", "mobile", "ux"], comments: ["Must support: read all data offline, queue writes, auto-sync on reconnect, conflict UI.", "QA team writing acceptance test scenarios."] },
          { summary: "Offline mode beta release to 500 users", type: "Task", priority: "Medium", status: "To Do", dueDate: 25, labels: ["program", "mobile", "release"], comments: ["Beta cohort selected. MOBILE team targeting build 2.1.0-beta."] },
        ],
      },
      {
        summary: "F4: Platform Reliability & Observability",
        description: "Achieve 99.9% uptime SLA. Complete K8s migration, deploy observability stack, and establish SRE practices across all services.",
        tickets: [
          { summary: "Define SLOs and error budgets for all tier-1 services", type: "Task", priority: "Highest", status: "In Progress", dueDate: 3, labels: ["program", "infra", "sre"], comments: ["SLOs defined for auth, payments, and API gateway. Remaining: analytics, mobile-backend.", "INFRA team building Grafana dashboards. All teams must instrument their services."] },
          { summary: "Complete K8s migration for all services", type: "Story", priority: "Highest", status: "In Progress", dueDate: 10, labels: ["program", "infra", "migration"], comments: ["INFRA reports 5 of 8 services migrated. PLAT auth and MOBILE backend pending.", "Target: zero EC2 instances for application workloads by end of PI."] },
          { summary: "Distributed tracing across all services (OpenTelemetry)", type: "Task", priority: "High", status: "To Do", dueDate: 14, labels: ["program", "infra", "observability"], comments: ["INFRA deploying Tempo. All teams must add OTel instrumentation."] },
          { summary: "Incident response runbook and on-call rotation", type: "Task", priority: "Medium", status: "To Do", dueDate: 20, labels: ["program", "infra", "process"], comments: [] },
        ],
      },
      {
        summary: "F5: CI/CD & Quality Gate Standardization",
        description: "Standardize CI/CD pipelines, testing practices, and release gates across all teams. Single release train with automated quality checks.",
        tickets: [
          { summary: "Define CI/CD pipeline template for all teams", type: "Task", priority: "High", status: "Done", dueDate: -8, labels: ["program", "ci-cd", "process"], comments: ["GitHub Actions template with build, test, security scan, deploy stages.", "INFRA team created reusable workflow. QA team adding test gates."] },
          { summary: "Automated quality gates: tests, coverage, security scan", type: "Story", priority: "High", status: "In Progress", dueDate: 8, labels: ["program", "ci-cd", "quality"], comments: ["QA team building Pact contract tests + Playwright E2E. INFRA adding Trivy security scans.", "Target: no deployment without green quality gate."] },
          { summary: "Release train: bi-weekly coordinated releases", type: "Task", priority: "Medium", status: "To Do", dueDate: 14, labels: ["program", "release", "process"], comments: ["QA team defining release readiness checklist. All teams must align on sprint cadence."] },
        ],
      },
      {
        summary: "F6: Customer Portal v2",
        description: "Complete redesign of customer-facing portal with new dashboard, self-service tools, and accessibility compliance. Requires FRONT UI, PLAT APIs, and DATA analytics integration.",
        tickets: [
          { summary: "Portal accessibility audit and WCAG 2.1 AA compliance", type: "Task", priority: "Highest", status: "In Progress", dueDate: 5, labels: ["program", "frontend", "a11y"], comments: ["FRONT team audited 42 components. 18 critical issues found. Fix plan in progress.", "Legal requires WCAG AA compliance by end of Q2."] },
          { summary: "Customer self-service: account management, billing, support", type: "Story", priority: "High", status: "In Progress", dueDate: 10, labels: ["program", "frontend", "customer"], comments: ["FRONT team building UI. PLAT providing APIs. Reduces support ticket volume by ~40%."] },
          { summary: "Design system v3 adoption across all customer touchpoints", type: "Task", priority: "Medium", status: "To Do", dueDate: 18, labels: ["program", "frontend", "design"], comments: ["FRONT team owns design system. MOBILE team needs React Native component parity."] },
        ],
      },
    ],
    standalone: [
      { summary: "PI-2026-Q1 planning: capacity allocation across teams", type: "Task", priority: "Highest", status: "Done", dueDate: -20, labels: ["program", "planning"], comments: ["All teams committed capacity: 80% feature work, 20% buffer/innovation.", "Feature priorities ranked by business value and risk."] },
      { summary: "Mid-PI sync: review progress and re-plan if needed", type: "Task", priority: "High", status: "To Do", dueDate: 14, labels: ["program", "planning", "sync"], comments: ["Scheduled for sprint 3 boundary. All team leads required."] },
      { summary: "GDPR compliance audit — cross-team data inventory", type: "Task", priority: "Highest", status: "In Progress", dueDate: 7, labels: ["program", "compliance", "gdpr"], comments: ["Legal requirement. DATA team leading. All teams must document their data flows.", "PLAT and MOBILE teams have submitted. FRONT and INFRA pending."] },
      { summary: "Cross-team API versioning strategy alignment", type: "Task", priority: "Medium", status: "To Do", dueDate: 12, labels: ["program", "api", "architecture"], comments: ["PLAT team proposing URL-based versioning. Need consensus from all teams."] },
    ],
  },

  PLAT: {
    epics: [
      {
        summary: "Authentication Service v2",
        description: "Migrate auth to OAuth2 + OIDC. Support SSO, MFA, and federated identity across all services.",
        tickets: [
          { summary: "Design OAuth2 token flow architecture", type: "Story", priority: "Highest", status: "Done", dueDate: -15, labels: ["backend", "auth", "architecture"], comments: ["Architecture review completed. Using Authorization Code + PKCE flow.", "Approved by security team."] },
          { summary: "Implement JWT token service", type: "Task", priority: "High", status: "Done", dueDate: -10, labels: ["backend", "auth"], comments: ["JWT signing with RS256. Refresh token rotation enabled.", "Unit tests passing — 94% coverage."] },
          { summary: "Build OIDC provider integration", type: "Task", priority: "High", status: "In Progress", dueDate: 3, labels: ["backend", "auth"], comments: ["Google and Azure AD working in staging.", "Apple Sign-In pending — need iOS team (MOBILE) to provide bundle ID."] },
          { summary: "Migrate existing sessions to new auth", type: "Task", priority: "Highest", status: "In Progress", dueDate: -2, labels: ["backend", "auth", "migration"], comments: ["Migration script handles 80% of sessions. Edge cases with expired tokens need manual review.", "BLOCKED: Need DATA team to provide user activity data for session validation."] },
          { summary: "Add MFA with TOTP and SMS fallback", type: "Task", priority: "Medium", status: "To Do", dueDate: 14, labels: ["backend", "auth", "security"], comments: ["Twilio integration for SMS. Google Authenticator for TOTP."] },
          { summary: "SSO integration for enterprise clients", type: "Story", priority: "Medium", status: "To Do", dueDate: 21, labels: ["backend", "auth", "enterprise"], comments: ["SAML 2.0 required. Need to support Okta and OneLogin."] },
        ],
      },
      {
        summary: "API Gateway & Rate Limiting",
        description: "Central API gateway with rate limiting, request routing, and API key management.",
        tickets: [
          { summary: "Deploy Kong API gateway", type: "Task", priority: "High", status: "Done", dueDate: -20, labels: ["infra", "api"], comments: ["Kong deployed on K8s. Routing rules configured for 12 services."] },
          { summary: "Implement per-tenant rate limiting", type: "Task", priority: "High", status: "In Progress", dueDate: 5, labels: ["backend", "api"], comments: ["Redis-based sliding window. 1000 req/min for free tier, 10000 for enterprise.", "Need INFRA team to provision Redis cluster."] },
          { summary: "Build API key management dashboard", type: "Task", priority: "Medium", status: "To Do", dueDate: 12, labels: ["frontend", "api"], comments: ["FRONT team will handle the UI — need to provide the REST endpoints."] },
          { summary: "API versioning strategy implementation", type: "Story", priority: "Low", status: "To Do", dueDate: 25, labels: ["backend", "api", "architecture"], comments: [] },
        ],
      },
      {
        summary: "Event-Driven Architecture Migration",
        description: "Move from synchronous REST calls to event-driven messaging with Kafka for inter-service communication.",
        tickets: [
          { summary: "Set up Kafka cluster with 3 brokers", type: "Task", priority: "Highest", status: "Done", dueDate: -18, labels: ["infra", "messaging"], comments: ["3-node cluster running. Replication factor 3. Monitoring via Grafana."] },
          { summary: "Define event schemas and registry", type: "Task", priority: "High", status: "Done", dueDate: -12, labels: ["backend", "messaging", "architecture"], comments: ["Using Avro schemas with Confluent Schema Registry. 15 event types defined."] },
          { summary: "Migrate user-service events to Kafka", type: "Task", priority: "High", status: "In Progress", dueDate: 7, labels: ["backend", "messaging"], comments: ["User created/updated/deleted events publishing. Consumer lag < 100ms.", "DATA team needs to update their ETL pipeline to consume from Kafka instead of REST."] },
          { summary: "Migrate order-service events to Kafka", type: "Task", priority: "Medium", status: "To Do", dueDate: 15, labels: ["backend", "messaging"], comments: [] },
          { summary: "Dead letter queue and retry mechanism", type: "Task", priority: "High", status: "To Do", dueDate: 10, labels: ["backend", "messaging"], comments: ["Need to handle poison pills and transient failures."] },
        ],
      },
    ],
    standalone: [
      { summary: "Fix connection pool exhaustion under load", type: "Bug", priority: "Highest", status: "In Progress", dueDate: -1, labels: ["backend", "critical"], comments: ["Pool maxes out at 200 connections during peak. Need to investigate leak.", "Temporary fix: increased pool size to 500. Need permanent fix."] },
      { summary: "Document internal API contracts for all teams", type: "Task", priority: "Medium", status: "To Do", dueDate: 10, labels: ["docs"], comments: [] },
    ],
  },

  FRONT: {
    epics: [
      {
        summary: "Design System v3",
        description: "Major redesign of shared component library. Accessibility-first, dark mode, responsive tokens.",
        tickets: [
          { summary: "Audit existing components for a11y compliance", type: "Task", priority: "Highest", status: "Done", dueDate: -14, labels: ["frontend", "a11y"], comments: ["42 components audited. 18 have critical a11y issues.", "Report shared with QA team for regression test plan."] },
          { summary: "Create design tokens for light/dark themes", type: "Task", priority: "High", status: "Done", dueDate: -10, labels: ["frontend", "design"], comments: ["Tokens exported as CSS custom properties and JS constants."] },
          { summary: "Rebuild Button and Input components", type: "Task", priority: "High", status: "In Progress", dueDate: 2, labels: ["frontend", "components"], comments: ["Button done with 12 variants. Input 80% complete — date picker pending."] },
          { summary: "Build DataTable with virtual scrolling", type: "Story", priority: "High", status: "In Progress", dueDate: 8, labels: ["frontend", "components", "performance"], comments: ["Using TanStack Virtual. Handles 100k rows smoothly.", "Need PLAT team API pagination support for server-side filtering."] },
          { summary: "Create Storybook documentation site", type: "Task", priority: "Medium", status: "To Do", dueDate: 18, labels: ["frontend", "docs"], comments: [] },
          { summary: "Implement toast/notification system", type: "Task", priority: "Medium", status: "To Do", dueDate: 15, labels: ["frontend", "components"], comments: ["Must support action buttons and auto-dismiss."] },
        ],
      },
      {
        summary: "Customer Portal Redesign",
        description: "Complete overhaul of the customer-facing portal. New dashboard, onboarding flow, and self-service tools.",
        tickets: [
          { summary: "New customer dashboard with KPI widgets", type: "Story", priority: "Highest", status: "In Progress", dueDate: 5, labels: ["frontend", "customer"], comments: ["Widgets: usage chart, billing summary, support tickets, health score.", "DATA team providing the aggregation API."] },
          { summary: "Build self-service account settings page", type: "Task", priority: "High", status: "In Progress", dueDate: 4, labels: ["frontend", "customer"], comments: ["Profile, billing, team management, notifications. PLAT team auth v2 required for SSO settings."] },
          { summary: "Implement guided onboarding wizard", type: "Story", priority: "Medium", status: "To Do", dueDate: 12, labels: ["frontend", "customer", "ux"], comments: ["5-step wizard with progress tracking and skip option."] },
          { summary: "Add real-time support chat widget", type: "Task", priority: "Low", status: "To Do", dueDate: 20, labels: ["frontend", "customer", "support"], comments: [] },
        ],
      },
    ],
    standalone: [
      { summary: "Fix Safari CSS grid rendering bug", type: "Bug", priority: "High", status: "In Progress", dueDate: 1, labels: ["frontend", "bug", "browser"], comments: ["Grid items collapse on Safari 16.x. Workaround: explicit grid-template-rows."] },
      { summary: "Optimize bundle size — reduce from 2.1MB to under 1MB", type: "Task", priority: "Medium", status: "To Do", dueDate: 14, labels: ["frontend", "performance"], comments: ["Tree-shaking lodash and moment.js should save ~600KB."] },
      { summary: "Add E2E tests for critical user flows", type: "Task", priority: "High", status: "To Do", dueDate: 8, labels: ["frontend", "testing"], comments: ["QA team will help define test scenarios."] },
    ],
  },

  MOBILE: {
    epics: [
      {
        summary: "Offline-First Architecture",
        description: "Enable full offline mode with sync, conflict resolution, and background data refresh.",
        tickets: [
          { summary: "Implement local SQLite database layer", type: "Task", priority: "Highest", status: "Done", dueDate: -12, labels: ["mobile", "offline", "database"], comments: ["Using WatermelonDB. Schema mirrors server models. Migration framework in place."] },
          { summary: "Build sync engine with conflict resolution", type: "Story", priority: "Highest", status: "In Progress", dueDate: 3, labels: ["mobile", "offline", "sync"], comments: ["Last-write-wins for simple fields. CRDTs for collaborative data.", "Need PLAT team to expose sync timestamps on all API responses."] },
          { summary: "Add background sync with WorkManager/BGTask", type: "Task", priority: "High", status: "In Progress", dueDate: 7, labels: ["mobile", "offline"], comments: ["Android WorkManager configured. iOS BGAppRefreshTask pending."] },
          { summary: "Offline queue for user actions", type: "Task", priority: "High", status: "To Do", dueDate: 10, labels: ["mobile", "offline"], comments: ["Queue mutations when offline, replay on reconnect. Max queue size: 1000 ops."] },
          { summary: "Sync progress indicator and conflict UI", type: "Task", priority: "Medium", status: "To Do", dueDate: 14, labels: ["mobile", "offline", "ux"], comments: [] },
        ],
      },
      {
        summary: "Push Notifications v2",
        description: "Rich push notifications with deep linking, notification preferences, and silent pushes for data sync.",
        tickets: [
          { summary: "Migrate to Firebase Cloud Messaging v2 API", type: "Task", priority: "High", status: "Done", dueDate: -8, labels: ["mobile", "notifications"], comments: ["HTTP v1 API migration done. Legacy API deprecated June 2024."] },
          { summary: "Implement notification preferences screen", type: "Task", priority: "Medium", status: "In Progress", dueDate: 6, labels: ["mobile", "notifications", "ux"], comments: ["Per-category toggles: chat, updates, marketing, system."] },
          { summary: "Add deep linking from notifications", type: "Task", priority: "High", status: "To Do", dueDate: 8, labels: ["mobile", "notifications"], comments: ["FRONT team handles web deep links. We handle native URI schemes."] },
          { summary: "Silent push for background data refresh", type: "Task", priority: "Medium", status: "To Do", dueDate: 12, labels: ["mobile", "notifications", "sync"], comments: [] },
        ],
      },
      {
        summary: "Mobile Performance Optimization",
        description: "Reduce app size, improve startup time, optimize rendering performance.",
        tickets: [
          { summary: "Profile and fix startup time regression (4.2s → <2s)", type: "Bug", priority: "Highest", status: "In Progress", dueDate: -3, labels: ["mobile", "performance"], comments: ["Profiler shows 1.8s in synchronous storage reads. Moving to lazy init.", "Also found 800ms in unnecessary network call on launch."] },
          { summary: "Implement image lazy loading and caching", type: "Task", priority: "High", status: "Done", dueDate: -5, labels: ["mobile", "performance"], comments: ["FastImage with disk cache. LRU eviction at 200MB."] },
          { summary: "Reduce APK/IPA size from 85MB to under 50MB", type: "Task", priority: "Medium", status: "To Do", dueDate: 15, labels: ["mobile", "performance"], comments: ["ProGuard/R8 for Android. Bitcode stripping for iOS."] },
          { summary: "Fix memory leak in chat screen", type: "Bug", priority: "High", status: "To Do", dueDate: 5, labels: ["mobile", "bug", "performance"], comments: ["Memory grows 50MB over 30min of chat. Suspect image caching in FlatList."] },
        ],
      },
    ],
    standalone: [
      { summary: "Fix crash on Android 14 permission handling", type: "Bug", priority: "Highest", status: "In Progress", dueDate: 0, labels: ["mobile", "bug", "critical"], comments: ["SecurityException on photo picker. Affects 12% of Android users."] },
      { summary: "Update React Native to 0.73", type: "Task", priority: "Medium", status: "To Do", dueDate: 20, labels: ["mobile", "tech-debt"], comments: ["New architecture (Fabric) support. Breaking changes in native modules."] },
    ],
  },

  DATA: {
    epics: [
      {
        summary: "Real-Time Analytics Pipeline",
        description: "Build streaming analytics pipeline with Kafka, Flink, and ClickHouse for real-time dashboards.",
        tickets: [
          { summary: "Deploy ClickHouse cluster for analytics", type: "Task", priority: "Highest", status: "Done", dueDate: -16, labels: ["data", "infra"], comments: ["3-node cluster with ReplicatedMergeTree. Handles 500k inserts/sec.", "INFRA team helped with K8s deployment and monitoring."] },
          { summary: "Build Kafka → Flink → ClickHouse pipeline", type: "Story", priority: "Highest", status: "In Progress", dueDate: 5, labels: ["data", "pipeline", "streaming"], comments: ["Flink job processing user events. Tumbling window: 1min aggregation.", "Need PLAT team to add event timestamps to Kafka messages."] },
          { summary: "Create materialized views for dashboard KPIs", type: "Task", priority: "High", status: "In Progress", dueDate: 8, labels: ["data", "analytics"], comments: ["DAU, WAU, MAU, retention cohorts, revenue metrics. Pre-aggregated hourly."] },
          { summary: "Build real-time anomaly detection", type: "Story", priority: "Medium", status: "To Do", dueDate: 18, labels: ["data", "ml", "analytics"], comments: ["Z-score based for now. ML model later. Alert via Slack webhook."] },
          { summary: "Implement data quality monitoring", type: "Task", priority: "High", status: "To Do", dueDate: 10, labels: ["data", "quality"], comments: ["Track completeness, freshness, and schema drift. Alert on SLA breach."] },
        ],
      },
      {
        summary: "Customer 360 Data Platform",
        description: "Unified customer data model aggregating data from all services for personalization and insights.",
        tickets: [
          { summary: "Design unified customer data model", type: "Task", priority: "High", status: "Done", dueDate: -10, labels: ["data", "architecture"], comments: ["Schema covers profile, behavior, transactions, support. Reviewed by all teams."] },
          { summary: "Build ETL pipelines from all source systems", type: "Story", priority: "High", status: "In Progress", dueDate: 6, labels: ["data", "etl"], comments: ["Airflow DAGs for PLAT, FRONT, MOBILE data sources.", "Waiting on PLAT team to expose user-service events via Kafka."] },
          { summary: "Create customer segmentation engine", type: "Task", priority: "Medium", status: "To Do", dueDate: 15, labels: ["data", "ml", "segmentation"], comments: ["RFM scoring + behavioral clustering. Serve via API for FRONT portal."] },
          { summary: "Build data access API for other teams", type: "Task", priority: "High", status: "To Do", dueDate: 12, labels: ["data", "api"], comments: ["GraphQL API for customer insights. FRONT team needs it for the portal redesign."] },
        ],
      },
    ],
    standalone: [
      { summary: "Fix data drift in daily ETL pipeline", type: "Bug", priority: "High", status: "In Progress", dueDate: 2, labels: ["data", "bug", "etl"], comments: ["Timestamps off by 1 hour due to DST change. Affects revenue reports."] },
      { summary: "Migrate from Redshift to ClickHouse for cost savings", type: "Story", priority: "Medium", status: "To Do", dueDate: 30, labels: ["data", "migration"], comments: ["Estimated 60% cost reduction. Need to rewrite 23 Redshift SQL queries."] },
      { summary: "GDPR data deletion pipeline", type: "Task", priority: "Highest", status: "To Do", dueDate: 7, labels: ["data", "compliance", "gdpr"], comments: ["Legal requirement. Must propagate deletion across all data stores within 72h."] },
    ],
  },

  INFRA: {
    epics: [
      {
        summary: "Kubernetes Migration Phase 2",
        description: "Migrate remaining services from EC2 to EKS. Add autoscaling, service mesh, and observability.",
        tickets: [
          { summary: "Migrate 8 remaining services to EKS", type: "Story", priority: "Highest", status: "In Progress", dueDate: 7, labels: ["infra", "k8s", "migration"], comments: ["5 of 8 migrated. Payment service, auth service, and notification service pending.", "PLAT team needs to containerize auth service first."] },
          { summary: "Deploy Istio service mesh", type: "Task", priority: "High", status: "In Progress", dueDate: 10, labels: ["infra", "k8s", "networking"], comments: ["Istio 1.20 installed. mTLS enabled. Traffic policies for canary deployments."] },
          { summary: "Set up Horizontal Pod Autoscaler for all services", type: "Task", priority: "High", status: "Done", dueDate: -7, labels: ["infra", "k8s", "scaling"], comments: ["CPU-based scaling. Custom metrics (request rate) via KEDA for critical services."] },
          { summary: "Implement pod disruption budgets", type: "Task", priority: "Medium", status: "To Do", dueDate: 12, labels: ["infra", "k8s"], comments: [] },
          { summary: "Set up cluster autoscaler for cost optimization", type: "Task", priority: "Medium", status: "To Do", dueDate: 15, labels: ["infra", "k8s", "cost"], comments: ["Spot instances for non-critical workloads."] },
        ],
      },
      {
        summary: "Observability Stack",
        description: "Unified monitoring, logging, and tracing with Grafana, Loki, and Tempo.",
        tickets: [
          { summary: "Deploy Grafana + Prometheus + AlertManager", type: "Task", priority: "Highest", status: "Done", dueDate: -20, labels: ["infra", "monitoring"], comments: ["Stack deployed. 45 dashboards created. PagerDuty integration active."] },
          { summary: "Set up Loki for centralized logging", type: "Task", priority: "High", status: "Done", dueDate: -14, labels: ["infra", "logging"], comments: ["All services shipping logs via Promtail. Retention: 30 days."] },
          { summary: "Deploy Tempo for distributed tracing", type: "Task", priority: "High", status: "In Progress", dueDate: 5, labels: ["infra", "tracing"], comments: ["Tempo running. Need ALL teams to add OpenTelemetry instrumentation.", "PLAT team done. FRONT and MOBILE pending."] },
          { summary: "Create SLO dashboards and error budgets", type: "Task", priority: "Medium", status: "To Do", dueDate: 14, labels: ["infra", "monitoring", "sre"], comments: ["Target: 99.9% availability for tier-1 services."] },
          { summary: "Build automated runbooks for common incidents", type: "Task", priority: "Low", status: "To Do", dueDate: 25, labels: ["infra", "sre", "docs"], comments: [] },
        ],
      },
      {
        summary: "CI/CD Pipeline Modernization",
        description: "Migrate from Jenkins to GitHub Actions. Add preview environments and automated rollbacks.",
        tickets: [
          { summary: "Migrate CI from Jenkins to GitHub Actions", type: "Story", priority: "High", status: "In Progress", dueDate: 8, labels: ["infra", "ci-cd"], comments: ["15 of 22 pipelines migrated. Remaining: MOBILE (complex), DATA (Airflow), QA (test suites)."] },
          { summary: "Build preview environment per PR", type: "Task", priority: "Medium", status: "To Do", dueDate: 18, labels: ["infra", "ci-cd", "dx"], comments: ["Use Argo CD + ephemeral namespaces. Auto-cleanup after PR merge."] },
          { summary: "Implement automated rollback on failed health checks", type: "Task", priority: "High", status: "To Do", dueDate: 12, labels: ["infra", "ci-cd", "reliability"], comments: [] },
        ],
      },
    ],
    standalone: [
      { summary: "Rotate all production secrets and API keys", type: "Task", priority: "Highest", status: "To Do", dueDate: 3, labels: ["infra", "security", "urgent"], comments: ["Annual rotation policy. All teams need to update their service configs."] },
      { summary: "Reduce AWS bill — identify unused resources", type: "Task", priority: "Medium", status: "In Progress", dueDate: 10, labels: ["infra", "cost"], comments: ["Found $3.2k/month in unused EBS volumes and idle EC2 instances."] },
    ],
  },

  QA: {
    epics: [
      {
        summary: "Test Automation Framework",
        description: "Build comprehensive test automation covering unit, integration, E2E, and performance testing.",
        tickets: [
          { summary: "Set up Playwright for cross-browser E2E tests", type: "Task", priority: "Highest", status: "Done", dueDate: -10, labels: ["qa", "testing", "automation"], comments: ["Playwright configured for Chrome, Firefox, Safari. 120 test cases migrated from Cypress."] },
          { summary: "Build API contract testing with Pact", type: "Task", priority: "High", status: "In Progress", dueDate: 5, labels: ["qa", "testing", "api"], comments: ["Provider verification for PLAT and DATA APIs. Consumer-driven contracts.", "Need PLAT team to add Pact verification to their CI pipeline."] },
          { summary: "Create visual regression testing pipeline", type: "Task", priority: "Medium", status: "In Progress", dueDate: 8, labels: ["qa", "testing", "visual"], comments: ["Using Percy for screenshot comparison. FRONT team's Storybook as baseline."] },
          { summary: "Performance test suite with k6", type: "Story", priority: "High", status: "To Do", dueDate: 12, labels: ["qa", "testing", "performance"], comments: ["Load test: 10k concurrent users. Soak test: 24h. Spike test: 50k burst."] },
          { summary: "Mobile test automation with Detox", type: "Task", priority: "Medium", status: "To Do", dueDate: 18, labels: ["qa", "testing", "mobile"], comments: ["MOBILE team will help set up the test harness."] },
        ],
      },
      {
        summary: "Release Management Process",
        description: "Standardize release process across all teams. Version control, changelog, and release notes.",
        tickets: [
          { summary: "Define release cadence and branching strategy", type: "Task", priority: "High", status: "Done", dueDate: -15, labels: ["qa", "release", "process"], comments: ["2-week sprints. Release trains every 2 weeks. Hotfix branch for critical bugs.", "All teams aligned on git-flow branching model."] },
          { summary: "Build automated changelog generator", type: "Task", priority: "Medium", status: "In Progress", dueDate: 6, labels: ["qa", "release", "automation"], comments: ["Parsing conventional commits. Grouping by type (feat, fix, chore)."] },
          { summary: "Create release readiness checklist", type: "Task", priority: "High", status: "Done", dueDate: -5, labels: ["qa", "release", "process"], comments: ["15-point checklist covering tests, docs, security, performance, rollback plan."] },
          { summary: "Implement feature flags with LaunchDarkly", type: "Story", priority: "Medium", status: "To Do", dueDate: 20, labels: ["qa", "release", "feature-flags"], comments: ["Progressive rollout support. Kill switch for emergencies."] },
        ],
      },
    ],
    standalone: [
      { summary: "Regression bug: payment flow fails after auth v2 update", type: "Bug", priority: "Highest", status: "In Progress", dueDate: -1, labels: ["qa", "bug", "regression", "critical"], comments: ["Auth token format changed. Payment service expecting old format.", "PLAT team aware — coordinating fix."] },
      { summary: "Update test data generators for new schema", type: "Task", priority: "Medium", status: "To Do", dueDate: 8, labels: ["qa", "testing"], comments: [] },
      { summary: "Security penetration testing — Q1 report", type: "Task", priority: "High", status: "To Do", dueDate: 14, labels: ["qa", "security"], comments: ["External vendor (HackerOne) scheduled for next week."] },
    ],
  },
};

// ─── Cross-Team Dependencies ─────────────────────────────
// These issue links will be created AFTER all issues exist.
// Format: [sourceProjectKey, sourceTicketIndex, targetProjectKey, targetTicketIndex, linkType]
// sourceTicketIndex: sequential index of created issues per project (0-based)
// linkType: "Blocks" | "is blocked by" | "relates to"

// We'll track created keys and link them by description match instead
const CROSS_TEAM_LINKS = [
  // ─── Program Board → Team Links (Feature → Implementation) ───
  // F1: Auth → PLAT auth service, FRONT login UI, MOBILE auth, QA regression
  { from: { project: "PROG", match: "Unified Authentication" }, to: { project: "PLAT", match: "Authentication Service" }, type: "Blocks" },
  { from: { project: "PROG", match: "auth migration rollout" }, to: { project: "PLAT", match: "OIDC provider" }, type: "Blocks" },
  { from: { project: "PROG", match: "auth migration rollout" }, to: { project: "FRONT", match: "account settings" }, type: "Blocks" },
  { from: { project: "PROG", match: "auth migration rollout" }, to: { project: "MOBILE", match: "Firebase Cloud Messaging" }, type: "Blocks" },
  { from: { project: "PROG", match: "Enterprise SSO" }, to: { project: "PLAT", match: "SSO integration" }, type: "Blocks" },
  { from: { project: "PROG", match: "auth service API contract" }, to: { project: "QA", match: "contract testing" }, type: "Blocks" },

  // F2: Analytics → DATA pipeline, PLAT events, FRONT dashboard
  { from: { project: "PROG", match: "Real-Time Customer Analytics" }, to: { project: "DATA", match: "Real-Time Analytics Pipeline" }, type: "Blocks" },
  { from: { project: "PROG", match: "event schema standards" }, to: { project: "PLAT", match: "event schemas" }, type: "Blocks" },
  { from: { project: "PROG", match: "latency target" }, to: { project: "DATA", match: "Kafka" }, type: "Blocks" },
  { from: { project: "PROG", match: "analytics dashboard MVP" }, to: { project: "FRONT", match: "customer dashboard" }, type: "Blocks" },
  { from: { project: "PROG", match: "analytics dashboard MVP" }, to: { project: "DATA", match: "data access API" }, type: "Blocks" },
  { from: { project: "PROG", match: "Data quality SLA" }, to: { project: "DATA", match: "data quality monitoring" }, type: "Blocks" },

  // F3: Offline → MOBILE offline, PLAT sync
  { from: { project: "PROG", match: "Mobile Offline-First" }, to: { project: "MOBILE", match: "Offline-First Architecture" }, type: "Blocks" },
  { from: { project: "PROG", match: "sync protocol" }, to: { project: "MOBILE", match: "sync engine" }, type: "Blocks" },
  { from: { project: "PROG", match: "Offline mode user acceptance" }, to: { project: "QA", match: "Detox" }, type: "Blocks" },

  // F4: Reliability → INFRA K8s, observability, PLAT containerize
  { from: { project: "PROG", match: "Platform Reliability" }, to: { project: "INFRA", match: "Kubernetes Migration" }, type: "Blocks" },
  { from: { project: "PROG", match: "SLOs and error budgets" }, to: { project: "INFRA", match: "SLO dashboards" }, type: "Blocks" },
  { from: { project: "PROG", match: "K8s migration for all" }, to: { project: "INFRA", match: "remaining services to EKS" }, type: "Blocks" },
  { from: { project: "PROG", match: "distributed tracing" }, to: { project: "INFRA", match: "distributed tracing" }, type: "Blocks" },

  // F5: CI/CD → INFRA pipelines, QA quality gates
  { from: { project: "PROG", match: "CI/CD & Quality Gate" }, to: { project: "INFRA", match: "CI/CD Pipeline Modernization" }, type: "Blocks" },
  { from: { project: "PROG", match: "CI/CD pipeline template" }, to: { project: "INFRA", match: "GitHub Actions" }, type: "Blocks" },
  { from: { project: "PROG", match: "quality gates" }, to: { project: "QA", match: "Playwright" }, type: "Blocks" },
  { from: { project: "PROG", match: "Release train" }, to: { project: "QA", match: "release cadence" }, type: "Blocks" },

  // F6: Portal → FRONT design system, PLAT APIs, MOBILE components
  { from: { project: "PROG", match: "Customer Portal v2" }, to: { project: "FRONT", match: "Customer Portal Redesign" }, type: "Blocks" },
  { from: { project: "PROG", match: "accessibility audit" }, to: { project: "FRONT", match: "a11y compliance" }, type: "Blocks" },
  { from: { project: "PROG", match: "self-service" }, to: { project: "FRONT", match: "onboarding wizard" }, type: "Blocks" },
  { from: { project: "PROG", match: "Design system v3 adoption" }, to: { project: "FRONT", match: "Design System v3" }, type: "Blocks" },

  // GDPR → DATA
  { from: { project: "PROG", match: "GDPR compliance" }, to: { project: "DATA", match: "GDPR data deletion" }, type: "Blocks" },

  // ─── Team-to-Team Links ───
  // PLAT auth v2 blocks FRONT portal SSO settings
  { from: { project: "PLAT", match: "OIDC provider" }, to: { project: "MOBILE", match: "Apple Sign-In" }, type: "Blocks" },
  { from: { project: "PLAT", match: "sessions to new auth" }, to: { project: "DATA", match: "user activity data" }, type: "Blocks" },
  { from: { project: "PLAT", match: "rate limiting" }, to: { project: "INFRA", match: "Redis cluster" }, type: "Blocks" },
  { from: { project: "PLAT", match: "API key management" }, to: { project: "FRONT", match: "API key management" }, type: "Blocks" },
  { from: { project: "PLAT", match: "user-service events" }, to: { project: "DATA", match: "ETL pipelines" }, type: "Blocks" },
  // FRONT needs DATA API for portal
  { from: { project: "DATA", match: "data access API" }, to: { project: "FRONT", match: "customer dashboard" }, type: "Blocks" },
  { from: { project: "FRONT", match: "DataTable" }, to: { project: "PLAT", match: "API versioning" }, type: "Blocks" },
  // MOBILE depends on PLAT sync
  { from: { project: "PLAT", match: "Event-Driven" }, to: { project: "MOBILE", match: "sync engine" }, type: "Blocks" },
  { from: { project: "MOBILE", match: "deep linking" }, to: { project: "FRONT", match: "deep linking" }, type: "Blocks" },
  // INFRA blocks multiple teams
  { from: { project: "INFRA", match: "GitHub Actions" }, to: { project: "MOBILE", match: "React Native" }, type: "Blocks" },
  { from: { project: "INFRA", match: "GitHub Actions" }, to: { project: "DATA", match: "Airflow" }, type: "Blocks" },
  { from: { project: "INFRA", match: "distributed tracing" }, to: { project: "PLAT", match: "OpenTelemetry" }, type: "Blocks" },
  { from: { project: "INFRA", match: "Rotate all production secrets" }, to: { project: "PLAT", match: "connection pool" }, type: "Blocks" },
  // QA cross-team
  { from: { project: "QA", match: "contract testing" }, to: { project: "PLAT", match: "API contracts" }, type: "Blocks" },
  { from: { project: "QA", match: "Playwright" }, to: { project: "FRONT", match: "E2E tests" }, type: "Blocks" },
  { from: { project: "QA", match: "Detox" }, to: { project: "MOBILE", match: "crash on Android" }, type: "Blocks" },
  { from: { project: "QA", match: "regression bug" }, to: { project: "PLAT", match: "JWT token" }, type: "Blocks" },
  // Bidirectional: DATA ↔ PLAT (mutual dependency)
  { from: { project: "DATA", match: "Kafka → Flink" }, to: { project: "PLAT", match: "event schemas" }, type: "Blocks" },
  { from: { project: "PLAT", match: "Kafka cluster" }, to: { project: "DATA", match: "ClickHouse cluster" }, type: "Blocks" },
];

// ─── Main Seed Logic ─────────────────────────────────────

async function detectEpicFields(projectKey, epicTypeId) {
  let epicNameField = null;
  let epicLinkField = null;
  let useParentField = false;

  try {
    const epicMeta = await jiraGet(`/issue/createmeta/${projectKey}/issuetypes/${epicTypeId}`);
    for (const field of epicMeta.values || []) {
      if (field.name === "Epic Name") epicNameField = field.fieldId;
      if (field.name === "Epic Link") epicLinkField = field.fieldId;
    }
  } catch {}

  if (!epicNameField && !epicLinkField) {
    try {
      const allFields = await jiraGet("/field");
      const epicNameDef = allFields.find((f) => f.name === "Epic Name");
      const epicLinkDef = allFields.find((f) => f.name === "Epic Link" || f.clauseNames?.includes("'Epic Link'"));
      if (epicNameDef) epicNameField = epicNameDef.id;
      if (epicLinkDef) epicLinkField = epicLinkDef.id;
    } catch {}
  }

  if (!epicNameField && !epicLinkField) {
    useParentField = true;
  } else {
    if (!epicNameField) epicNameField = "customfield_10011";
    if (!epicLinkField) epicLinkField = "customfield_10014";
  }

  return { epicNameField, epicLinkField, useParentField };
}

async function ensureProject(key, name) {
  try {
    const project = await jiraGet(`/project/${key}`);
    log(`Project ${key} already exists (id: ${project.id})`);
    return project;
  } catch {
    log(`Creating project "${name}" (${key})...`);
    const myself = await jiraGet("/myself");
    const project = await jiraPost("/project", {
      key,
      name,
      projectTypeKey: "software",
      projectTemplateKey: "com.pyxis.greenhopper.jira:gh-scrum-template",
      lead: myself.name || myself.key,
    });
    log(`Project created (id: ${project.id})`);
    return project;
  }
}

async function getIssueTypes(projectKey) {
  const meta = await jiraGet(`/issue/createmeta/${projectKey}/issuetypes`);
  const types = {};
  for (const it of meta.values) {
    types[it.name] = it.id;
  }
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

async function seedProject(projectDef, projectData, priorities, epicFields) {
  const { key, name } = projectDef;
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  Seeding: ${name} (${key})`);
  console.log(`${"═".repeat(50)}\n`);

  await ensureProject(key, name);
  const issueTypes = await getIssueTypes(key);
  const { epicNameField, epicLinkField, useParentField } = epicFields;

  const typeMap = {
    Epic: issueTypes["Epic"],
    Story: issueTypes["Story"] || issueTypes["Task"],
    Task: issueTypes["Task"],
    Bug: issueTypes["Bug"] || issueTypes["Task"],
    "Sub-task": issueTypes["Sub-task"] || issueTypes["Task"],
  };

  const createdIssues = []; // Track all created issues for cross-linking

  // Create epics and their children
  for (const epic of projectData.epics) {
    log(`Creating epic: ${epic.summary}`);
    const epicFieldsObj = {
      project: { key },
      summary: epic.summary,
      description: epic.description,
      issuetype: { id: typeMap.Epic },
    };
    if (epicNameField && !useParentField) {
      epicFieldsObj[epicNameField] = epic.summary;
    }

    let epicIssue;
    try {
      epicIssue = await jiraPost("/issue", { fields: epicFieldsObj });
      log(`  ✓ ${epicIssue.key}`);
      createdIssues.push({ key: epicIssue.key, summary: epic.summary, project: key });
    } catch (err) {
      console.error(`  ✗ Failed to create epic: ${err.message.substring(0, 100)}`);
      continue;
    }

    for (const ticket of epic.tickets) {
      const issueTypeId = typeMap[ticket.type] || typeMap.Task;
      const priorityId = priorities[ticket.priority] || priorities["Medium"];

      const fields = {
        project: { key },
        summary: ticket.summary,
        issuetype: { id: issueTypeId },
        priority: { id: priorityId },
        labels: ticket.labels || [],
      };

      if (!useParentField && epicLinkField) {
        fields[epicLinkField] = epicIssue.key;
      } else {
        fields.parent = { key: epicIssue.key };
      }

      let createdIssue;
      try {
        createdIssue = await jiraPost("/issue", { fields });
        log(`  ✓ ${createdIssue.key} — ${ticket.summary.substring(0, 55)}`);
      } catch {
        try {
          if (!useParentField && epicLinkField) {
            delete fields[epicLinkField];
            fields.parent = { key: epicIssue.key };
          }
          createdIssue = await jiraPost("/issue", { fields });
          log(`  ✓ ${createdIssue.key} — ${ticket.summary.substring(0, 55)} (via parent)`);
        } catch (err2) {
          console.error(`  ✗ Failed: ${err2.message.substring(0, 100)}`);
          continue;
        }
      }

      createdIssues.push({ key: createdIssue.key, summary: ticket.summary, project: key });

      // Due date
      if (ticket.dueDate != null) {
        try {
          await jiraPut(`/issue/${createdIssue.key}`, { fields: { duedate: daysFromNow(ticket.dueDate) } });
        } catch {}
      }

      // Comments
      for (const comment of ticket.comments || []) {
        try { await addComment(createdIssue.key, comment); } catch {}
      }

      // Transition
      if (ticket.status === "In Progress") {
        await transitionIssue(createdIssue.key, "In Progress") ||
          await transitionIssue(createdIssue.key, "Start Progress");
      } else if (ticket.status === "Done") {
        await transitionIssue(createdIssue.key, "In Progress") ||
          await transitionIssue(createdIssue.key, "Start Progress");
        await transitionIssue(createdIssue.key, "Done") ||
          await transitionIssue(createdIssue.key, "Resolve Issue");
      }
    }
  }

  // Standalone tickets
  if (projectData.standalone?.length) {
    log(`\n  --- Standalone tickets ---`);
    for (const ticket of projectData.standalone) {
      const issueTypeId = typeMap[ticket.type] || typeMap.Task;
      const priorityId = priorities[ticket.priority] || priorities["Medium"];

      const fields = {
        project: { key },
        summary: ticket.summary,
        issuetype: { id: issueTypeId },
        priority: { id: priorityId },
        labels: ticket.labels || [],
      };

      let createdIssue;
      try {
        createdIssue = await jiraPost("/issue", { fields });
        log(`  ✓ ${createdIssue.key} — ${ticket.summary.substring(0, 55)}`);
      } catch (err) {
        console.error(`  ✗ Failed: ${err.message.substring(0, 100)}`);
        continue;
      }

      createdIssues.push({ key: createdIssue.key, summary: ticket.summary, project: key });

      if (ticket.dueDate != null) {
        try {
          await jiraPut(`/issue/${createdIssue.key}`, { fields: { duedate: daysFromNow(ticket.dueDate) } });
        } catch {}
      }

      for (const comment of ticket.comments || []) {
        try { await addComment(createdIssue.key, comment); } catch {}
      }

      if (ticket.status === "In Progress") {
        await transitionIssue(createdIssue.key, "In Progress") ||
          await transitionIssue(createdIssue.key, "Start Progress");
      } else if (ticket.status === "Done") {
        await transitionIssue(createdIssue.key, "In Progress") ||
          await transitionIssue(createdIssue.key, "Start Progress");
        await transitionIssue(createdIssue.key, "Done") ||
          await transitionIssue(createdIssue.key, "Resolve Issue");
      }
    }
  }

  return createdIssues;
}

async function seed() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║     Multi-Project Seed Script — PI Planning     ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`Target: ${JIRA_BASE_URL}`);
  console.log(`Projects: ${PROJECTS.map((p) => p.key).join(", ")}\n`);

  // Get priorities (shared across projects)
  const priorities = await getPriorities();

  // Detect epic fields from first project
  await ensureProject(PROJECTS[0].key, PROJECTS[0].name);
  const issueTypes = await getIssueTypes(PROJECTS[0].key);
  const epicFields = await detectEpicFields(PROJECTS[0].key, issueTypes["Epic"]);
  log(`Epic mode: ${epicFields.useParentField ? "parent field (Jira 10.x)" : `Epic Link: ${epicFields.epicLinkField}`}`);

  // Seed all projects
  const allCreatedIssues = {};
  for (const project of PROJECTS) {
    const data = PROJECT_DATA[project.key];
    if (!data) {
      console.warn(`No seed data for ${project.key}, skipping`);
      continue;
    }
    const issues = await seedProject(project, data, priorities, epicFields);
    allCreatedIssues[project.key] = issues;
  }

  // Create cross-team issue links
  console.log(`\n${"═".repeat(50)}`);
  console.log("  Creating Cross-Team Dependencies");
  console.log(`${"═".repeat(50)}\n`);

  // Get available link types
  let linkTypes = [];
  try {
    const lt = await jiraGet("/issueLinkType");
    linkTypes = lt.issueLinkTypes || [];
    log(`Available link types: ${linkTypes.map((t) => t.name).join(", ")}`);
  } catch (err) {
    console.warn(`Could not fetch link types: ${err.message}`);
  }

  // Find a "Blocks" type or similar
  const blocksType = linkTypes.find(
    (t) => t.name === "Blocks" || t.outward?.toLowerCase().includes("block")
  );
  const relatesType = linkTypes.find(
    (t) => t.name === "Relates" || t.outward?.toLowerCase().includes("relat")
  );

  const linkTypeName = blocksType?.name || relatesType?.name || "Blocks";
  log(`Using link type: "${linkTypeName}"`);

  let linkedCount = 0;
  for (const link of CROSS_TEAM_LINKS) {
    const fromIssues = allCreatedIssues[link.from.project] || [];
    const toIssues = allCreatedIssues[link.to.project] || [];

    const fromIssue = fromIssues.find((i) =>
      i.summary.toLowerCase().includes(link.from.match.toLowerCase())
    );
    const toIssue = toIssues.find((i) =>
      i.summary.toLowerCase().includes(link.to.match.toLowerCase())
    );

    if (fromIssue && toIssue) {
      const success = await createIssueLink(fromIssue.key, toIssue.key, linkTypeName);
      if (success) {
        log(`  ✓ ${fromIssue.key} → ${toIssue.key} (${link.from.project} → ${link.to.project})`);
        linkedCount++;
      }
    } else {
      if (!fromIssue) console.warn(`  ⚠ No match for "${link.from.match}" in ${link.from.project}`);
      if (!toIssue) console.warn(`  ⚠ No match for "${link.to.match}" in ${link.to.project}`);
    }
  }

  // ─── Summary ─────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║                 Seed Complete!                   ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  let totalIssues = 0;
  for (const [key, issues] of Object.entries(allCreatedIssues)) {
    const project = PROJECTS.find((p) => p.key === key);
    console.log(`  ${project?.name || key} (${key}): ${issues.length} issues`);
    totalIssues += issues.length;
  }
  console.log(`\n  Total: ${totalIssues} issues across ${PROJECTS.length} projects`);
  console.log(`  Cross-team links: ${linkedCount}`);
  console.log(`\n  Dashboard: http://localhost:3010`);
  console.log(`  PI Planning: http://localhost:3010/pi-planning`);
  console.log(`  Jira: ${JIRA_BASE_URL}\n`);

  // Output env config for teams
  console.log("─── Suggested .env Configuration ───\n");
  const teamProjects = PROJECTS.filter((p) => p.key !== "PROG");
  const teamsConfig = teamProjects.map((p) => ({
    id: p.key.toLowerCase(),
    name: p.name,
    serverId: "primary",
    projectKey: p.key,
    boardId: null,
    color: p.color,
  }));
  console.log(`TEAMS='${JSON.stringify(teamsConfig)}'`);
  console.log(`\nJIRA_SERVERS='${JSON.stringify([{
    id: "primary",
    name: "Primary Jira",
    url: JIRA_BASE_URL,
    username: JIRA_USERNAME,
    token: "***",
    projects: PROJECTS.map((p) => p.key),
  }])}'`);
  console.log(`\nPROGRAM_PROJECT=PROG`);
  console.log(`PROGRAM_SERVER_ID=primary`);
  console.log(`\nPI_NAME=PI-2026-Q1`);
  console.log(`PI_START_DATE=2026-03-01`);
  console.log(`PI_END_DATE=2026-05-31`);
  console.log(`PI_SPRINT_COUNT=5`);
  console.log(`PI_SPRINT_DURATION=14\n`);
}

seed().catch((err) => {
  console.error("\nSeed failed:", err.message);
  console.error("\nMake sure:");
  console.error("  1. Jira is running and initial setup is complete");
  console.error("  2. .env has correct JIRA_USERNAME and JIRA_API_TOKEN");
  console.error(`  3. You can access ${JIRA_BASE_URL} in your browser\n`);
  process.exit(1);
});
