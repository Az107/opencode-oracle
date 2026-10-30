/**
 * Prompt construction for advisor requests.
 */

import { DEFAULT_SYSTEM, type OracleConfig, type OracleOptions } from "./config";

export interface AdviceRequest {
  readonly question: string;
  readonly context?: string;
  readonly mode?: "text" | "session";
}

export function resolveSystemPrompt(
  oracle: Pick<OracleConfig, "system">,
  options: Pick<OracleOptions, "system">,
): string {
  return oracle.system ?? options.system ?? DEFAULT_SYSTEM;
}

/**
 * Builds the single prompt string handed to the advisor. It is used as-is for
 * both text generation and session prompts, so the system-style guidance lives
 * inside the prompt.
 */
export function buildPrompt(
  oracle: Pick<OracleConfig, "system">,
  options: Pick<OracleOptions, "system">,
  request: AdviceRequest,
): string {
  const sections: string[] = [];

  const system = resolveSystemPrompt(oracle, options);
  if (system) {
    sections.push(system, "");
  }

  sections.push("# Advice request", "", "## Question", request.question.trim());

  const context = request.context?.trim();
  if (context) {
    sections.push("", "## Additional context", context);
  }

  if (request.mode === "session") {
    sections.push(
      "",
      "## Working conditions",
      "You have tools available. Inspect the repository as needed before you answer. When you are finished, reply with your final answer as plain text.",
    );
  } else {
    sections.push(
      "",
      "## Working conditions",
      "You have no tools in this request. Answer from the information above and state any assumptions.",
    );
  }

  return sections.join("\n");
}
