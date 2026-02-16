# SkyBox Agent Guide

This file is for agentic coding tools that work in this repository.
SkyBox is a Tauri v2 desktop app with:
- Frontend: Vite + React + TypeScript + Tailwind + shadcn/ui
- Backend: Rust (Tauri commands)
- Tests: Vitest + Testing Library (jsdom)
- Local persistence: SQLite via Rust `sqlite` crate

## Rule Sources and Priority
- Mandatory constraints come from `.qoder/rules/DontBuidl.md`.
- This `AGENTS.md` is the operational playbook for implementation details.
- If rules conflict, follow the stricter rule.

## Cursor / Copilot Instructions
- Cursor rules: none found (`.cursor/rules/` and `.cursorrules` are missing).
- Copilot rules: none found (`.github/copilot-instructions.md` is missing).
- If these files are added later, include and follow them.

## Hard Constraints (Must Follow)
- Do not run local app/dev servers: no `npm run dev`, `npm run tauri:dev`, `cargo run`, etc.
- Do not run local builds/bundles/installers: no `npm run build`, `npm run tauri:build`, `cargo build`.
- Treat GitHub Actions as source of truth for validation.
- Keep changes deterministic and CI-friendly.
- Do not add machine-specific paths or local-environment assumptions.
- Never expose secrets (Telegram credentials, session blobs, tokens).
- Avoid global tooling installs only for local verification.

## Repository Layout
- Frontend app: `src/`
- Frontend tests: `src/test/` (setup in `src/test/setup.ts`)
- Tauri backend: `src-tauri/src/`
- Tauri command registry: `src-tauri/src/lib.rs`
- Database module: `src-tauri/src/db/`
- Telegram integration: `src-tauri/src/telegram/`
- API docs: `docs/API_REFERENCE.md`

## Command Reference (CI-Oriented)
Do not execute locally unless explicitly requested; use as reference for CI-compatible changes.

### Environment Used by CI
- Node: 20
- Rust: stable
- Rust MSRV pinned in `src-tauri/Cargo.toml` (`rust-version = "1.77.2"`)

### Frontend Commands (repo root)
```bash
npm install
npm run lint
npm run test
npm run test:watch
npm run build
npm run preview
```

### Run a Single Frontend Test (important)
```bash
# single file
npm run test -- src/test/example.test.ts

# single test by name (substring/regex)
npm run test -- -t "should pass"

# watch mode + file and/or name filter
npm run test:watch -- src/test/example.test.ts -t "should pass"
```

### Linting
```bash
# whole project
npm run lint

# single file
npx eslint src/pages/ExplorerPage.tsx
```

### Tauri Commands (reference only)
```bash
npm run tauri:dev
npm run tauri:build

# CI often uses:
npm run tauri build
```

### Rust Commands (from `src-tauri/`)
```bash
cargo fmt
cargo clippy
cargo test

# single Rust test (name substring)
cargo test test_name_substring
```

## TypeScript / React Style Guide

### Formatting
- Use 2-space indentation, semicolons, and double quotes.
- No Prettier config is enforced; match surrounding file style.
- Keep diffs small and avoid unrelated formatting churn.

### Imports
- Prefer `@/*` alias for app code (configured in TS/Vite/Vitest config).
- shadcn aliases from `components.json`: `@/components`, `@/components/ui`, `@/hooks`, `@/lib`.
- Use `import type` for type-only imports.
- Preferred order: React -> third-party -> `@/` aliases -> relative imports -> styles.

### Types
- TS is intentionally non-strict (`tsconfig.app.json`), but still avoid `any` when possible.
- Use `unknown` at boundaries and narrow safely.
- Keep Rust boundary payload keys in `snake_case`; map to UI `camelCase` explicitly.
- ESLint does not enforce no-unused-vars here; manually clean obvious dead code.

### Naming
- Components and React pages: `PascalCase`.
- shadcn/ui component filenames: kebab-case in `src/components/ui/`.
- Hooks: `useXxx` names.
- Variables/functions: `camelCase`.
- Types/interfaces: `PascalCase`.
- Constants: `SCREAMING_SNAKE_CASE`.

### State and UI Behavior
- Keep state updates predictable and local where possible.
- Prefer existing primitives before introducing new UI patterns.
- Preserve established visual language in existing screens.

### Error Handling and Logging
- Show user-visible failures with `toast()` (`src/hooks/use-toast.ts`).
- Frontend diagnostics can use `console.*` and/or `logger` (`src/lib/logger.ts`).
- For `invoke()` failures, treat errors as `unknown` and defensively extract `message`.
- Provide clear fallback messages instead of silent failures.

### Tailwind / Styling
- Tailwind is default; use shared tokens/utilities from `src/index.css`.
- Reuse existing utility classes such as `bg-glass`, `text-body`, `text-small`.
- Use `cn()` from `src/lib/utils.ts` for conditional classes.

### Frontend Testing
- Vitest config: `vitest.config.ts` (`jsdom`, globals, setup file).
- Prefer Testing Library queries by role/text over implementation details.
- Test user-visible behavior and flows, not internal component internals.

## Rust / Tauri Style Guide

### General
- Keep code `rustfmt` clean.
- Prefer explicit, structured errors over panics.
- Avoid new `unwrap()`/`expect()` in command paths.

### Tauri Command Boundary
- Register all commands in `src-tauri/src/lib.rs`.
- Keep command names and invoke names aligned.
- Use `snake_case` payload keys from frontend to Rust.
- Return `Result<T, XxxError>` where serialized errors expose `message`.

### Async and Concurrency
- Do not hold mutex guards across `.await`.
- Clone needed data, drop lock, then await.
- Use `tokio::task::spawn_blocking` for heavy blocking operations.

### Filesystem and Platform Safety
- Avoid absolute local paths in code.
- Guard platform-specific logic with `#[cfg(...)]` when needed.
- Keep behavior deterministic across CI environments.

### Logging and Secrets
- Use backend logging macros: `log::debug!`, `log::info!`, `log::warn!`, `log::error!`.
- Never log API keys, auth tokens, session data, or other credentials.
- `.env` is gitignored; do not commit secret-bearing files.

## API and Docs Sync
- Update `docs/API_REFERENCE.md` when adding/renaming Tauri commands or payload fields.
- Keep TS interfaces and Rust structs aligned at API boundaries.

## Versioning and Releases
- Keep versions synchronized across:
  - `VERSION`
  - `package.json`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
- Release automation is gated by commit message containing `new release`.

## Commit and PR Guidance
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.
- Optional scope format is encouraged: `feat(explorer): ...`.
- Keep commits focused and reviewable.
- Do not mix broad refactors with unrelated feature work.

## Definition of Done
- Changes are scoped and follow naming/style rules.
- Error paths are handled with actionable messages.
- Tests/lint implications are considered and CI-oriented commands documented.
- No secrets are introduced.
- Related docs are updated when APIs or workflows change.
