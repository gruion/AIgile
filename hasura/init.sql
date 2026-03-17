-- AI summaries database schema
CREATE TABLE IF NOT EXISTS ai_summaries (
  id SERIAL PRIMARY KEY,
  issue_key TEXT NOT NULL,
  jira_updated_at TIMESTAMPTZ NOT NULL,
  tldr TEXT,
  status_insight TEXT,
  action_needed TEXT,
  risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high')),
  risk_reason TEXT,
  staleness_days INTEGER DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_summaries_issue_key ON ai_summaries(issue_key);
CREATE INDEX IF NOT EXISTS idx_ai_summaries_risk_level ON ai_summaries(risk_level);

-- Board-level summaries (per JQL query)
CREATE TABLE IF NOT EXISTS ai_board_summaries (
  id SERIAL PRIMARY KEY,
  jql_hash TEXT NOT NULL,
  jql TEXT NOT NULL,
  executive_summary TEXT,
  blocked_tickets JSONB DEFAULT '[]',
  stale_tickets JSONB DEFAULT '[]',
  team_workload JSONB DEFAULT '{}',
  recommendations JSONB DEFAULT '[]',
  total_issues INTEGER DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_board_summaries_hash ON ai_board_summaries(jql_hash);
