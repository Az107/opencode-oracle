/**
 * Thin adapter over the plugin `Context` so the advisor logic can be tested
 * without a running OpenCode server.
 */

import type { Context } from "@opencode/plugin/promise/plugin";
import type { ModelSelector } from "./config";
import type { MessageLike } from "./messages";

export interface TextRequest {
  readonly model: ModelSelector;
  readonly prompt: string;
  readonly signal: AbortSignal;
}

export interface SessionHost {
  create(title: string, signal: AbortSignal): Promise<string>;
  setModel(sessionID: string, model: ModelSelector): Promise<void>;
  setAgent(sessionID: string, agent: string): Promise<void>;
  prompt(sessionID: string, text: string, signal: AbortSignal): Promise<void>;
  wait(sessionID: string, signal: AbortSignal): Promise<void>;
  messages(sessionID: string): Promise<readonly MessageLike[]>;
  remove(sessionID: string): Promise<void>;
}

/** Everything the advisor needs from OpenCode. */
export interface AdvisorHost {
  text(request: TextRequest): Promise<string>;
  readonly session: SessionHost;
}

export function createHost(ctx: Context): AdvisorHost {
  return {
    async text({ model, prompt, signal }) {
      const result = await ctx.generate.text({ prompt, model }, { signal });
      return result.text;
    },
    session: {
      async create(title, signal) {
        const session = await ctx.session.create({ title }, { signal });
        return session.id;
      },
      async setModel(sessionID, model) {
        await ctx.session.switchModel({ sessionID, model });
      },
      async setAgent(sessionID, agent) {
        await ctx.session.switchAgent({ sessionID, agent });
      },
      async prompt(sessionID, text, signal) {
        await ctx.session.prompt({ sessionID, text }, { signal });
      },
      async wait(sessionID, signal) {
        await ctx.session.wait({ sessionID }, { signal });
      },
      async messages(sessionID) {
        const messages = await ctx.session.context({ sessionID });
        return messages as unknown as readonly MessageLike[];
      },
      async remove(sessionID) {
        await ctx.session.remove({ sessionID });
      },
    },
  };
}
