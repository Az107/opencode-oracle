/**
 * Helpers for reading advisor output out of a session transcript.
 */

export interface MessagePart {
  readonly type: string;
  readonly text?: string;
}

export interface MessageLike {
  readonly type: string;
  readonly content?: ReadonlyArray<MessagePart>;
}

/**
 * Returns the assistant text from the newest assistant message that contains
 * any text parts. Returns `""` when the transcript has no assistant text.
 */
export function extractLastAssistantText(messages: readonly MessageLike[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "assistant" || !Array.isArray(message.content)) continue;

    const text = message.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("\n")
      .trim();

    if (text) return text;
  }
  return "";
}
