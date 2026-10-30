import { describe, expect, test } from "bun:test";
import { buildPrompt, resolveSystemPrompt } from "../src/prompt";
import { extractLastAssistantText } from "../src/messages";

describe("resolveSystemPrompt", () => {
  test("prefers the oracle-level system prompt", () => {
    expect(resolveSystemPrompt({ system: "oracle" }, { system: "plugin" })).toBe("oracle");
  });

  test("falls back to the plugin-level prompt", () => {
    expect(resolveSystemPrompt({}, { system: "plugin" })).toBe("plugin");
  });
});

describe("buildPrompt", () => {
  test("includes system, question, context, and mode guidance", () => {
    const prompt = buildPrompt({}, { system: "SYSTEM" }, {
      question: "Should I refactor?",
      context: "the module is 400 lines",
      mode: "text",
    });
    expect(prompt).toContain("SYSTEM");
    expect(prompt).toContain("## Question");
    expect(prompt).toContain("Should I refactor?");
    expect(prompt).toContain("## Additional context");
    expect(prompt).toContain("the module is 400 lines");
    expect(prompt).toContain("You have no tools");
  });

  test("omits the context section when there is none", () => {
    const prompt = buildPrompt({}, { system: "" }, { question: "Q", mode: "text" });
    expect(prompt).not.toContain("## Additional context");
  });

  test("tells the session-mode oracle that tools are available", () => {
    const prompt = buildPrompt({}, { system: "" }, { question: "Q", mode: "session" });
    expect(prompt).toContain("You have tools available");
  });
});

describe("extractLastAssistantText", () => {
  test("returns text from the newest assistant message with content", () => {
    const messages = [
      { type: "user" },
      { type: "assistant", content: [{ type: "text", text: "first" }] },
      { type: "assistant", content: [{ type: "reasoning", text: "think" }, { type: "text", text: "second" }] },
    ];
    expect(extractLastAssistantText(messages)).toBe("second");
  });

  test("skips assistant messages that only carry tool parts", () => {
    const messages = [
      { type: "assistant", content: [{ type: "text", text: "answer" }] },
      { type: "assistant", content: [{ type: "tool" }] },
    ];
    expect(extractLastAssistantText(messages)).toBe("answer");
  });

  test("returns an empty string when there is no assistant text", () => {
    expect(extractLastAssistantText([{ type: "user" }])).toBe("");
  });
});
