# AIgileCoach (Open Source)

AI-powered agile coaching and project compliance dashboard. Connects to your Jira instance and provides real-time insights, RACI matrices, compliance scoring, and AI-assisted ticket improvement suggestions.

> This is the free/open-source version of AIgileCoach. No authentication, no database required — just connect to Jira and go.

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌──────────────┐
│  Next.js        │     │   Express    │     │   Jira       │
│  Frontend :3010 │────>│   API :3011  │────>│   :9080      │
└─────────────────┘     └──────────────┘     └──────────────┘
```

| Service      | Port  | Compose File | Purpose                              |
|-------------|-------|-------------|---------------------------------------|
| Frontend    | 3010  | `docker-compose.yml` | Next.js + Tailwind dashboard  |
| API         | 3011  | `docker-compose.yml` | Jira REST API proxy + AI coach |
| Jira        | 9080  | `docker-compose.jira.yml` | Jira Software (independent) |
| jira-db     | ---     | `docker-compose.jira.yml` | PostgreSQL for Jira (internal) |

> **Jira runs independently** from AIgileCoach. You can use any Jira instance (Cloud, Data Center, or the bundled one).

## Features

### Core Dashboard
- **20+ pages**: Dashboard, Analytics, Compliance, DoR, Backlog Coach, Hierarchy, Sprint Planning, Sprint Goals, Standup, Flow Metrics, Sprint Review, Retro, Gantt, Dependencies, ROAM, Team Health, RACI Matrix, Deep Analysis, Architecture, Settings, Setup Wizard
- **Tickets grouped by Epic** with progress bars, urgency flags, status breakdown
- **JQL-powered** --- every page accepts custom JQL queries
- **Multi-server** --- connect multiple Jira instances, switch between teams

### AI Coach
- AI-powered coaching panel on every page
- Works with any OpenAI-compatible API (OpenAI, Anthropic, Ollama, custom)
- Copy/paste mode when no API key configured
- Context-aware prompts per page (compliance audit, sprint planning advice, etc.)

### Suggest Fix (Ticket Diff)
- GitHub-style side-by-side diff view on 10 pages
- Shows current ticket fields vs AI-suggested improvements
- Green (+) for additions, red (-) for removals
- Works without AI provider (local analysis from ticket checks/missing fields)
- Copy individual field suggestions or all at once

### RACI Matrix
- Project-level RACI matrices
- Click-to-cycle cell editing (R -> A -> C -> I -> empty)
- Live validation (missing Accountable, missing Responsible)
- AI Coach integration for RACI suggestions
- RACI health score in compliance checks
- Auto-suggest from Jira activity data

### Compliance & Health Scoring
- 15+ automated checks per project (description quality, estimates, acceptance criteria, epic coverage, priority distribution, RACI documentation, etc.)
- Step-by-step remediation wizard
- Per-ticket "Suggest Fix" buttons on failing checks

### Dependencies
- Cross-project dependency graph with blocking chain analysis
- Blocking dependency tree view with expand/collapse
- Project-to-project dependency matrix
- AI-powered dependency discovery across projects

---

## Quick Start

### 1. Configure

```bash
cp .env.example .env
# Edit .env as needed (defaults work for local development)
```

### 2. Start AIgileCoach

```bash
docker compose up -d --build
```

### 3. Start Jira (optional --- separate stack)

```bash
docker compose -f docker-compose.jira.yml up -d
```

> You can skip this if you're connecting to an existing Jira Cloud or Data Center instance.

### 4. Set up Jira (first time only)

1. Open http://localhost:9080
2. Choose "I'll set it up myself" -> "My Own Database"
3. Database is pre-configured (PostgreSQL auto-detected)
4. Complete the wizard, create an admin account
5. Create a project (e.g., key: `TEAM`)
6. Generate an API token: Profile -> Personal Access Tokens

### 5. Connect AIgileCoach to Jira

Open http://localhost:3010 --- the setup wizard will guide you through:
1. Entering your Jira URL + API token
2. Picking a project and naming your team
3. Optionally configuring an AI provider

### 6. Seed sample data (optional)

```bash
cd api && npm install && npm run seed
```

Creates 5 epics and 33 tickets with realistic data.

---

## Environment Variables

### `.env` (local development)

```bash
# Ports
API_PORT=3011
FRONTEND_PORT=3010
NEXT_PUBLIC_API_URL=http://localhost:3011

# Jira database password (only needed if running bundled Jira)
JIRA_DB_PASSWORD=jira_secret
```

See `.env.example` for the full list including optional Jira pre-configuration and AI provider settings.

---

## E2E Testing (Playwright)

```bash
# Install
npm install
npx playwright install chromium

# Run tests (requires docker compose running)
npm test

# Run with browser visible
npm run test:headed

# Run with interactive UI
npm run test:ui
```

Test coverage:
- Navigation & sidebar
- Setup wizard
- RACI matrix (CRUD, validation, cell cycling)
- Compliance checks & Suggest Fix
- AI Coach panel
- Ticket Diff modal
- Settings & config API

---

## Docker Compose Files

| File | Purpose | Command |
|------|---------|---------|
| `docker-compose.yml` | AIgileCoach (API + Frontend) | `docker compose up -d` |
| `docker-compose.jira.yml` | Standalone Jira + its PostgreSQL | `docker compose -f docker-compose.jira.yml up -d` |

## Development

```bash
# Start AIgileCoach only
docker compose up -d

# Start Jira separately
docker compose -f docker-compose.jira.yml up -d

# Run API locally (without Docker)
cd api && npm install && npm run dev

# Run frontend locally (without Docker)
cd frontend && npm install && npm run dev
```

## Stopping

```bash
# Stop AIgileCoach
docker compose down

# Stop Jira
docker compose -f docker-compose.jira.yml down

# Stop + remove ALL volumes (reset data)
docker compose down -v
docker compose -f docker-compose.jira.yml down -v
```
