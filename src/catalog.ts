/**
 * Resolves configured oracles against the models that are actually available,
 * so tool output can show a friendly model name and flag clobbered configs.
 */

import type { OracleConfig } from "./config";

/** The subset of `Model.Info` this plugin reads. */
export interface AvailableModel {
  readonly id: string;
  readonly modelID: string;
  readonly providerID: string;
  readonly name: string;
  readonly cost?: ReadonlyArray<{ readonly input: number; readonly output: number }>;
  readonly limit?: { readonly context: number };
}

/** An oracle plus the result of matching it against available models. */
export interface ResolvedOracle extends OracleConfig {
  /** Friendly model name when the model is available. */
  readonly displayName?: string;
  /** Whether the configured model currently exists for this location. */
  readonly available: boolean;
}

/**
 * `ctx.model.list()` returns `{ location, data }` in current builds, but older
 * builds returned the array directly. Accept either shape.
 */
export function pickModels(listed: unknown): AvailableModel[] {
  const data = Array.isArray(listed) ? listed : (listed as { data?: unknown } | undefined)?.data;
  return Array.isArray(data) ? (data as AvailableModel[]) : [];
}

export function modelKey(model: { providerID: string; id: string }): string {
  return `${model.providerID}/${model.id}`;
}

export function resolveOracles(
  oracles: readonly OracleConfig[],
  models: readonly AvailableModel[],
): ResolvedOracle[] {
  const byKey = new Map<string, AvailableModel>();
  for (const model of models) {
    byKey.set(`${model.providerID}/${model.modelID}`, model);
    byKey.set(`${model.providerID}/${model.id}`, model);
    byKey.set(model.id, model);
  }

  return oracles.map((oracle) => {
    const match =
      byKey.get(`${oracle.model.providerID}/${oracle.model.id}`) ?? byKey.get(oracle.model.id);
    return {
      ...oracle,
      displayName: match?.name,
      available: match !== undefined,
    };
  });
}
