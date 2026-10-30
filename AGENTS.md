# AGENTS.md

## Commands

- `bun install` — required before typechecking or testing.
- `bun run check` — typecheck followed by the full test suite.
- `bun run typecheck` — `tsc --noEmit` over `src` and `test`.
- `bun test` — full suite (Bun runner, globals imported from `bun:test`).
- Focused: `bun test test/tools.test.ts` or `bun test -t "pattern"`.
- There is no build, lint, format, or release script. Don't invent one; the package ships TypeScript sources directly (`exports` → `./src/index.ts`).

## Layout and entrypoints

- This is an OpenCode V2 plugin (not an app), in a single package.
- `src/index.ts` is the real entrypoint (`Plugin.define`): loads models, resolves oracles, registers tools.
- Root `index.ts` must keep re-exporting `./src/index.ts`. OpenCode loads `<plugin-dir>/index.ts` for local directory plugins and does not follow `package.json` `exports`; removing it breaks local installs.
- `src/tools.ts` registers namespaced tools via `ctx.tool.transform`; `src/config.ts` parses/validates options; `src/catalog.ts` matches configured models against `ctx.model.list()`; `src/host.ts` adapts the plugin `Context`; `src/oracle.ts` implements the text/session call paths.
- `@opencode/plugin` is pinned to `2.0.30` and uses the Promise API (`@opencode/plugin/promise/plugin`). Don't switch to the effect API.

## Testing

- Tests are hermetic: no OpenCode server, providers, or network. Use `test/fakes.ts` (`makeFakeHost`) and target `AdvisorHost`, not a real `Context`.
- New advisor behavior belongs behind `AdvisorHost` (`src/host.ts`) so it is testable; exercise tool behavior through `executeAdvice` with `AdviceDeps`.
- Tests intentionally use model IDs that may not be installed. `available: false` only marks display/unavailable-at-call-time; it is not a config error.
- `pickModels` accepts both a bare array and `{ data }` from `ctx.model.list()`; keep that compatibility when touching model loading.

## Non-obvious behavior to preserve

- Config errors are non-fatal: `setup` catches `ConfigError`, logs it, falls back to empty options, and still registers tools whose descriptions expose the error.
- Aborts must propagate (`executeAdviceFor` rethrows them); other oracle failures become readable tool error text instead of thrown errors.
- Permission is asserted before incrementing the per-session call counter, so a denied call spends nothing.
- Session mode must remove its scratch session in `finally` unless `keepSession` is true; text mode must never create a session.
- Tool names come from `namespace` (default `oracle` → `oracle_advice`, `oracle_list`); both tools receive the `codemode` flag.
- System guidance is embedded in the single prompt string because `generate.text` receives only `prompt` and `model`. Session output is the last assistant text from `ctx.session.context()`, so tool-only assistant messages must be skipped.

## CI and releases

- `.github/workflows/ci.yml` runs install, typecheck, and tests on pushes to `main` and on pull requests.
- `.github/workflows/release.yml` runs on `v*` tags: verifies the package, publishes to npm only when the `NPM_TOKEN` secret exists, then creates a GitHub release. Do not push a tag unless a release is intended.
- Keep the Bun version in both workflows in sync with `packageManager` in `package.json`.

## Docs

`README.md` is the user-facing reference for options, tools, and install/config. Update it when adding or changing public options or tool behavior.
