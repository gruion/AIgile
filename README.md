# Jira Dashboard

A Docker-based dashboard to quickly visualize Jira tickets grouped by Epic, with urgency flags, deadlines, and last comments at a glance.

## Architecture

```
┌─────────────────┐     ┌──────────────┐
│  Next.js        │     │   Jira       │
│  Frontend :3010 │     │   :9080      │
└────────┬────────┘     └──────▲───────┘
         │                      │
┌────────▼────────┐             │
│  Express API    │─────────────┘
│  :3011          │
└─────────────────┘
```

| Service      | Port  | Purpose                                    |
|-------------|-------|--------------------------------------------|
| Frontend    | 3010  | Next.js + Tailwind dashboard               |
| API         | 3011  | Jira REST API proxy with urgency logic     |
| Jira        | 9080  | Jira Software (Data Center)                |
| PostgreSQL  | —     | Internal only (Jira database)              |

## What you see

- **Tickets grouped by Epic** — each epic shows progress bar, status breakdown, alert counters, next deadline
- **Urgency flags per ticket** — overdue, due soon, stale (7d/14d), high priority, blocked, unassigned
- **Quick filters** — All / Critical / Overdue / Stale
- **Per-ticket row** — key, summary, flags, status, due date, assignee, last update, expandable last comment
- **Stats bar** — total, to do, in progress, done, overdue, stale, unassigned counts

## Quick Start

### 1. Configure

```bash
cp .env.example .env
# Edit .env — set JIRA_USERNAME and JIRA_API_TOKEN after Jira setup
```

### 2. Start

```bash
docker compose up -d --build
```

### 3. Set up Jira (first time only)

1. Open http://localhost:9080
2. Choose "I'll set it up myself" → "My Own Database"
3. Database is pre-configured (PostgreSQL auto-detected)
4. Complete the wizard, create an admin account
5. Create a project (e.g., key: `TEAM`)
6. Generate an API token: Profile → Personal Access Tokens
7. Update `.env` with your Jira credentials, then: `docker compose restart api`

### 4. Seed sample data

After Jira setup is complete and `.env` has valid credentials:

```bash
cd api && npm install && npm run seed
```

This creates **5 epics** and **33 tickets** with realistic data:
- Mixed statuses (To Do, In Progress, Done)
- Due dates (some overdue, some upcoming)
- Comments with context
- Priority levels and labels
- Urgency flags (blocked, stale, overdue)

### 5. Open the dashboard

- **Dashboard**: http://localhost:3010
- **Jira**: http://localhost:9080
- **API Health**: http://localhost:3011/health

## JQL Examples

```
project = TEAM ORDER BY status ASC, updated DESC
project = TEAM AND status = "In Progress"
project = TEAM AND assignee = "john.doe"
project = TEAM AND priority in (High, Highest) AND status != Done
project = TEAM AND updated <= -14d AND status != Done
```

## Development

```bash
# Start infra only
docker compose up -d jira jira-db

# Run API locally
cd api && npm install && npm run dev

# Run frontend locally
cd frontend && npm install && npm run dev
```

## Stopping

```bash
docker compose down        # Stop containers
docker compose down -v     # Stop + remove volumes (reset Jira data)
```
