import { describe, expect, test } from "bun:test";
import {
  ConfigError,
  DEFAULT_SYSTEM,
  normalizeOptions,
  parseModelSelector,
} from "../src/config";

describe("parseModelSelector", () => {
  test("parses provider/model strings", () => {
    expect(parseModelSelector("anthropic/claude-opus-4-6", "model")).toEqual({
      providerID: "anthropic",
      id: "claude-opus-4-6",
    });
  });

  test("keeps slashes after the first one in the model id", () => {
    expect(parseModelSelector("openrouter/meta/llama-3", "model")).toEqual({
      providerID: "openrouter",
      id: "meta/llama-3",
    });
  });

  test("accepts objects with providerID and id", () => {
    expect(parseModelSelector({ providerID: "openai", id: "gpt-5", variant: "high" }, "model")).toEqual({
      providerID: "openai",
      id: "gpt-5",
      variant: "high",
    });
  });

  test("accepts { model: string } objects with a variant", () => {
    expect(parseModelSelector({ model: "openai/gpt-5", variant: "low" }, "model")).toEqual({
      providerID: "openai",
      id: "gpt-5",
      variant: "low",
    });
  });

  test("rejects strings without a provider", () => {
    expect(() => parseModelSelector("claude-opus-4-6", "model")).toThrow(ConfigError);
  });

  test("rejects empty shapes", () => {
    expect(() => parseModelSelector({}, "model")).toThrow(ConfigError);
    expect(() => parseModelSelector(42, "model")).toThrow(ConfigError);
  });
});

describe("normalizeOptions", () => {
  test("defaults to an empty, text-mode configuration", () => {
    const options = normalizeOptions(undefined);
    expect(options.oracles).toEqual([]);
    expect(options.defaultOracle).toBeUndefined();
    expect(options.namespace).toBe("oracle");
    expect(options.system).toBe(DEFAULT_SYSTEM);
    expect(options.mode).toBe("text");
    expect(options.timeoutMs).toBe(120_000);
    expect(options.maxCallsPerSession).toBe(0);
    expect(options.codemode).toBe(false);
    expect(options.keepSession).toBe(false);
  });

  test("derives an oracle name from the model when omitted", () => {
    const options = normalizeOptions({ oracles: [{ model: "anthropic/claude-opus-4-6" }] });
    expect(options.oracles[0]?.name).toBe("claude-opus-4-6");
    expect(options.defaultOracle).toBe("claude-opus-4-6");
  });

  test("honours an explicit default and per-oracle settings", () => {
    const options = normalizeOptions({
      oracles: [
        { name: "a", model: "p/a" },
        { name: "b", model: "p/b", mode: "session", agent: "plan", description: "deep" },
      ],
      default: "b",
      namespace: "helper",
      mode: "session",
      codemode: true,
      permission: "oracle",
      keepSession: true,
      maxCallsPerSession: 3,
    });
    expect(options.defaultOracle).toBe("b");
    expect(options.namespace).toBe("helper");
    expect(options.codemode).toBe(true);
    expect(options.permission).toBe("oracle");
    expect(options.keepSession).toBe(true);
    expect(options.maxCallsPerSession).toBe(3);
    expect(options.oracles[1]).toMatchObject({
      name: "b",
      mode: "session",
      agent: "plan",
      description: "deep",
    });
  });

  test("rejects duplicate oracle names", () => {
    expect(() =>
      normalizeOptions({ oracles: [{ name: "x", model: "p/a" }, { name: "x", model: "p/b" }] }),
    ).toThrow(ConfigError);
  });

  test("rejects a default that is not defined", () => {
    expect(() => normalizeOptions({ oracles: [{ name: "a", model: "p/a" }], default: "nope" })).toThrow(
      ConfigError,
    );
  });

  test("rejects a non-array oracles value and unknown modes", () => {
    expect(() => normalizeOptions({ oracles: "nope" })).toThrow(ConfigError);
    expect(() => normalizeOptions({ oracles: [{ model: "p/a", mode: "telepathy" }] })).toThrow(ConfigError);
  });
});
