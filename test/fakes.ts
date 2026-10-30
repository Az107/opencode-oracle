import type { AdvisorHost, TextRequest } from "../src/host";
import type { ModelSelector } from "../src/config";
import type { MessageLike } from "../src/messages";

export interface FakeHostCalls {
  readonly texts: TextRequest[];
  readonly created: string[];
  readonly models: Array<[string, ModelSelector]>;
  readonly agents: Array<[string, string]>;
  readonly prompts: Array<[string, string]>;
  readonly waited: string[];
  readonly removed: string[];
}

export interface FakeHostOptions {
  text?: string;
  messages?: readonly MessageLike[];
  sessionID?: string;
}

export function makeFakeHost(options: FakeHostOptions = {}): { host: AdvisorHost; calls: FakeHostCalls } {
  const calls: FakeHostCalls = {
    texts: [],
    created: [],
    models: [],
    agents: [],
    prompts: [],
    waited: [],
    removed: [],
  };

  const sessionID = options.sessionID ?? "session-1";

  const host: AdvisorHost = {
    async text(request) {
      calls.texts.push(request);
      return options.text ?? "advice text";
    },
    session: {
      async create(title) {
        calls.created.push(title);
        return sessionID;
      },
      async setModel(id, model) {
        calls.models.push([id, model]);
      },
      async setAgent(id, agent) {
        calls.agents.push([id, agent]);
      },
      async prompt(id, text) {
        calls.prompts.push([id, text]);
      },
      async wait(id) {
        calls.waited.push(id);
      },
      async messages() {
        return options.messages ?? [{ type: "assistant", content: [{ type: "text", text: "session advice" }] }];
      },
      async remove(id) {
        calls.removed.push(id);
      },
    },
  };

  return { host, calls };
}
