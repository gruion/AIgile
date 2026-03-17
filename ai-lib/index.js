/**
 * Pluggable AI Provider
 *
 * Switch provider by setting AI_PROVIDER env var:
 *   - "claude-code"  → calls Claude Code CLI (default)
 *   - "anthropic"    → calls Anthropic API directly
 *   - "openai"       → calls OpenAI API
 *   - "ollama"       → calls local Ollama instance
 *   - "mock"         → returns mock data (for testing)
 *
 * Each provider implements the same interface:
 *   summarizeTicket(ticketData) → { tldr, status_insight, action_needed, risk_level, risk_reason, staleness_days }
 *   summarizeBoard(ticketsData) → { executive_summary, blocked_tickets, stale_tickets, team_workload, recommendations }
 */

import { ClaudeCodeProvider } from "./providers/claude-code.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { OllamaProvider } from "./providers/ollama.js";
import { MockProvider } from "./providers/mock.js";

const PROVIDERS = {
  "claude-code": ClaudeCodeProvider,
  anthropic: AnthropicProvider,
  openai: OpenAIProvider,
  ollama: OllamaProvider,
  mock: MockProvider,
};

let _instance = null;

export function getAIProvider(config = {}) {
  if (_instance) return _instance;

  const providerName = config.provider || process.env.AI_PROVIDER || "claude-code";
  const ProviderClass = PROVIDERS[providerName];

  if (!ProviderClass) {
    throw new Error(
      `Unknown AI provider: "${providerName}". Available: ${Object.keys(PROVIDERS).join(", ")}`
    );
  }

  _instance = new ProviderClass(config);
  console.log(`[AI] Using provider: ${providerName}`);
  return _instance;
}

export function resetProvider() {
  _instance = null;
}

// Re-export for direct import
export { ClaudeCodeProvider, AnthropicProvider, OpenAIProvider, OllamaProvider, MockProvider };
