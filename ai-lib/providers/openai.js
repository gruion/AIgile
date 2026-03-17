import { BaseProvider } from "./base.js";

/**
 * OpenAI API provider.
 *
 * Env vars:
 *   OPENAI_API_KEY   — API key
 *   OPENAI_MODEL     — model (default: "gpt-4o")
 *   OPENAI_BASE_URL  — base URL (default: OpenAI, change for Azure/compatible)
 */
export class OpenAIProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.model = config.model || process.env.OPENAI_MODEL || "gpt-4o";
    this.baseUrl = config.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  }

  async complete(prompt) {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY not set");

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API ${res.status}: ${text}`);
    }

    const data = await res.json();
    return data.choices[0].message.content.trim();
  }
}
