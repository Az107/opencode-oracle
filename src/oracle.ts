/**
 * Advisor execution: the text-mode and session-mode call paths.
 */

import { extractLastAssistantText } from "./messages";
import type { AdvisorHost } from "./host";
import type { AdviceRequest } from "./prompt";
import { buildPrompt } from "./prompt";
import type { ModelSelector, OracleMode, OracleOptions } from "./config";
import type { ResolvedOracle } from "./catalog";

export interface AdviceResult {
  readonly oracle: string;
  readonly model: ModelSelector;
  readonly mode: OracleMode;
  readonly text: string;
  /** Present in session mode. */
  readonly sessionID?: string;
}

/** Combines the tool's abort signal with an optional timeout. */
export function combineSignals(signal: AbortSignal, timeoutMs: number): AbortSignal {
  if (!timeoutMs || timeoutMs <= 0) return signal;
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

async function runText(
  host: AdvisorHost,
  oracle: ResolvedOracle,
  prompt: string,
  signal: AbortSignal,
): Promise<AdviceResult> {
  const text = await host.text({ model: oracle.model, prompt, signal });
  return { oracle: oracle.name, model: oracle.model, mode: "text", text: text.trim() };
}

async function runSession(
  host: AdvisorHost,
  oracle: ResolvedOracle,
  prompt: string,
  options: Pick<OracleOptions, "agent" | "keepSession">,
  signal: AbortSignal,
): Promise<AdviceResult> {
  const sessionID = await host.session.create(`oracle:${oracle.name}`, signal);
  try {
    await host.session.setModel(sessionID, oracle.model);
    const agent = oracle.agent ?? options.agent;
    if (agent) await host.session.setAgent(sessionID, agent);

    await host.session.prompt(sessionID, prompt, signal);
    await host.session.wait(sessionID, signal);

    const messages = await host.session.messages(sessionID);
    return {
      oracle: oracle.name,
      model: oracle.model,
      mode: "session",
      text: extractLastAssistantText(messages).trim(),
      sessionID,
    };
  } finally {
    if (!options.keepSession) {
      await host.session.remove(sessionID).catch(() => {});
    }
  }
}

/** Runs a single advisor call, selecting the oracle's effective mode. */
export async function runAdvice(
  host: AdvisorHost,
  options: Pick<OracleOptions, "agent" | "keepSession" | "mode" | "system">,
  oracle: ResolvedOracle,
  request: AdviceRequest,
  signal: AbortSignal,
): Promise<AdviceResult> {
  const mode = request.mode ?? oracle.mode ?? options.mode;
  const prompt = buildPrompt(oracle, options, { ...request, mode });

  return mode === "session"
    ? runSession(host, oracle, prompt, options, signal)
    : runText(host, oracle, prompt, signal);
}
