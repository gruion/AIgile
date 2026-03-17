Jira AI Dashboard — Frontend
=============================

A Next.js dashboard for Jira with AI-powered insights, Gantt view, and epic detail pages.

Pages:
  /           — Dashboard with epic-grouped tickets, urgency flags, filters
  /insights   — AI-generated summaries and board analysis
  /gantt      — Gantt chart with multi-epic color coding
  /epic/[key] — Epic detail with AI prompt generator + copy to clipboard


PREREQUISITES
─────────────
The frontend requires a running API backend. By default it connects to
http://localhost:3011. Change with the -a flag or NEXT_PUBLIC_API_URL env var.


OPTION 1: Docker (recommended)
──────────────────────────────
  chmod +x docker-run.sh
  ./docker-run.sh                          # http://localhost:3010
  ./docker-run.sh -p 8080                  # custom port
  ./docker-run.sh -a http://my-api:3011    # custom API URL


OPTION 2: Standalone (Node.js >= 18)
─────────────────────────────────────
  chmod +x run.sh
  ./run.sh                                 # production build + serve on :3000
  ./run.sh -p 8080                         # custom port
  ./run.sh -a http://my-api:3011           # custom API URL
  ./run.sh -d                              # dev mode with hot reload


ENVIRONMENT VARIABLES
─────────────────────
  NEXT_PUBLIC_API_URL   API base URL (default: http://localhost:3011)


TECH STACK
──────────
  Next.js 14, React 18, Tailwind CSS 3
