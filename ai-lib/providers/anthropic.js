import { BaseProvider } from "./base.js";

/**
 * Anthropic API provider — calls Claude via REST API.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY  — API key
 *   ANTHROPIC_MODEL    — model (default: "claude-sonnet-4-20250514")
 */
export class AnthropicProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.model = config.model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
    this.baseUrl = config.baseUrl || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  }

  async complete(prompt) {
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${text}`);
    }

    const data = await res.json();
    return data.content[0].text.trim();
  }
}
