# SkyBox Agent Guide

This file is for agentic coding tools operating in this repository.

SkyBox is a Tauri v2 desktop app:
- Frontend: Vite + React + TypeScript + Tailwind + shadcn/ui
- Backend: Rust (Tauri commands)
- Tests: Vitest + Testing Library (jsdom)
- Local data: SQLite via Rust `sqlite` crate

## Rule Sources and Priority
- Mandatory constraints come from `.qoder/rules/DontBuidl.md`.
- This file provides implementation conventions and command reference.
- If rules conflict, follow the stricter rule.

## Cursor and Copilot Rules
- Cursor rules: none found (`.cursor/rules/` and `.cursorrules` are missing).
- Copilot rules: none found (`.github/copilot-instructions.md` is missing).
- If these files appear later, include and follow them.

## Hard Constraints
- Do not run local app/dev servers (`npm run dev`, `npm run tauri:dev`, `cargo run`, etc.).
- Do not run local builds/bundles/installers (`npm run build`, `npm run tauri:build`, `cargo build`).
- Treat GitHub Actions as source of truth for validation.
- Keep behavior deterministic and CI-friendly.
- Never commit secrets (tokens, credentials, session blobs).
- Avoid machine-specific assumptions and absolute local paths.

## Repository Layout
- Frontend app: `src/`
- Frontend tests: `src/test/` (`src/test/setup.ts`)
- Tauri backend: `src-tauri/src/`
- Tauri invoke registry: `src-tauri/src/lib.rs`
- Database module: `src-tauri/src/db/`
- Telegram module: `src-tauri/src/telegram/`
- API docs: `docs/API_REFERENCE.md`

## Commands (CI Reference)
Use these as reference only unless explicitly asked to run locally.

### CI Environment
- Node: 20
- Rust: stable
- Rust MSRV: `1.77.2` (`src-tauri/Cargo.toml`)

### Frontend Commands (repo root)
```bash
npm install
npm run lint
npm run test
npm run test:watch
npm run build
npm run preview
```

### Run a Single Frontend Test
```bash
# run one file
npm run test -- src/test/example.test.ts

# run by test name substring/regex
npm run test -- -t "should pass"

# watch mode with file and/or name filter
npm run test:watch -- src/test/example.test.ts -t "should pass"
```

### Linting
```bash
# whole project
npm run lint

# single file
npx eslint src/pages/ExplorerPage.tsx
```

### Rust / Tauri Commands (from `src-tauri/`)
```bash
cargo fmt
cargo clippy
cargo test

# run one Rust test by name substring
cargo test test_name_substring
```

## TypeScript and React Conventions

### Formatting
- Use 2-space indentation, semicolons, and double quotes.
- No enforced Prettier config; match surrounding style.
- Keep diffs focused and avoid unrelated formatting churn.

### Imports
- Prefer `@/*` alias imports for app code.
- shadcn aliases: `@/components`, `@/components/ui`, `@/hooks`, `@/lib`.
- Use `import type` for type-only imports.
- Preferred order: React -> third-party -> `@/` aliases -> relative imports -> styles.

### Types
- TS is non-strict (`tsconfig.app.json`), but avoid `any` when possible.
- Use `unknown` at boundaries and narrow safely.
- Keep Rust payload keys in `snake_case`; map to UI `camelCase` explicitly.
- ESLint does not enforce no-unused-vars; remove obvious dead code manually.

### Naming
- Components/pages/types/interfaces: `PascalCase`.
- Variables/functions/hooks: `camelCase` (`useXxx` for hooks).
- Constants: `SCREAMING_SNAKE_CASE`.
- shadcn ui filenames: kebab-case in `src/components/ui/`.

### Error Handling and Logging
- Surface user-visible failures with `toast()` from `src/hooks/use-toast.ts`.
- Use `console.*` and/or `logger` (`src/lib/logger.ts`) for diagnostics.
- Treat `invoke()` errors as `unknown`; defensively extract `message`.
- Prefer actionable fallback messages over silent failures.

### UI and Styling
- Tailwind is default; reuse tokens/utilities from `src/index.css`.
- Reuse existing utility classes (`bg-glass`, `text-body`, `text-small`, etc.).
- Use `cn()` from `src/lib/utils.ts` for conditional classes.
- Preserve established visual language for existing screens.

### Frontend Testing
- Vitest config: `vitest.config.ts` (jsdom, globals, setup file).
- Prefer Testing Library queries by role/text, not implementation details.
- Test behavior and user flows rather than internals.

## Rust and Tauri Conventions

### General
- Keep code `rustfmt` clean.
- Prefer structured errors over panics.
- Avoid new `unwrap()`/`expect()` in command paths.

### Command Boundary
- Register commands in `src-tauri/src/lib.rs`.
- Keep invoke names and Rust command names aligned.
- Use `snake_case` payload keys at the boundary.
- Return `Result<T, ErrorType>` with serialized `message` for UI reporting.

### Async and Concurrency
- Do not hold mutex guards across `.await`.
- Clone needed state, drop lock, then await.
- Use `tokio::task::spawn_blocking` for heavy blocking work.

### Safety and Logging
- Guard platform-specific logic with `#[cfg(...)]`.
- Use `log::debug!`, `log::info!`, `log::warn!`, `log::error!`.
- Never log secrets or credentials.

## API and Docs Sync
- Update `docs/API_REFERENCE.md` when adding/renaming Tauri commands or payload fields.
- Keep TypeScript interfaces and Rust structs aligned at API boundaries.

## Versioning and Release Notes
- Keep versions synchronized in:
  - `VERSION`
  - `package.json`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
- Release automation is gated by commit message containing `new release`.

## Commit and PR Guidance
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.
- Optional scope is encouraged (`feat(explorer): ...`).
- Keep commits focused and avoid mixing unrelated refactors/features.

## Definition of Done
- Changes are scoped and follow style rules.
- Error paths are handled with clear messages.
- Test/lint impact is considered and documented for CI.
- No secrets are introduced.
- Related docs are updated when APIs or workflows change.
