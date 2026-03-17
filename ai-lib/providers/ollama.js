import { BaseProvider } from "./base.js";

/**
 * Ollama provider — calls a local Ollama instance.
 *
 * Env vars:
 *   OLLAMA_BASE_URL  — base URL (default: "http://localhost:11434")
 *   OLLAMA_MODEL     — model (default: "llama3")
 */
export class OllamaProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    this.model = config.model || process.env.OLLAMA_MODEL || "llama3";
  }

  async complete(prompt) {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama ${res.status}: ${text}`);
    }

    const data = await res.json();
    return data.response.trim();
  }
}
