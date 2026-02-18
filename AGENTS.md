# SkyBox Agent Guide

This guide is for agentic coding tools working in this repository.

SkyBox is a Tauri v2 desktop app:
- Frontend: Vite + React + TypeScript + Tailwind + shadcn/ui
- Backend: Rust commands exposed through Tauri `invoke`
- Tests: Vitest + Testing Library (`jsdom`)
- Data: SQLite via Rust `sqlite` crate

## Rule Sources and Priority

1. `.qoder/rules/DontBuidl.md` (mandatory constraints)
2. `AGENTS.md` (this file)
3. Existing repository conventions in code

If rules conflict, follow the stricter rule.

## Cursor / Copilot Rules

- Cursor rules: none found (`.cursor/rules/` and `.cursorrules` are absent).
- Copilot rules: none found (`.github/copilot-instructions.md` is absent).
- If these files are added later, include and follow them.

## Hard Constraints (Read First)

- Do not run local app/dev servers:
  - `npm run dev`
  - `npm run tauri:dev`
  - `cargo run`
- Do not run local build/package commands:
  - `npm run build`
  - `npm run tauri:build`
  - `cargo build`
- Prefer CI-first changes; GitHub Actions is the source of truth.
- Avoid machine-specific paths and local-only assumptions.
- Never commit secrets (API keys, auth/session blobs, credentials).

## Repository Map

- Frontend app: `src/`
- Frontend tests: `src/test/` and `src/**/*.{test,spec}.{ts,tsx}`
- Tauri backend: `src-tauri/src/`
- Tauri command registry: `src-tauri/src/lib.rs`
- Telegram backend module: `src-tauri/src/telegram/`
- DB backend module: `src-tauri/src/db/`
- API docs: `docs/API_REFERENCE.md`

## Build / Lint / Test Commands

Use these as reference commands unless the task explicitly asks to run them locally.

### Environment in CI

- Node: 20
- Rust: stable toolchain
- Rust MSRV: `1.77.2` (`src-tauri/Cargo.toml`)

### Frontend Commands (repo root)

```bash
npm install
npm run lint
npm run test
npm run test:watch
```

### Run a Single Frontend Test (Important)

```bash
# single test file
npm run test -- src/pages/ExplorerPage.test.tsx

# by test name pattern
npm run test -- -t "uploads files"

# watch a single file / test name
npm run test:watch -- src/pages/ExplorerPage.test.tsx -t "uploads files"
```

### Linting

```bash
# whole project
npm run lint

# single file
npx eslint src/pages/ExplorerPage.tsx
```

### Rust Commands (from `src-tauri/`)

```bash
cargo fmt
cargo clippy
cargo test
```

### Run a Single Rust Test (Important)

```bash
# by exact/substring test name
cargo test test_name_substring
```

## TypeScript / React Code Style

### Formatting

- Use 2-space indentation.
- Use semicolons.
- Use double quotes.
- No dedicated Prettier config is enforced; match nearby code style.
- Keep diffs scoped; avoid unrelated formatting churn.

### Imports

- Prefer alias imports from `@/*` for app modules.
- Use type-only imports with `import type { ... }`.
- Keep import groups consistent:
  1) React
  2) third-party packages
  3) `@/` aliases
  4) relative imports

### Types

- TypeScript is non-strict (`strict: false`), but avoid `any` in new code.
- Prefer `unknown` at boundaries and narrow safely.
- Keep API boundary types explicit (frontend interfaces for `invoke` payloads).
- Avoid unchecked casts; validate nullable/optional fields defensively.

### Naming

- Components, interfaces, and types: `PascalCase`
- Variables/functions/hooks: `camelCase` (`useXxx` for hooks)
- Constants: `SCREAMING_SNAKE_CASE`
- shadcn UI files in `src/components/ui/`: kebab-case

### React Patterns

- Prefer functional components and hooks.
- Keep state minimal and derived values in `useMemo` where useful.
- Keep handlers small; extract helper functions for repeated logic.
- Do not add comments unless logic is non-obvious.

### Error Handling (Frontend)

- Treat `invoke()` errors as `unknown` and extract `message` safely.
- Surface user-facing failures with `toast()` (`src/hooks/use-toast.ts`).
- Use clear, actionable messages.
- Do not silently swallow errors.

### UI / Styling

- Use Tailwind utility classes and shared tokens from `src/index.css`.
- Reuse existing utilities (`bg-glass`, `text-body`, `text-small`, etc.).
- Use `cn()` from `src/lib/utils.ts` for conditional classes.
- Preserve existing visual language unless the task asks for redesign.

### Testing (Frontend)

- Vitest config: `vitest.config.ts`
- Environment: `jsdom`, globals enabled, setup at `src/test/setup.ts`
- Prefer Testing Library queries by role/text over implementation details.
- Test user-visible behavior, not internal implementation.

## Rust / Tauri Code Style

### General

- Keep code `rustfmt`-friendly.
- Prefer structured `Result` errors; avoid panics in command paths.
- Avoid introducing new `unwrap()` / `expect()` in runtime flows.

### Tauri Command Boundary

- Register new commands in `src-tauri/src/lib.rs`.
- Keep command names/payloads consistent across Rust + TS.
- Use `snake_case` for Rust-side payload fields and map carefully in TS.
- Return serializable errors with clear `message` values.

### Async / Concurrency

- Do not hold mutex guards across `.await`.
- Clone required state, drop locks, then await.
- Use `tokio::task::spawn_blocking` for blocking-heavy work.

### Logging / Safety

- Use `log::debug!`, `log::info!`, `log::warn!`, `log::error!` appropriately.
- Guard platform-specific behavior with `#[cfg(...)]`.
- Never log secrets or sensitive credentials.

## API and Docs Sync

- Update `docs/API_REFERENCE.md` when adding/changing Tauri commands.
- Keep TS interfaces and Rust payload structs aligned.
- If behavior changes (cancel flow, progress events, etc.), document it.

## Versioning and Release Notes

Keep these files synchronized when version changes:
- `VERSION`
- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

Release automation expects commit messages containing `new release`.

## Commit / PR Guidance

- Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.
- Prefer scoped messages, e.g. `feat(explorer): add marquee selection`.
- Keep commits focused; avoid mixing refactor + feature + formatting.
- Mention API or workflow impacts clearly in PR descriptions.

## Definition of Done

- Changes are scoped and follow repository style.
- Error paths are handled with clear user-visible feedback.
- Lint/test impact is considered and reflected in CI-facing notes.
- No secrets or machine-specific assumptions are introduced.
- Related docs are updated when APIs or behaviors change.
