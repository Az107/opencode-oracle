import { describe, expect, test } from "bun:test";
import {
  buildAdviceDescription,
  executeAdvice,
  formatOracleReport,
  type AdviceDeps,
  type ToolCallContext,
} from "../src/tools";
import { normalizeOptions } from "../src/config";
import type { ResolvedOracle } from "../src/catalog";
import { makeFakeHost } from "./fakes";

const senior: ResolvedOracle = {
  name: "senior",
  model: { providerID: "anthropic", id: "claude-opus-4-6" },
  description: "Deep reasoning",
  available: true,
};

function oracles(): ResolvedOracle[] {
  return [senior, { name: "fast", model: { providerID: "openai", id: "gpt-5" }, available: false }];
}

function makeDeps(overrides: Partial<AdviceDeps> = {}): AdviceDeps {
  const { host } = makeFakeHost({ text: "  the answer  " });
  return {
    host,
    options: normalizeOptions({ oracles: [{ name: "senior", model: "anthropic/claude-opus-4-6" }] }),
    oracles: oracles(),
    counters: new Map(),
    ...overrides,
  };
}

function makeToolContext(opts: { reject?: boolean } = {}): {
  context: ToolCallContext;
  progress: string[];
  permissions: Array<{ action: string; resource: string }>;
} {
  const progress: string[] = [];
  const permissions: Array<{ action: string; resource: string }> = [];
  const controller = new AbortController();
  const context: ToolCallContext = {
    sessionID: "s1",
    agent: "build",
    messageID: "m1",
    callID: "c1",
    signal: controller.signal,
    async progress(status) {
      progress.push(status);
    },
    async assertPermission(input) {
      permissions.push(input);
      if (opts.reject) throw new Error("the user denied the request");
    },
  };
  return { context, progress, permissions };
}

describe("descriptions", () => {
  test("lists oracles, the default, and modes", () => {
    const options = normalizeOptions({
      oracles: [{ name: "senior", model: "anthropic/claude-opus-4-6", description: "Deep reasoning" }],
    });
    const description = buildAdviceDescription(oracles(), options);
    expect(description).toContain('"senior" — anthropic/claude-opus-4-6');
    expect(description).toContain("Deep reasoning");
    expect(description).toContain("[model not currently available]");
    expect(description).toContain('the default is "senior"');
  });

  test("explains when nothing is configured", () => {
    const options = normalizeOptions({});
    expect(buildAdviceDescription([], options)).toContain("No advisor oracles are configured");
    expect(formatOracleReport([], options)).toContain("No oracles are configured");
  });

  test("surfaces configuration errors", () => {
    const options = normalizeOptions({});
    expect(buildAdviceDescription([], options, "bad config")).toContain("bad config");
    expect(formatOracleReport([], options, "bad config")).toContain("Configuration error");
  });
});

describe("executeAdvice", () => {
  test("returns advice from the default oracle", async () => {
    const deps = makeDeps();
    const { context, progress } = makeToolContext();
    const result = await executeAdvice(deps, { question: "Which approach?" }, context);

    expect(result.content).toContain("Advice from \"senior\"");
    expect(result.content).toContain("the answer");
    expect(result.metadata).toMatchObject({ oracle: "senior", model: "anthropic/claude-opus-4-6", mode: "text" });
    expect(progress).toHaveLength(1);
    expect(deps.counters.get("s1")).toBe(1);
  });

  test("routes to a named oracle", async () => {
    const { host, calls } = makeFakeHost({ text: "fast answer" });
    const deps = makeDeps({ host });
    const { context } = makeToolContext();
    const result = await executeAdvice(deps, { question: "Q", oracle: "fast" }, context);
    expect(result.metadata).toMatchObject({ oracle: "fast", model: "openai/gpt-5" });
    expect(calls.texts[0]?.model).toEqual({ providerID: "openai", id: "gpt-5" });
  });

  test("rejects unknown oracle names and lists the valid ones", async () => {
    const deps = makeDeps();
    const { context } = makeToolContext();
    const result = await executeAdvice(deps, { question: "Q", oracle: "ghost" }, context);
    expect(result.content).toContain('Unknown oracle "ghost"');
    expect(result.content).toContain('"senior"');
  });

  test("requires a question", async () => {
    const deps = makeDeps();
    const { context } = makeToolContext();
    const result = await executeAdvice(deps, {}, context);
    expect(result.content).toContain("`question` field is required");
  });

  test("reports an empty configuration", async () => {
    const deps = makeDeps({ oracles: [] });
    const { context } = makeToolContext();
    const result = await executeAdvice(deps, { question: "Q" }, context);
    expect(result.content).toContain("No oracles are configured");
  });

  test("reports configuration errors", async () => {
    const deps = makeDeps({ configError: "oracles[0] is broken" });
    const { context } = makeToolContext();
    const result = await executeAdvice(deps, { question: "Q" }, context);
    expect(result.content).toContain("misconfigured");
    expect(result.content).toContain("oracles[0] is broken");
  });

  test("enforces the per-session call budget", async () => {
    const deps = makeDeps({
      options: normalizeOptions({
        oracles: [{ name: "senior", model: "anthropic/claude-opus-4-6" }],
        maxCallsPerSession: 1,
      }),
    });
    const { context } = makeToolContext();
    await executeAdvice(deps, { question: "Q1" }, context);
    const second = await executeAdvice(deps, { question: "Q2" }, context);
    expect(second.content).toContain("budget reached");
  });

  test("asserts the configured permission before calling the oracle", async () => {
    const deps = makeDeps({
      options: normalizeOptions({
        oracles: [{ name: "senior", model: "anthropic/claude-opus-4-6" }],
        permission: "oracle",
      }),
    });
    const { context, permissions } = makeToolContext();
    await executeAdvice(deps, { question: "Q" }, context);
    expect(permissions).toEqual([{ action: "oracle", resource: "senior" }]);
  });

  test("propagates a permission rejection", async () => {
    const deps = makeDeps({
      options: normalizeOptions({
        oracles: [{ name: "senior", model: "anthropic/claude-opus-4-6" }],
        permission: "oracle",
      }),
    });
    const { context } = makeToolContext({ reject: true });
    await expect(executeAdvice(deps, { question: "Q" }, context)).rejects.toThrow("denied");
  });

  test("turns oracle failures into readable output", async () => {
    const { host } = makeFakeHost();
    const failing = { ...host, async text() { throw new Error("provider exploded"); } };
    const deps = makeDeps({ host: failing });
    const { context } = makeToolContext();
    const result = await executeAdvice(deps, { question: "Q" }, context);
    expect(result.content).toContain("provider exploded");
  });

  test("rethrows aborts so interrupts are not swallowed", async () => {
    const { host } = makeFakeHost();
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const failing = { ...host, async text() { throw abortError; } };
    const deps = makeDeps({ host: failing });
    const { context } = makeToolContext();
    await expect(executeAdvice(deps, { question: "Q" }, context)).rejects.toThrow("aborted");
  });
});
