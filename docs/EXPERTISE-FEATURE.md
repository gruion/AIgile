# Expertise Map — SME Detection & Bus Factor Analysis

## Overview

The Expertise Map analyzes Jira ticket history to identify **Subject Matter Experts (SMEs)** per technical domain. It answers: "Who should I ask about X?" — based on actual work, not job titles.

---

## How It Works

### Data Sources (from Jira)
- **Assignee history**: Who was assigned and resolved tickets in each area
- **Components/Labels**: Technical domains (auth, payments, CI/CD, frontend, etc.)
- **Epic grouping**: Who worked most on which epics
- **Comment activity**: Who contributes knowledge even on tickets they don't own
- **Recency**: Recent experience weighted higher than old tickets

### Scoring Algorithm

For each `(person, domain)` pair:

```
rawScore = (resolved_tickets × 3)       ← completed work
         + (assigned_active × 1)         ← current context
         + (comments_on_others × 0.5)    ← knowledge sharing

recencyBonus = max(0, 1 - days_since_last / 365)   ← decays over 1 year

finalScore = rawScore × (0.5 + 0.5 × recencyBonus)
```

### Domain Detection

Domains are auto-detected from:
- **Labels** on tickets (e.g., `auth`, `frontend`)
- **Components** (e.g., "Payment Service")
- **Epic names** (grouped as `epic:PROJ-123`)
- **Keywords in summaries**: auth, api, frontend, backend, database, ci/cd, pipeline, payment, security, infra, deploy, test, mobile, performance, migration, monitoring, logging, notification, email, search, cache, config
- **Issue types**: bugs → "bug-fixing", epics → "epic-ownership"

---

## Implemented Features

### Phase 1 — Backend (`GET /expertise`)

**Endpoint**: `GET /expertise?jql=statusCategory = Done ORDER BY resolved DESC`

**Returns**:
```json
{
  "totalIssuesAnalyzed": 500,
  "people": [{ "name": "Alice", "totalResolved": 45, "domainCount": 6, "topDomains": [...] }],
  "topDomains": [{ "domain": "auth", "expertCount": 3, "totalTickets": 25, "topExperts": [...] }],
  "busFactor": [{ "domain": "payment", "risk": "high", "soloExpert": "Bob", "totalTickets": 15 }],
  "domainExperts": { "auth": [{ "person": "Alice", "score": 45, "resolved": 18, "daysSinceActive": 3 }] },
  "stats": { "totalPeople": 8, "totalDomains": 15, "busFactorRisks": 2 }
}
```

### Phase 2 — Frontend (`/expertise` page)

Three views:

#### By Domain
Expandable cards per domain showing ranked experts with scores, progress bars, resolved count, and last active date:
```
auth          12 tickets   3 experts   Alice(45)  Bob(22)  Charlie(8)
  #1 Alice     45pts  ████████████████  18 resolved  3d ago
  #2 Bob       22pts  ████████          8 resolved   1w ago
  #3 Charlie    8pts  ███               3 resolved   2w ago
```

#### By Person
Expandable cards per person showing their expertise across domains:
```
Alice         22 resolved   5 active   6 domains
  auth 45pts  ci/cd 20pts  api 15pts  frontend 8pts
```

#### Bus Factor
Red/amber alerts for domains with only 1 contributor:
```
!! payment    HIGH RISK   15 tickets, only 1 expert: Bob
!! deployment CRITICAL    8 tickets, NO contributor identified
```

### Bus Factor Compliance Check

Added to the Project Compliance page (`/compliance`) as a new check worth 10 points:
- 4+ unique resolvers → 10 pts (pass)
- 3 resolvers → 8 pts (pass)
- 2 resolvers → 5 pts (warning)
- 1 resolver → 2 pts (fail)
- Penalized if top resolver handles >70% of tickets

### AI Coach Integration

5 prompts on the expertise page:
1. **Knowledge gaps** — Critical gaps, bus factor risks, cross-training priorities
2. **Succession planning** — Backup for each domain expert
3. **Team structure** — Are people spread too thin? Specialize vs cross-train?
4. **Onboarding guide** — Who to talk to about each domain
5. **RACI suggestions** — Map expertise scores to RACI assignments

---

## Phase 3 — Integration (Not Yet Implemented)

### 3a. Ticket SME Suggestion

**Where**: TicketDiffModal (Suggest Fix button on 10 pages)

**How**: When the modal opens for a ticket, match the ticket's labels/components/keywords against expertise data. Show a "Recommended reviewer" line:

```
Recommended reviewer: Alice (auth expert, score 45, last active 3 days ago)
```

**Implementation**:
- Call `/expertise` with a narrow JQL for the ticket's project
- Match ticket labels/components against `domainExperts`
- Pick the top-scoring expert for the matching domain
- Show in the TicketDiffModal header

### 3b. RACI Auto-Fill from Expertise

**Where**: RACI Matrix page → "Suggest from Jira" button

**How**: Instead of just using assignee frequency, use expertise scores:
- **Top domain expert** → Accountable (A)
- **Secondary experts** → Responsible (R)
- **Commenters/contributors** → Consulted (C)
- **Others in the team** → Informed (I)

**Implementation**:
- Call `/expertise` when generating RACI suggestions
- For each RACI activity, map to a domain (e.g., "Code Review" → labels with "review", "Architecture Decisions" → "architecture" domain)
- Auto-assign based on expertise ranking

### 3c. Runner Dashboard Escalation

**Where**: Runner Dashboard (planned feature, see `docs/RUNNER-FEATURE.md`)

**How**: When the runner gets an incident, auto-suggest who to escalate to:
```
Incident: "Payment API timeout"
→ Escalate to: Bob (payment domain, score 52, last active yesterday)
→ Backup: Charlie (payment domain, score 18, last active 1 week ago)
```

**Implementation**:
- Parse incident title/description for keywords
- Match against expertise domains
- Show top 2 experts with availability info

### 3d. Sprint Planning Coverage

**Where**: Sprint Planning page (`/planning`)

**How**: Analyze the sprint's planned tickets and check team coverage:
```
Sprint coverage analysis:
✓ auth (3 tickets) — Alice is available
✓ frontend (5 tickets) — Dave is available
✗ payment (2 tickets) — Bob is on PTO, no backup expert!
→ Suggestion: Pair Carol with Bob before the sprint to transfer payment knowledge
```

**Implementation**:
- For each ticket in the sprint, detect domain
- Check if the domain's top expert is assigned to the sprint
- Flag gaps where no domain expert is available
- Suggest pairing/knowledge transfer

### 3e. Expertise Trends (Analytics)

**Where**: New section on Analytics page or dedicated view

**How**: Track expertise scores over time:
- "Alice's auth score grew from 20 to 45 in 3 months" (developing expert)
- "Bob's payment score hasn't changed in 6 months" (stale knowledge)
- "Charlie started contributing to CI/CD this month" (cross-training success)

**Implementation**:
- Store monthly expertise snapshots (in DB for paid version)
- Show trend lines per person per domain
- Detect: growing expertise, stale expertise, new contributors

---

## Opensource vs Paid

| Feature | Opensource | Paid (SaaS/Enterprise) |
|---------|-----------|----------------------|
| SME detection | Basic (resolved tickets) | Full (comments, reviews, recency decay) |
| Bus factor alerts | Simple count | Trend analysis, automated alerts |
| Ticket SME suggestion | Manual lookup on /expertise page | Auto-suggest on every ticket diff |
| RACI auto-fill | Basic assignee frequency | Expertise-weighted RACI suggestions |
| Runner escalation | Not available | Auto-suggest escalation targets |
| Sprint coverage | Not available | Gap analysis per sprint |
| Expertise trends | Not available | Monthly snapshots, growth tracking |
| AI Coach | Basic prompts | Deep analysis, cross-team recommendations |
