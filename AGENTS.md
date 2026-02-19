# SkyBox Agent Guide
Operational guide for agentic coding tools working in this repository.

## Rule Priority
1. `.qoder/rules/DontBuidl.md` (mandatory)
2. `AGENTS.md` (this file)
3. Existing local conventions in touched files
If guidance conflicts, follow the stricter rule.

## Cursor and Copilot Rules
- Cursor rules: not found (`.cursor/rules/`, `.cursorrules` are missing)
- Copilot rules: not found (`.github/copilot-instructions.md` is missing)
- If any of these files appear later, read them first and merge their requirements into your plan.

## Hard Constraints
- Do not run local app/dev commands (`npm run dev`, `npm run tauri:dev`, `cargo run`).
- Do not run local build/package commands (`npm run build`, `npm run tauri:build`, `cargo build`).
- CI is the source of truth for full validation.
- Never commit secrets (tokens, keys, session files, credentials, private IDs).
- Avoid destructive git operations unless explicitly requested.

## Repository Map
- Frontend app: `src/`
- Main page and workflow hub: `src/pages/ExplorerPage.tsx`
- Shared UI components: `src/components/`
- Tailwind/theme tokens: `src/index.css`
- Tauri backend: `src-tauri/src/`
- Tauri command registration: `src-tauri/src/lib.rs`
- Telegram logic: `src-tauri/src/telegram/`
- Database logic: `src-tauri/src/db/`
- API docs: `docs/API_REFERENCE.md`

## Toolchain Baseline
- Node.js: 20 (CI baseline)
- Rust: stable, MSRV `1.77.2` (`src-tauri/Cargo.toml`)
- Frontend test runner: Vitest
- Frontend linting: ESLint (`eslint.config.js`)

## Build, Lint, and Test Commands (Reference)
Use these as documented commands. Prefer CI for final verification.

Frontend commands (run from repo root):
```bash
npm install
npm run lint
npm run test
npm run test:watch
```

Run a single frontend test file:
```bash
npm run test -- src/pages/ExplorerPage.test.tsx
```

Run frontend tests filtered by test name:
```bash
npm run test -- -t "uploads files"
```

Run single file + test name in watch mode:
```bash
npm run test:watch -- src/pages/ExplorerPage.test.tsx -t "uploads files"
```

Lint examples:
```bash
npm run lint
npx eslint src/pages/ExplorerPage.tsx
```

Rust commands (run from `src-tauri/`):
```bash
cargo fmt
cargo clippy
cargo test
```

Run a single Rust test (name filter):
```bash
cargo test test_name_substring
```

Run Rust test with output shown:
```bash
cargo test test_name_substring -- --nocapture
```

## TypeScript and React Conventions
### Formatting
- Use 2-space indentation.
- Use semicolons.
- Use double quotes.
- Match surrounding style when touching legacy blocks.
- Avoid unrelated reformatting churn.

### Imports
- Prefer `@/*` aliases for app modules.
- Use `import type` for type-only imports.
- Keep import groups stable and readable:
  1) React/framework
  2) third-party packages
  3) `@/` aliases
  4) relative imports

### Types
- Project TS config is permissive (`noImplicitAny: false`, `strictNullChecks: false`), but do not add new `any` without reason.
- Prefer `unknown` at boundaries and narrow safely.
- Define explicit payload/result interfaces for `invoke` and event listeners.
- Guard optional/null values before use.

### Naming
- Components, interfaces, and types: `PascalCase`
- Variables/functions/hooks: `camelCase` (`useXxx` for hooks)
- Constants: `SCREAMING_SNAKE_CASE`
- UI primitive files in `src/components/ui/`: kebab-case

### React Patterns
- Keep effects focused and deterministic.
- Do not ignore cleanup for timers/listeners.
- Prefer derived state via `useMemo` over duplicate state.
- Keep handlers side-effect aware and resilient to stale closures.

### Error Handling
- Treat caught errors as `unknown` at boundaries.
- Convert to user-safe messages; never leak secrets.
- Use `toast()` for user-visible failures and key status updates.
- Provide actionable fallback messages.
- Do not swallow failures silently.

## UI and Styling Rules
- Use Tailwind utilities and shared tokens defined in `src/index.css`.
- Prefer semantic theme tokens (`bg-secondary`, `text-muted-foreground`, `border-border`, `bg-glass`).
- Use `cn()` from `src/lib/utils.ts` for conditional class composition.
- Keep visual language consistent with existing SkyBox glass theme.
- Do not introduce white borders or off-theme color accents unless explicitly requested.
- Always use colors that match the active theme and nearby UI context.
- Preserve existing right-click context menu style unless user explicitly asks to redesign it.
- For transfer/status popups near context menu UX, match context-menu visual treatment.

## Rust and Tauri Conventions
### General
- Keep code `rustfmt` clean.
- Prefer `Result`-based error handling over panics.
- Avoid new `unwrap()`/`expect()` in runtime paths.

### Command Boundary
- Register new commands in `src-tauri/src/lib.rs`.
- Keep TS `invoke` names aligned with Rust command names.
- Keep payload key naming consistent across boundary (`camelCase` in TS, serde mapping in Rust).
- Return serializable errors with clear `message` text.

### Async and Concurrency
- Do not hold mutex guards across `.await`.
- Clone required state, drop lock, then await.
- Use async-safe patterns for cancellation and progress reporting.
- Use `spawn_blocking` for blocking-heavy work when needed.

### Logging and Safety
- Use `log::debug!`, `log::info!`, `log::warn!`, `log::error!` appropriately.
- Guard platform-specific behavior with `#[cfg(...)]`.
- Never log secrets or sensitive user data.

## API, Versioning, and Docs
- Update `docs/API_REFERENCE.md` when command/payload/event behavior changes.
- Keep TypeScript interfaces and Rust serialized structs aligned.
- Keep version values synchronized in:
  - `VERSION`
  - `package.json`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
- Release automation expects commit messages containing `new release`.

## Commit and PR Guidance
- Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.
- Prefer scoped messages when possible (example: `fix(explorer): correct upload speed sampling`).
- Keep commits focused; do not mix unrelated refactors.
- Document API/workflow impacts clearly in PR descriptions.

## Definition of Done
- Changes follow repository architecture and local style.
- User-visible errors have clear messaging.
- Lint/test impact is considered and compatible with CI expectations.
- No secrets or machine-specific assumptions are introduced.
- Related docs are updated when behavior or API contracts change.
