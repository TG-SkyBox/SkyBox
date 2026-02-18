# SkyBox Agent Guide
Guide for agentic coding tools operating in this repository.

## Rule Priority
1. `.qoder/rules/DontBuidl.md` (mandatory)
2. `AGENTS.md` (this file)
3. Existing project conventions
If guidance conflicts, follow the stricter rule.

## Cursor and Copilot Rules
- Cursor rules: not found (`.cursor/rules/`, `.cursorrules` missing)
- Copilot rules: not found (`.github/copilot-instructions.md` missing)
- If those files appear, include and follow them.

## Hard Constraints
- Do not run local app/dev servers (`npm run dev`, `npm run tauri:dev`, `cargo run`).
- Do not run local build/package commands (`npm run build`, `npm run tauri:build`, `cargo build`).
- Treat CI as source of truth.
- Never commit secrets (tokens, keys, credentials, session blobs).

## Repository Layout
- Frontend app: `src/`
- Frontend tests: `src/test/` and `src/**/*.{test,spec}.{ts,tsx}`
- Tauri backend: `src-tauri/src/`
- Command registry: `src-tauri/src/lib.rs`
- Telegram module: `src-tauri/src/telegram/`
- DB module: `src-tauri/src/db/`
- API docs: `docs/API_REFERENCE.md`

## Build, Lint, and Test Commands
Use as reference commands unless explicitly asked to run locally.

CI baseline:
- Node 20
- Rust stable
- Rust MSRV `1.77.2` (`src-tauri/Cargo.toml`)

Frontend commands (repo root):
```bash
npm install
npm run lint
npm run test
npm run test:watch
```

Run a single frontend test:
```bash
# single file
npm run test -- src/pages/ExplorerPage.test.tsx

# by test name filter
npm run test -- -t "uploads files"

# watch mode with file/name filter
npm run test:watch -- src/pages/ExplorerPage.test.tsx -t "uploads files"
```

Lint examples:
```bash
npm run lint
# single file
npx eslint src/pages/ExplorerPage.tsx
```

Rust commands (`src-tauri/`):
```bash
cargo fmt
cargo clippy
cargo test
```

Run a single Rust test:
```bash
cargo test test_name_substring
```

## TypeScript / React Style
Formatting:
- 2-space indentation
- semicolons
- double quotes
- no enforced Prettier config; match nearby file style
- avoid unrelated formatting churn

Imports:
- prefer `@/*` alias imports for app modules
- use `import type` for type-only imports
- preferred order:
  1) React
  2) third-party libs
  3) `@/` aliases
  4) relative imports

Types:
- TS is non-strict (`strict: false`), but avoid new `any`
- prefer `unknown` at boundaries and narrow safely
- keep `invoke` payload/response interfaces explicit
- validate nullable/optional fields before use

Naming:
- components/interfaces/types: `PascalCase`
- variables/functions/hooks: `camelCase` (`useXxx`)
- constants: `SCREAMING_SNAKE_CASE`
- shadcn UI files: kebab-case in `src/components/ui/`

Frontend error handling:
- treat command errors as `unknown`; extract `message` defensively
- use `toast()` (`src/hooks/use-toast.ts`) for user-visible failures
- prefer actionable fallback messages
- do not silently swallow failures

UI and styling:
- use Tailwind and shared utilities from `src/index.css`
- use `cn()` from `src/lib/utils.ts` for conditional classes

## Rust / Tauri Style
General:
- keep code `rustfmt` clean
- prefer structured `Result` errors over panics
- avoid introducing new `unwrap()` / `expect()` in runtime paths

Command boundary:
- register commands in `src-tauri/src/lib.rs`
- keep Rust command names and TS invoke names aligned
- use `snake_case` payload keys at Rust boundary
- return serializable errors with clear `message` text

Async/concurrency:
- do not hold mutex guards across `.await`
- clone needed data, drop lock, then await
- use `tokio::task::spawn_blocking` for blocking-heavy work

Logging and safety:
- use `log::debug!`, `log::info!`, `log::warn!`, `log::error!`
- guard platform-specific behavior with `#[cfg(...)]`
- never log secrets or sensitive user data

## API, Versioning, and Release
- update `docs/API_REFERENCE.md` for command/payload/event changes
- keep TS interfaces and Rust structs aligned at API boundaries
- keep versions synchronized in:
  - `VERSION`
  - `package.json`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
- release automation expects commit messages containing `new release`

## Commit and PR Guidance
- use conventional prefixes: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`
- prefer scoped messages (example: `feat(explorer): add marquee selection`)
- keep commits focused; avoid mixing unrelated refactors/features
- call out API/workflow impacts in PR descriptions

## Definition of Done
- changes follow repository style and architecture
- error paths have clear user-facing messages
- lint/test impact is considered for CI
- no secrets or machine-specific assumptions introduced
- related docs are updated when behavior/API changes
