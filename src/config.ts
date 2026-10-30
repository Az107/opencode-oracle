/**
 * Configuration model and validation for the opencode-oracle plugin.
 *
 * All values come from the `options` object attached to the plugin entry in
 * `opencode.json(c)`:
 *
 * ```jsonc
 * {
 *   "plugins": [
 *     {
 *       "package": "opencode-oracle",
 *       "options": {
 *         "oracles": [
 *           { "name": "senior", "model": "anthropic/claude-opus-4-6", "description": "Deep reasoning" }
 *         ]
 *       }
 *     }
 *   ]
 * }
 * ```
 */

/** How the advisor model is invoked. */
export type OracleMode = "text" | "session";

/** A model reference the OpenCode APIs accept. */
export interface ModelSelector {
  readonly providerID: string;
  readonly id: string;
  readonly variant?: string;
}

/** A single named advisor. */
export interface OracleConfig {
  /** Unique name the main model uses to select this oracle. */
  readonly name: string;
  /** The model that acts as the advisor. */
  readonly model: ModelSelector;
  /** Short hint shown to the main model in the tool description. */
  readonly description?: string;
  /** Default mode for this oracle. Falls back to the plugin-wide mode. */
  readonly mode?: OracleMode;
  /** Session mode only: agent the advisor session runs as. */
  readonly agent?: string;
  /** Overrides the plugin-wide system prompt for this oracle. */
  readonly system?: string;
}

/** Normalized, validated plugin options. */
export interface OracleOptions {
  readonly oracles: readonly OracleConfig[];
  /** Name of the oracle used when the tool call omits `oracle`. */
  readonly defaultOracle?: string;
  /** Tool namespace; tools are registered as `<namespace>_advice` and `<namespace>_list`. */
  readonly namespace: string;
  /** System-style instructions prepended to every advisor request. */
  readonly system: string;
  /** Plugin-wide default mode. */
  readonly mode: OracleMode;
  /** Session mode only: default agent for advisor sessions. */
  readonly agent?: string;
  /** Abort advisor work after this many milliseconds. `0` disables the timeout. */
  readonly timeoutMs: number;
  /** Cap advisor calls per session. `0` means unlimited. */
  readonly maxCallsPerSession: number;
  /** Expose the tools through Code Mode instead of listing them directly. */
  readonly codemode: boolean;
  /** Optional permission action asserted before each advisor call. */
  readonly permission?: string;
  /** Keep the scratch session after a session-mode call instead of deleting it. */
  readonly keepSession: boolean;
  /** Log resolved oracles and registered tools to the OpenCode log on load. */
  readonly debug: boolean;
}

export const DEFAULT_SYSTEM = `You are an expert technical advisor consulted by another AI agent that is working inside a software repository. The other agent will act on your advice, so be decisive and specific.

Guidelines:
- Give a clear recommendation first, then the reasoning behind it.
- Point out risks, edge cases, and better alternatives when they exist.
- State your assumptions explicitly instead of asking clarifying questions.
- Prefer concrete steps, code, or examples over generalities.
- Be concise. Skip pleasantries and do not restate the question.`;

const MODES: ReadonlySet<string> = new Set(["text", "session"]);

/** Thrown when the plugin options are malformed. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(`${where} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ConfigError(`${where} must be a string.`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalMode(value: unknown, where: string): OracleMode | undefined {
  const mode = optionalString(value, where);
  if (mode === undefined) return undefined;
  if (!MODES.has(mode)) {
    throw new ConfigError(`${where} must be "text" or "session", got "${mode}".`);
  }
  return mode as OracleMode;
}

function nonNegativeNumber(value: unknown, where: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ConfigError(`${where} must be a non-negative number.`);
  }
  return value;
}

/**
 * Parses a model reference. Accepts `"provider/model"`, `{ model: "provider/model" }`,
 * or `{ providerID, id, variant? }`.
 */
export function parseModelSelector(value: unknown, where: string): ModelSelector {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const slash = trimmed.indexOf("/");
    if (slash <= 0 || slash === trimmed.length - 1) {
      throw new ConfigError(`${where} must look like "provider/model", got "${value}".`);
    }
    return { providerID: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.model !== undefined) {
      const inner = parseModelSelector(record.model, `${where}.model`);
      const variant = optionalString(record.variant, `${where}.variant`);
      return variant ? { ...inner, variant } : inner;
    }
    const providerID = optionalString(record.providerID, `${where}.providerID`);
    const id = optionalString(record.id, `${where}.id`);
    if (providerID && id) {
      const variant = optionalString(record.variant, `${where}.variant`);
      return variant ? { providerID, id, variant } : { providerID, id };
    }
  }

  throw new ConfigError(
    `${where} must be a "provider/model" string or { providerID, id, variant? }.`,
  );
}

function normalizeOracle(entry: unknown, index: number): OracleConfig {
  const record = asRecord(entry, `oracles[${index}]`);
  const model = parseModelSelector(record.model, `oracles[${index}].model`);
  const name = optionalString(record.name, `oracles[${index}].name`) ?? model.id;

  return {
    name,
    model,
    description: optionalString(record.description, `oracles[${index}].description`),
    mode: optionalMode(record.mode, `oracles[${index}].mode`),
    agent: optionalString(record.agent, `oracles[${index}].agent`),
    system: optionalString(record.system, `oracles[${index}].system`),
  };
}

/**
 * Validates and normalizes raw plugin options. Throws {@link ConfigError} on
 * malformed input; an absent `oracles` list is valid and yields no oracles.
 */
export function normalizeOptions(raw: Record<string, unknown> | undefined): OracleOptions {
  const options = raw ?? {};

  const oracles: OracleConfig[] = [];
  const rawOracles = options.oracles;
  if (rawOracles !== undefined && rawOracles !== null) {
    if (!Array.isArray(rawOracles)) {
      throw new ConfigError("`oracles` must be an array.");
    }
    rawOracles.forEach((entry, index) => oracles.push(normalizeOracle(entry, index)));
  }

  const names = new Set<string>();
  for (const oracle of oracles) {
    if (names.has(oracle.name)) {
      throw new ConfigError(`Duplicate oracle name "${oracle.name}". Oracle names must be unique.`);
    }
    names.add(oracle.name);
  }

  let defaultOracle = optionalString(options.default, "`default`");
  if (defaultOracle && !names.has(defaultOracle)) {
    throw new ConfigError(`\`default\` names oracle "${defaultOracle}", which is not defined in \`oracles\`.`);
  }
  if (!defaultOracle && oracles.length > 0) {
    defaultOracle = oracles[0].name;
  }

  return {
    oracles,
    defaultOracle,
    namespace: optionalString(options.namespace, "`namespace`") ?? "oracle",
    system: optionalString(options.system, "`system`") ?? DEFAULT_SYSTEM,
    mode: optionalMode(options.mode, "`mode`") ?? "text",
    agent: optionalString(options.agent, "`agent`"),
    timeoutMs: nonNegativeNumber(options.timeoutMs, "`timeoutMs`") ?? 120_000,
    maxCallsPerSession: nonNegativeNumber(options.maxCallsPerSession, "`maxCallsPerSession`") ?? 0,
    codemode: options.codemode === true,
    permission: optionalString(options.permission, "`permission`"),
    keepSession: options.keepSession === true,
    debug: options.debug === true,
  };
}
