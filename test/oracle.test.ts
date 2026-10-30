import { describe, expect, test } from "bun:test";
import { runAdvice, combineSignals } from "../src/oracle";
import { normalizeOptions } from "../src/config";
import type { ResolvedOracle } from "../src/catalog";
import { makeFakeHost } from "./fakes";

const senior: ResolvedOracle = {
  name: "senior",
  model: { providerID: "anthropic", id: "claude-opus-4-6" },
  available: true,
};

function options(overrides: Record<string, unknown> = {}) {
  return normalizeOptions({ oracles: [{ name: "senior", model: "anthropic/claude-opus-4-6" }], ...overrides });
}

const signal = new AbortController().signal;

describe("combineSignals", () => {
  test("returns the original signal when the timeout is disabled", () => {
    expect(combineSignals(signal, 0)).toBe(signal);
  });

  test("combines with a timeout when set", () => {
    const combined = combineSignals(signal, 1_000);
    expect(combined).not.toBe(signal);
    expect(combined.aborted).toBe(false);
  });
});

describe("runAdvice", () => {
  test("text mode calls generate with the configured model and returns trimmed text", async () => {
    const { host, calls } = makeFakeHost({ text: "  do the simple thing  " });
    const result = await runAdvice(
      host,
      options(),
      senior,
      { question: "Which approach?", mode: "text" },
      signal,
    );

    expect(result.mode).toBe("text");
    expect(result.text).toBe("do the simple thing");
    expect(result.sessionID).toBeUndefined();
    expect(calls.texts).toHaveLength(1);
    expect(calls.texts[0]?.model).toEqual(senior.model);
    expect(calls.texts[0]?.prompt).toContain("Which approach?");
    expect(calls.created).toHaveLength(0);
  });

  test("session mode creates, configures, prompts, waits, reads, and removes a session", async () => {
    const { host, calls } = makeFakeHost({ sessionID: "s-42" });
    const result = await runAdvice(
      host,
      options({ keepSession: false }),
      senior,
      { question: "Investigate the repo", mode: "session" },
      signal,
    );

    expect(result.mode).toBe("session");
    expect(result.text).toBe("session advice");
    expect(result.sessionID).toBe("s-42");
    expect(calls.created).toEqual(["oracle:senior"]);
    expect(calls.models).toEqual([["s-42", senior.model]]);
    expect(calls.prompts[0]?.[0]).toBe("s-42");
    expect(calls.waited).toEqual(["s-42"]);
    expect(calls.removed).toEqual(["s-42"]);
    expect(calls.texts).toHaveLength(0);
    expect(calls.agents).toHaveLength(0);
  });

  test("keeps the session when keepSession is true", async () => {
    const { host, calls } = makeFakeHost();
    await runAdvice(host, options({ keepSession: true }), senior, { question: "Q", mode: "session" }, signal);
    expect(calls.removed).toHaveLength(0);
  });

  test("uses the oracle agent when configured", async () => {
    const { host, calls } = makeFakeHost();
    const withAgent: ResolvedOracle = { ...senior, agent: "plan" };
    await runAdvice(host, options(), withAgent, { question: "Q", mode: "session" }, signal);
    expect(calls.agents).toEqual([["session-1", "plan"]]);
  });

  test("the oracle's own mode is used when the request omits one", async () => {
    const { host } = makeFakeHost();
    const sessionOracle: ResolvedOracle = { ...senior, mode: "session" };
    const result = await runAdvice(host, options(), sessionOracle, { question: "Q" }, signal);
    expect(result.mode).toBe("session");
  });
});
