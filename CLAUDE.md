# AIgile — Claude Code Rules (Open Source)

## Repo
- Opensource: `https://github.com/gruion/AIgile.git`
- SaaS version (separate codebase): `/Users/cyril/DEVELOPMENT/aigilecoach`
- Changes to shared code (Jira search, health check, etc.) must also be applied to the SaaS repo.

## Code conventions
- API: Node.js ESM (`import`), Express, no TypeScript
- Frontend: Next.js 14 App Router, Tailwind CSS, no TypeScript
- No new dependencies without asking first
- No database — file-based config only (`/data/config.json`)
- No authentication — opensource is single-tenant, no auth middleware
- Jira Cloud uses POST /rest/api/3/search/jql (not v2 GET), with v2 fallback for self-hosted

## Architecture
- `api/server.js` — monolithic API (all routes in one file)
- `frontend/src/` — Next.js app router
- Config: file → env vars → defaults (3-tier)
- AI config stored in `/data/ai-config.json`
- In-memory stores: retroSessions, roamRisks, healthChecks, sprintGoals, raciMatrices

## Health check
- `GET /health` — full public health check (no auth): API, Jira, AI, RACI, config

## What this repo does NOT have (SaaS only)
- No PostgreSQL / database
- No auth / JWT / tenants / users
- No Stripe billing
- No demo mode
- No structured logger (uses console.log)
