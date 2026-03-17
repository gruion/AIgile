import { execFile } from "child_process";
import { BaseProvider } from "./base.js";

/**
 * Claude Code provider — calls the `claude` CLI.
 *
 * Env vars:
 *   CLAUDE_CODE_PATH  — path to claude binary (default: "claude")
 *   CLAUDE_MODEL      — model to use (default: "sonnet")
 */
export class ClaudeCodeProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.claudePath = config.claudePath || process.env.CLAUDE_CODE_PATH || "claude";
    this.model = config.model || process.env.CLAUDE_MODEL || "sonnet";
  }

  async complete(prompt) {
    return new Promise((resolve, reject) => {
      const args = ["--print", "--model", this.model, prompt];

      execFile(this.claudePath, args, { timeout: 60000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Claude Code error: ${err.message}. stderr: ${stderr}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }
}
