# SkyBox Agent Guide
Operational rules for coding agents working in this repository.

## Rule Priority
1. `.qoder/rules/DontBuidl.md` (mandatory)
2. `AGENTS.md` (this file)
3. Existing conventions in touched files
If rules conflict, apply the stricter requirement.

## Cursor and Copilot Rules
- Cursor rules: not found (`.cursor/rules/`, `.cursorrules` missing)
- Copilot rules: not found (`.github/copilot-instructions.md` missing)
- If these files appear later, read and follow them before coding.

## Hard Constraints
- Do not run local app/dev commands (`npm run dev`, `npm run tauri:dev`, `cargo run`).
- Do not run local build/package commands (`npm run build`, `npm run tauri:build`, `cargo build`).
- Treat CI as the source of truth for full validation.
- Never commit secrets (API keys, tokens, credentials, session blobs).
- Avoid destructive git operations unless explicitly requested.

## Repository Map
- Frontend app: `src/`
- Main explorer workflow: `src/pages/ExplorerPage.tsx`
- Shared UI components: `src/components/`
- Theme and utility styles: `src/index.css`
- Tauri backend: `src-tauri/src/`
- Command registry: `src-tauri/src/lib.rs`
- Telegram domain logic: `src-tauri/src/telegram/`
- Database domain logic: `src-tauri/src/db/`
- API documentation: `docs/API_REFERENCE.md`

## Build, Lint, and Test Commands (Reference)
Use these as reference commands. Prefer CI for final verification.

Frontend (repo root):
- Install dependencies: `npm install`
- Lint all frontend files: `npm run lint`
- Run all frontend tests: `npm run test`
- Run tests in watch mode: `npm run test:watch`

Frontend single-test workflows:
- Single test file: `npm run test -- src/pages/ExplorerPage.test.tsx`
- By test name: `npm run test -- -t "uploads files"`
- File + name in watch mode: `npm run test:watch -- src/pages/ExplorerPage.test.tsx -t "uploads files"`
- Lint one file: `npx eslint src/pages/ExplorerPage.tsx`

Rust (`src-tauri/`):
- Format: `cargo fmt`
- Lint: `cargo clippy`
- Run full Rust tests: `cargo test`

Rust single-test workflows:
- By test name substring: `cargo test test_name_substring`
- Show stdout/stderr for one test: `cargo test test_name_substring -- --nocapture`

## TypeScript and React Style
### Formatting
- 2-space indentation.
- Semicolons required.
- Double quotes preferred.
- Match nearby style when editing legacy code.
- Avoid unrelated formatting churn.

### Imports
- Prefer `@/*` aliases for app modules.
- Use `import type` for type-only imports.
- Group imports in this order:
  1) React/framework
  2) third-party packages
  3) `@/` alias imports
  4) relative imports

### Types
- TS config is permissive (`noImplicitAny: false`, `strictNullChecks: false`), but avoid introducing new `any`.
- Prefer `unknown` at boundaries and narrow safely.
- Keep `invoke` payload/response interfaces explicit.
- Guard optional and nullable fields before use.

### Naming
- Components/interfaces/types: `PascalCase`
- Variables/functions/hooks: `camelCase` (`useXxx` for hooks)
- Constants: `SCREAMING_SNAKE_CASE`
- UI primitive files in `src/components/ui/`: kebab-case

### React Patterns
- Keep effects focused and deterministic.
- Always clean up timers, subscriptions, and event listeners.
- Prefer derived values with `useMemo` instead of duplicated state.
- Keep event handlers resilient to stale closure issues.

### Error Handling
- Treat caught errors as `unknown` at boundaries.
- Convert failures into safe, actionable messages.
- Use `toast()` for user-visible failures and status updates.
- Do not silently swallow errors.

## UI and Styling Rules
- Use Tailwind utilities and shared tokens from `src/index.css`.
- Prefer semantic theme classes (`bg-secondary`, `text-muted-foreground`, `border-border`, `bg-glass`).
- Use `cn()` from `src/lib/utils.ts` for conditional classes.
- Keep UI consistent with the existing SkyBox glass theme.
- Do not add white borders or off-theme accents unless explicitly requested.
- Always use colors that match the active theme and neighboring components.
- Preserve right-click context menu styles unless explicitly asked to change them.
- For transfer/status popups near context menu UX, match that same visual language.

## Rust and Tauri Style
### General
- Keep code `rustfmt` clean.
- Prefer `Result`-based error handling over panics.
- Avoid adding new `unwrap()`/`expect()` in runtime paths.

### Command Boundary
- Register commands in `src-tauri/src/lib.rs`.
- Keep TS `invoke` names and Rust command names aligned.
- Keep payload key naming consistent across the boundary.
- Return serializable errors with clear `message` values.

### Async and Concurrency
- Do not hold mutex guards across `.await`.
- Clone needed state, release lock, then await.
- Use async-safe cancellation/progress patterns.
- Use `spawn_blocking` for blocking-heavy tasks when needed.

### Logging and Safety
- Use `log::debug!`, `log::info!`, `log::warn!`, and `log::error!` appropriately.
- Guard platform-specific code with `#[cfg(...)]`.
- Never log secrets or sensitive user data.

## API, Versioning, and Release Notes
- Update `docs/API_REFERENCE.md` when command/payload/event behavior changes.
- Keep TS and Rust API contracts aligned.
- Keep versions synchronized in:
  - `VERSION`
  - `package.json`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
- Release automation expects commit messages containing `new release`.

## Commit and PR Guidance
- Use conventional prefixes: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.
- Prefer scoped commits when useful (example: `fix(explorer): improve transfer speed sampling`).
- Keep commits focused and reviewable.
- Call out API/workflow impact clearly in PR descriptions.

## Definition of Done
- Changes follow local architecture and style.
- Error paths produce clear user-facing messages.
- Lint/test impact is considered and CI-compatible.
- No secrets or machine-specific assumptions are introduced.
- Related docs are updated when behavior/API changes.
