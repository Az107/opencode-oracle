/**
 * Tool definitions and execution for the oracle plugin.
 */

import type { Context } from "@opencode/plugin/promise/plugin";
import { createHost, type AdvisorHost } from "./host";
import type { ResolvedOracle } from "./catalog";
import { modelKey } from "./catalog";
import { combineSignals, runAdvice, type AdviceResult } from "./oracle";
import type { OracleMode, OracleOptions } from "./config";

/** Raw tool input, validated at execution time. */
export interface AdviceInput {
  readonly question?: unknown;
  readonly context?: unknown;
  readonly oracle?: unknown;
  readonly mode?: unknown;
}

/** The slice of `Tool.Context` the advice handler needs. */
export interface ToolCallContext {
  readonly sessionID: string;
  readonly agent: string;
  readonly messageID: string;
  readonly callID: string;
  readonly signal: AbortSignal;
  progress(status: string): Promise<void>;
  /** Evaluates permission rules; a rejection must propagate. */
  assertPermission(input: { action: string; resource: string }): Promise<void>;
}

export interface AdviceDeps {
  readonly host: AdvisorHost;
  readonly options: OracleOptions;
  readonly oracles: readonly ResolvedOracle[];
  readonly configError?: string;
  /** Per-session advisor call counts. */
  readonly counters: Map<string, number>;
}

export const ADVICE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    question: {
      type: "string",
      description: "The question or decision you want advice on. Be specific and self-contained.",
    },
    context: {
      type: "string",
      description:
        "Supporting material the oracle needs: relevant code, error output, constraints, or options you are weighing. The oracle cannot see your conversation, so include anything important.",
    },
    oracle: {
      type: "string",
      description: "Name of the oracle to consult. Omit to use the default oracle.",
    },
    mode: {
      type: "string",
      enum: ["text", "session"],
      description:
        'How to consult the oracle. "text" answers from the information you provide; "session" lets the oracle read files and run commands first.',
    },
  },
  required: ["question"],
  additionalProperties: false,
} as const;

export const LIST_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

function defaultMode(oracle: ResolvedOracle, options: OracleOptions): OracleMode {
  return oracle.mode ?? options.mode;
}

function formatOracleLine(oracle: ResolvedOracle, options: OracleOptions): string {
  const parts = [`- "${oracle.name}" — ${modelKey(oracle.model)} (${defaultMode(oracle, options)})`];
  if (oracle.description) parts.push(`: ${oracle.description}`);
  if (!oracle.available) parts.push(" [model not currently available]");
  return parts.join("");
}

export function buildAdviceDescription(
  oracles: readonly ResolvedOracle[],
  options: OracleOptions,
  configError?: string,
): string {
  if (configError) {
    return `The oracle plugin is misconfigured, so this tool cannot run: ${configError}`;
  }
  if (oracles.length === 0) {
    return "No advisor oracles are configured for this plugin. Add an `oracles` list to the opencode-oracle plugin options.";
  }

  return [
    'Ask a stronger, more expensive AI model (an "oracle") for advice or a second opinion.',
    "",
    "Use this when you are stuck, weighing a design trade-off, unsure which approach is best, or want a review before committing to a plan, a large edit, or an irreversible action. Give the oracle a clear question and the context it needs (relevant code, errors, constraints); it cannot see your conversation. Treat the reply as advice, not as an order.",
    "",
    `Oracles (pass \`oracle\` to choose; the default is "${options.defaultOracle}"):`,
    ...oracles.map((oracle) => formatOracleLine(oracle, options)),
    "",
    "Modes:",
    '- "text" (default): the oracle answers from the question and context you provide. Fast, no tools.',
    '- "session": the oracle runs in a scratch session with tools, so it can read files and run commands before answering. Slower and more expensive.',
  ].join("\n");
}

export function formatOracleReport(
  oracles: readonly ResolvedOracle[],
  options: OracleOptions,
  configError?: string,
): string {
  if (configError) return `Configuration error: ${configError}`;
  if (oracles.length === 0) {
    return "No oracles are configured. Add an `oracles` list to the opencode-oracle plugin options.";
  }
  return [
    `Configured oracles (default: "${options.defaultOracle}"):`,
    ...oracles.map((oracle) => formatOracleLine(oracle, options)),
  ].join("\n");
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  const name = (error as { name?: string } | undefined)?.name;
  return name === "AbortError";
}

export function formatAdvice(result: AdviceResult): string {
  const body = result.text.trim() || "(the oracle returned no text)";
  const label = `Advice from "${result.oracle}" (${modelKey(result.model)}, ${result.mode} mode)`;
  return `${label}:\n\n${body}`;
}

function invalid(message: string): { content: string; metadata: { error: true } } {
  return { content: message, metadata: { error: true } };
}

/** Runs one advice call against an already-resolved oracle. */
export async function executeAdviceFor(
  deps: AdviceDeps,
  oracle: ResolvedOracle,
  input: AdviceInput,
  context: ToolCallContext,
): Promise<{ content: string; metadata: Record<string, unknown> }> {
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question) {
    return invalid("The `question` field is required and must be a non-empty string.");
  }

  const mode: OracleMode | undefined =
    input.mode === "text" || input.mode === "session" ? input.mode : undefined;

  const used = deps.counters.get(context.sessionID) ?? 0;
  if (deps.options.maxCallsPerSession > 0 && used >= deps.options.maxCallsPerSession) {
    return invalid(
      `Oracle call budget reached for this session (${deps.options.maxCallsPerSession}). Proceed with what you have.`,
    );
  }

  await context.progress(`consulting oracle "${oracle.name}" (${mode ?? defaultMode(oracle, deps.options)})`);

  if (deps.options.permission) {
    await context.assertPermission({ action: deps.options.permission, resource: oracle.name });
  }

  deps.counters.set(context.sessionID, used + 1);

  const signal = combineSignals(context.signal, deps.options.timeoutMs);
  const adviceContext = typeof input.context === "string" ? input.context : undefined;

  try {
    const result = await runAdvice(
      deps.host,
      deps.options,
      oracle,
      { question, context: adviceContext, mode: mode ?? defaultMode(oracle, deps.options) },
      signal,
    );
    return {
      content: formatAdvice(result),
      metadata: {
        oracle: result.oracle,
        model: modelKey(result.model),
        mode: result.mode,
        ...(result.sessionID ? { sessionID: result.sessionID } : {}),
      },
    };
  } catch (error) {
    if (isAbort(error, context.signal)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return invalid(`The oracle "${oracle.name}" failed: ${message}`);
  }
}

/** Resolves the requested oracle and runs the advice call. */
export async function executeAdvice(
  deps: AdviceDeps,
  input: AdviceInput,
  context: ToolCallContext,
): Promise<{ content: string; metadata: Record<string, unknown> }> {
  if (deps.configError) {
    return invalid(`The oracle plugin is misconfigured: ${deps.configError}`);
  }
  if (deps.oracles.length === 0) {
    return invalid(
      "No oracles are configured. Add an `oracles` list to the opencode-oracle plugin options, then reload OpenCode.",
    );
  }

  const requested = typeof input.oracle === "string" ? input.oracle.trim() : "";
  const name = requested || deps.options.defaultOracle;
  const oracle = name ? deps.oracles.find((candidate) => candidate.name === name) : deps.oracles[0];
  if (!oracle) {
    const names = deps.oracles.map((candidate) => `"${candidate.name}"`).join(", ");
    return invalid(`Unknown oracle "${requested}". Available oracles: ${names}.`);
  }

  return executeAdviceFor(deps, oracle, input, context);
}

/** Creates the advisor host from the plugin context and registers both tools. */
export async function registerOracleTools(
  ctx: Context,
  options: OracleOptions,
  oracles: readonly ResolvedOracle[],
  configError?: string,
): Promise<void> {
  const host = createHost(ctx);
  const counters = new Map<string, number>();
  const deps: AdviceDeps = { host, options, oracles, configError, counters };

  await ctx.tool.transform((editor) => {
    editor.namespace({
      name: options.namespace,
      description: "Consult a more capable model for advice on hard decisions.",
    });

    editor.add({
      name: "list",
      description:
        "List the advisor oracles this plugin is configured with, including their models and default modes. Use it when you are unsure which oracle to ask.",
      input: LIST_INPUT_SCHEMA,
      options: { namespace: options.namespace, codemode: options.codemode },
      execute: async () => ({ content: formatOracleReport(oracles, options, configError) }),
    });

    editor.add({
      name: "advice",
      description: buildAdviceDescription(oracles, options, configError),
      input: ADVICE_INPUT_SCHEMA,
      options: { namespace: options.namespace, codemode: options.codemode },
      execute: async (raw, context) => {
        const toolContext: ToolCallContext = {
          sessionID: context.sessionID,
          agent: context.agent,
          messageID: context.messageID,
          callID: context.id,
          signal: context.signal,
          progress: (status) => context.progress({ status }),
          assertPermission: async ({ action, resource }) => {
            await ctx.permission.assert({
              sessionID: context.sessionID,
              agent: context.agent,
              source: { type: "tool", messageID: context.messageID, id: context.id },
              action,
              resources: [resource],
              save: [resource],
            });
          },
        };
        return executeAdvice(deps, (raw ?? {}) as AdviceInput, toolContext);
      },
    });
  });
}
