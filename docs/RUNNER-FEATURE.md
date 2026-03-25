# Runner Dashboard — Feature Specification

## What is a Runner?

A **Runner** (also called Duty Officer, Incident Coordinator, or On-Call Coordinator) is a rotating team role responsible for:
- Handling daily incidents and interruptions so teammates can focus
- Monitoring dashboards and health checks
- Distributing incoming requests to the right people
- Morning and evening operational checks
- Shift handover to the next runner

The Runner accumulates many small tasks throughout the day and needs tools to stay organized, track delegation, and hand over cleanly.

---

## Proposed Features

### Phase 1 — Core (MVP)

#### 1.1 Shift Management
- **Start/End Shift** button with timestamp
- Shift duration tracking
- Runner rotation calendar (who's running today, this week)
- Configurable shift times (e.g., 9:00–18:00)

#### 1.2 Shift Checklist
- Configurable morning/evening check items per team
- Examples: "Check Grafana dashboards", "Review overnight alerts", "Check CI/CD pipelines", "Review open incidents"
- One-click checkbox with timestamp ("checked at 09:15")
- Items reset each shift
- Recurring vs one-time items
- Carry-over: unchecked items appear on next runner's shift

#### 1.3 Quick Task Capture
- Single-line task input with auto-categorization
- Categories: Incident, Request, Follow-up, Check, Escalation
- Priority: Urgent / Normal / Low
- Optional: link to Jira ticket
- Timer per task (auto-start on creation, pause/resume)
- "Delegate" action: assign to teammate with one click + auto-notification placeholder

#### 1.4 Handover Notes
- Free-text notes during the shift
- Auto-generated summary at shift end:
  - Tasks handled (count by category)
  - Delegated items (to whom, status)
  - Pending items (carry-over)
  - Time spent per category
- Previous runner's notes visible at shift start
- "Nothing to report" quick button for quiet shifts

---

### Phase 2 — Incident Management

#### 2.1 Incident Triage Queue
- Incoming incidents in a single prioritized queue
- Source: manual entry, or pulled from Jira (JQL filter for incident type)
- States: New → Acknowledged → Assigned → Resolved
- SLA timer per incident (configurable: P1 = 15min, P2 = 1h, P3 = 4h)
- Visual urgency: red glow when SLA is about to breach
- One-click assign to teammate

#### 2.2 Delegation Tracker
- "I assigned X to Alice at 10:30" with status tracking
- States: Assigned → In Progress → Done / Escalated
- Follow-up reminders: "Alice hasn't responded in 30 min"
- End-of-day: list of all delegations and their status

#### 2.3 Contact Directory
- Who owns what service/component
- Who's on vacation / unavailable today
- Backup contacts per service
- "Who to call" decision tree per incident type

---

### Phase 3 — Monitoring & Analytics

#### 3.1 Dashboard Monitor Wall
- Configurable list of URLs to check (Grafana, Datadog, status pages)
- Health status: Green (OK) / Yellow (degraded) / Red (down)
- "I checked this" button with timestamp (proof of monitoring)
- Auto-refresh at configurable intervals
- Anomaly detection: "This changed significantly since last check"

#### 3.2 Runner Analytics
- Incidents per shift (daily/weekly/monthly trends)
- Average resolution time
- Busiest hours heatmap
- Most interrupted team members (who gets the most delegations)
- Most common incident types
- Shift comparison: Monday vs Friday runner load
- Burnout detection: "Alice has been runner 8 of the last 10 days"

#### 3.3 Capacity Impact
- Integration with Sprint Review: how much capacity was lost to runner duty
- "Runner tax" metric: % of team time spent on incidents vs planned work
- Correlation: more incidents → lower velocity?

---

### Phase 4 — Communication

#### 4.1 Message Templates
- Pre-written messages for common situations:
  - "Incident in progress — investigating"
  - "Service restored — post-mortem to follow"
  - "Deploy delayed — estimated new time: X"
  - "Need help from [team] — please respond ASAP"
- Customizable per team
- One-click copy or direct send (Slack/Teams placeholder)

#### 4.2 Broadcast
- Send status update to team channel
- Incident timeline: auto-log of all status changes + messages sent
- Post-incident summary generator

---

## AI Coach Integration

The Runner Dashboard feeds into AIgileCoach's AI Coach with these prompts:

- **"Analyze runner patterns"**: Which services cause the most interruptions? What should we invest in?
- **"Optimize shift handover"**: Based on handover notes, what information is most valuable? What's being missed?
- **"Reduce runner load"**: Based on incident history, suggest automation or process changes to reduce interruptions
- **"Staffing recommendation"**: Based on incident volume, do we need more/fewer runner hours?
- **"Incident categorization"**: Auto-categorize incidents from description text

---

## Data Model

```
runner_shifts
  id, team_id, runner_user, started_at, ended_at, handover_notes

shift_checklist_templates
  id, team_id, name, items (JSON), schedule (morning/evening/both)

shift_checklist_entries
  id, shift_id, template_item_id, checked, checked_at

runner_tasks
  id, shift_id, title, category, priority, status,
  delegated_to, delegated_at, resolved_at,
  jira_key, time_spent_seconds, notes

runner_incidents
  id, shift_id, title, source, priority, sla_minutes,
  status, acknowledged_at, assigned_to, assigned_at, resolved_at,
  resolution_notes

dashboard_monitors
  id, team_id, name, url, check_interval_minutes, last_status, last_checked_at

runner_rotation
  id, team_id, user, date, shift_type (morning/evening/full)
```

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Runner Dashboard          [Alice - On Shift Since 09:00]   │
│                            [End Shift] [Handover Notes]     │
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│  Checklist   │  Task Queue                                  │
│  ☑ Grafana   │  ┌─────────────────────────────────────┐    │
│  ☑ CI/CD     │  │ 🔴 P1 API timeout   → Alice  15min │    │
│  ☐ Alerts    │  │ 🟡 P2 Deploy fail   → unassigned   │    │
│  ☐ Standup   │  │ 🟢 P3 CSS bug       → Bob    Done  │    │
│              │  └─────────────────────────────────────┘    │
│  Monitors    │                                              │
│  🟢 Grafana  │  Quick Add: [________________________] [+]   │
│  🟢 Sentry   │                                              │
│  🔴 CI/CD    │  Delegations                                 │
│              │  Alice: API timeout (in progress)             │
│  Previous    │  Bob: CSS fix (done)                         │
│  Runner Note │  Carol: DB migration (waiting)               │
│  "Deploy at  │                                              │
│   16:00..."  │  [View Handover from Previous Shift]         │
│              │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

---

## Opensource vs Paid

| Feature | Opensource | Paid (SaaS/Enterprise) |
|---------|-----------|----------------------|
| Shift checklist | Manual items, single team | AI-suggested items, multi-team |
| Task capture | Simple list with categories | Jira auto-sync, timers, delegation tracking |
| Handover notes | Free text | Auto-generated from shift activity |
| Incident queue | Manual entry only | Jira/PagerDuty/Slack integration |
| Dashboard monitor | URL list + manual check | Auto-health polling, anomaly alerts |
| Rotation calendar | View only | Swap shifts, burnout detection |
| Analytics | Basic counts | Full trends, heatmaps, capacity impact |
| AI Coach | Basic prompts | Pattern analysis, staffing recommendations |
| End-of-day report | Manual summary | Auto-generated with metrics |

---

## Implementation Priority

1. **Shift Management + Checklist** — 1 session, highest impact
2. **Task Capture + Delegation** — 1 session, core value proposition
3. **Handover Notes** — 0.5 session, quick win
4. **Incident Queue** — 1 session, requires Jira integration
5. **Dashboard Monitor** — 1 session, independent feature
6. **Analytics** — 1 session, requires data from phases 1-4
7. **Communication Hub** — 1 session, Slack/Teams integration
