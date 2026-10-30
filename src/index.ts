/**
 * opencode-oracle — an OpenCode v2 plugin that adds `oracle_advice` (and
 * `oracle_list`) so a model can consult a stronger, more expensive model for
 * advice.
 */

import { Plugin } from "@opencode/plugin";
import { ConfigError, normalizeOptions, type OracleOptions } from "./config";
import { pickModels, resolveOracles, type AvailableModel, type ResolvedOracle } from "./catalog";
import { registerOracleTools } from "./tools";

export type { OracleOptions, OracleConfig, OracleMode, ModelSelector } from "./config";
export { DEFAULT_SYSTEM, normalizeOptions, parseModelSelector, ConfigError } from "./config";
export { resolveOracles, pickModels, modelKey } from "./catalog";
export { buildPrompt } from "./prompt";
export { extractLastAssistantText } from "./messages";
export { runAdvice, combineSignals } from "./oracle";

async function loadModels(ctx: Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]) {
  try {
    return pickModels(await ctx.model.list());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[opencode-oracle] could not list models: ${message}`);
    return [] as AvailableModel[];
  }
}

export default Plugin.define({
  id: "opencode-oracle",
  async setup(ctx) {
    let options: OracleOptions;
    let configError: string | undefined;

    try {
      options = normalizeOptions(ctx.options);
    } catch (error) {
      configError = error instanceof ConfigError ? error.message : String(error);
      console.error(`[opencode-oracle] invalid configuration: ${configError}`);
      options = normalizeOptions({});
    }

    const models = await loadModels(ctx);
    const oracles: ResolvedOracle[] = resolveOracles(options.oracles, models);

    const missing = oracles.filter((oracle) => !oracle.available);
    if (missing.length > 0) {
      console.error(
        `[opencode-oracle] these oracle models were not found for this location: ${missing
          .map((oracle) => `${oracle.name} (${oracle.model.providerID}/${oracle.model.id})`)
          .join(", ")}`,
      );
    }

    await registerOracleTools(ctx, options, oracles, configError);

    if (options.debug) {
      const tools = await ctx.tool.list();
      const names = tools
        .filter((tool) => tool.id.startsWith(`${options.namespace}_`))
        .map((tool) => tool.id);
      const described = oracles
        .map(
          (oracle) =>
            `${oracle.name}=${oracle.model.providerID}/${oracle.model.id}${oracle.available ? "" : " (unavailable)"}`,
        )
        .join(", ");
      console.error(`[opencode-oracle] registered tools: ${names.join(", ") || "(none)"}`);
      console.error(`[opencode-oracle] oracles: ${described || "(none)"}`);
    }
  },
});
