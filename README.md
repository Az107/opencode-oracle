# opencode-oracle

[![CI](https://github.com/Az107/opencode-oracle/actions/workflows/ci.yml/badge.svg)](https://github.com/Az107/opencode-oracle/actions/workflows/ci.yml)

An [OpenCode V2](https://opencode.ai/v2/docs) plugin that adds a tool letting a
model consult a **stronger, more expensive model** for advice — using it as an
oracle, reviewer, or second opinion instead of as the everyday driver.

The main agent gets two tools:

- **`oracle_advice`** — ask a named oracle a question and get its answer back.
- **`oracle_list`** — list the oracles this plugin is configured with.

You decide which models are the oracles. Nothing is auto-selected, so a cheap
daily model can call out to an expensive one only when it is actually useful.

## How it works

| Mode | What happens | When to use |
| --- | --- | --- |
| `text` (default) | Sends the question and context to the oracle with `ctx.generate.text`. No tools, no session, no history. | Design questions, trade-offs, "sanity check this plan", explanations. |
| `session` | Spawns a scratch session on the oracle model with tools so it can read files and run commands before answering, then deletes it. | "Look at the repo and tell me…", review of real code, investigations. |

The tool description is generated from your configured oracles, so the main
model knows which oracles exist, what each is good for, and the default mode.
The reply is returned as advice, not as an instruction, and is labelled with the
oracle name, model, and mode.

## Requirements

- OpenCode V2 (`v2.0.30` or newer).
- Bun 1.2 or newer, with the project's dependencies installed (`bun install`),
  so `@opencode/plugin` resolves.

## Install

1. Clone the repository and install dependencies:

   ```sh
   git clone https://github.com/Az107/opencode-oracle.git
   cd opencode-oracle
   bun install
   ```

2. Add the plugin to `opencode.jsonc` — either your global config
   (`~/.config/opencode/opencode.jsonc`) or a project config. This project lives
   outside the config directory, so use an absolute path or a `file://` URL:

   ```jsonc
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [
       {
         "package": "file:///absolute/path/to/opencode-oracle",
         "options": {
           "default": "architect",
           "oracles": [
             {
               "name": "architect",
               "model": "opencode-go/gpt-6-luna",
               "description": "Strong general reasoning. Use for hard design calls.",
               "mode": "text"
             },
             {
               "name": "reviewer",
               "model": "opencode-go/grok-4.7",
               "description": "Adversarial reviewer. Use to poke holes in a plan.",
               "mode": "session"
             }
           ]
         }
       }
     ]
   }
   ```

3. Reload OpenCode (restart it, or run `opencode reload`).

> **Local directory plugins need a root `index.ts`.** OpenCode loads
> `<plugin-dir>/index.ts` for a directory entry; it does not follow the
> package's `exports` for local paths. This repo ships one that
> re-exports `src/index.ts`, so `file://…/opencode-oracle` and
> `/absolute/path/opencode-oracle` both work. Published packages use `exports`.

Verify it loaded by setting `"debug": true`; OpenCode's log then shows
`[opencode-oracle] registered tools: oracle_list, oracle_advice`.

## Tools

### `oracle_advice`

| Input | Required | Description |
| --- | --- | --- |
| `question` | yes | The question or decision. Be specific. |
| `context` | no | Relevant code, errors, constraints, or the options being weighed. The oracle cannot see your conversation. |
| `oracle` | no | Name of the oracle to consult. Defaults to the configured default oracle. |
| `mode` | no | `"text"` or `"session"`. Falls back to the oracle's mode, then the plugin default. |

### `oracle_list`

Takes no input and lists the configured oracles, their models, and default
modes. Useful when the model is unsure who to ask.

## Options

Pass these in the plugin entry's `options`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `oracles` | `Oracle[]` | `[]` | The advisors. See below. |
| `default` | `string` | first oracle | Oracle used when a call omits `oracle`. |
| `namespace` | `string` | `"oracle"` | Tool namespace; tools appear as `<namespace>_advice` and `<namespace>_list`. |
| `system` | `string` | built-in | System-style instructions prepended to every request. |
| `mode` | `"text" \| "session"` | `"text"` | Plugin-wide default mode. |
| `agent` | `string` | session default | Session mode only: agent the advisor session runs as. |
| `timeoutMs` | `number` | `120000` | Abort advisor work after this long. `0` disables the timeout. |
| `maxCallsPerSession` | `number` | `0` | Cap advisor calls per session. `0` is unlimited. |
| `codemode` | `boolean` | `false` | `true` exposes the tools through Code Mode instead of listing them directly. |
| `permission` | `string` | — | Permission action asserted before each call, e.g. `"oracle"`. |
| `keepSession` | `boolean` | `false` | Keep the scratch session after a session-mode call. |
| `debug` | `boolean` | `false` | Log resolved oracles and registered tools on load. |

Each entry in `oracles`:

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Unique name the model uses to select it. Defaults to the model id. |
| `model` | `string` or object | `"provider/model"`, `{ providerID, id, variant? }`, or `{ model: "provider/model" }`. |
| `description` | `string` | Shown to the main model to help it choose. |
| `mode` | `"text" \| "session"` | Default mode for this oracle. |
| `agent` | `string` | Session mode only: agent override. |
| `system` | `string` | Per-oracle system prompt, overriding the plugin `system`. |

Model references must be models available at the location — check with
`opencode models`. A model that is not available is still listed, flagged as
`[model not currently available]`, and produces a clear error if called.

## Examples

**Consult the default oracle**

```text
Ask your oracle whether it's better to split this module or keep it together,
and why. Include the trade-offs you're already considering.
```

**Route to a specific oracle in session mode**

```text
Have the "reviewer" oracle read the changes in src/server.ts and point out the
risks in a session.
```

**Make it explicit when the assist is optional**

```text
Only consult an oracle if you genuinely need a second opinion; otherwise proceed.
```

**Gate it behind a permission**

```jsonc
{ "options": { "permission": "oracle", "oracles": [ /* … */ ] } }
```

The tool then asserts the `oracle` permission action (with the oracle name as
the resource) before spending money, so existing OpenCode permission rules
apply.

**Cap spending**

```jsonc
{ "options": { "maxCallsPerSession": 3, "oracles": [ /* … */ ] } }
```

## Cost and safety notes

- Oracles are expensive models. Each call is a real request on the oracle's
  provider, billed at that model's rate.
- `text` mode is a single request with no tools. `session` mode can use many
  tool turns (and tokens) because the oracle may explore the repository.
- Session mode creates a temporary session and deletes it when done
  (`keepSession: false`). While it runs it can appear in the session list.
- An oracle that cannot see your conversation will guess if `context` is thin.
  Encourage the model to pass real context.
- The plugin never runs tools itself; in text mode the oracle only reasons.
  In session mode it runs under the agent you choose, so pick a read-only agent
  if you do not want the oracle to change files.

## Development

```sh
bun install
bun run check   # typecheck, then tests
```

Run `bun run typecheck` or `bun test` individually when iterating. Tests use
Bun's built-in runner and need no OpenCode server or provider credentials.

The code is split by concern:

- `src/config.ts` — option parsing and validation
- `src/catalog.ts` — matching configured oracles against available models
- `src/prompt.ts` / `src/messages.ts` — prompt building and transcript reading
- `src/host.ts` — adapter over the plugin `Context`
- `src/oracle.ts` — text-mode and session-mode execution
- `src/tools.ts` — tool definitions and handlers
- `src/index.ts` — plugin entrypoint

## Releasing

Pushing a `v*` tag runs the release workflow. It verifies that the tag matches
`version` in `package.json`, runs typecheck and tests, creates a GitHub release,
and publishes to npm only when the `NPM_TOKEN` repository secret is set. The
package has not been published to npm yet.
