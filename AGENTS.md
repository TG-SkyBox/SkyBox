# SkyBox Agent Guide

SkyBox is a Tauri v2 desktop app.
- Frontend: Vite + React + TypeScript + Tailwind (shadcn/ui)
- Backend: Rust (Tauri) in `src-tauri/`
- Tests: Vitest + Testing Library (jsdom)
- Local data: SQLite (Rust `sqlite` crate)

## Cursor / Copilot Rules
- Cursor: none found (`.cursor/rules/` and `.cursorrules` are missing).
- Copilot: none found (`.github/copilot-instructions.md` is missing).

## Mandatory Repo Rules (MUST FOLLOW)
Source: `.qoder/rules/DontBuidl.md`

- Do NOT run the app locally (no dev servers: `npm run dev`, `tauri dev`, `cargo run`, etc.).
- Do NOT build locally (no `vite build`, `tauri build`, installers/bundlers).
- Treat GitHub Actions as the source of truth for builds/tests/validation.
- Make CI-friendly changes: deterministic behavior; no machine-specific paths; guard OS-specific code.
- Avoid adding global tooling "just to test"; prefer repo scripts and CI.
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:` (optional scope: `feat(explorer): ...`).
- Never commit/log secrets (Telegram creds, session data, tokens).

## Repo Layout
- Frontend app: `src/`
- Frontend tests: `src/test/` (setup: `src/test/setup.ts`)
- Tauri backend: `src-tauri/src/`
- Tauri command registry: `src-tauri/src/lib.rs`
- API docs: `docs/API_REFERENCE.md`

## Commands (REFERENCE; CI runs these)
Per `.qoder/rules/DontBuidl.md`, treat these as CI-reference; don't execute locally unless explicitly requested.
CI uses Node 20 and Rust stable; Rust MSRV is pinned in `src-tauri/Cargo.toml` (`rust-version = "1.77.2"`).

Frontend (repo root):

```bash
npm install
npm run lint
npm run test
npm run test:watch
npm run build
npm run preview
```

Run a single Vitest test:

```bash
# single file
npm run test -- src/test/example.test.ts

# single test by name (substring/regex)
npm run test -- -t "should pass"

# watch mode + single file/name
npm run test:watch -- src/test/example.test.ts -t "should pass"
```

Lint:

```bash
# whole repo
npm run lint

# single file
npx eslint src/pages/ExplorerPage.tsx
```

Tauri (repo root):

```bash
npm run tauri:dev
npm run tauri:build

# CI uses the "tauri" script with args:
npm run tauri build
```

Rust (from `src-tauri/`):

```bash
cargo fmt
cargo clippy
cargo test

# single Rust test (substring)
cargo test test_name_substring
```

## Code Style: TypeScript / React

Formatting
- 2-space indentation; semicolons; double quotes.
- No Prettier config in repo; keep formatting consistent with nearby files.

Imports
- Prefer `@/*` alias for app code (configured in `vite.config.ts`, `tsconfig*.json`, `vitest.config.ts`).
- shadcn aliases (from `components.json`): `@/components`, `@/components/ui`, `@/hooks`, `@/lib`.
- Use `import type` for type-only imports.
- Common order: React -> third-party -> `@/` -> relative -> styles.

Types
- TS is non-strict (`tsconfig.app.json`); still avoid `any` (use `unknown` + narrowing).
- Keep boundary types from Rust in `snake_case`; convert to UI models (`camelCase`) explicitly.
- Do not rely on lint to catch unused vars (`@typescript-eslint/no-unused-vars` is off in `eslint.config.js`).

Naming
- Components: `PascalCase` names; app component files are usually `PascalCase.tsx` (see `src/components/skybox/`).
- shadcn/ui files use kebab-case (see `src/components/ui/`).
- Hooks: `useXxx` functions (often in `use-xxx.ts`).
- Variables/functions: `camelCase`; types/interfaces: `PascalCase`; constants: `SCREAMING_SNAKE_CASE`.

Error handling + logging
- User-facing errors: `toast()` from `src/hooks/use-toast.ts`.
- Frontend diagnostics: `console.*` and/or `logger` from `src/lib/logger.ts`.
- Tauri `invoke()` failures are often `unknown`; extract `{ message }` defensively and fall back to a generic message.

UI/CSS
- Tailwind is the default; tokens/utilities live in `src/index.css` + `tailwind.config.ts`.
- Prefer existing utility classes (`bg-glass`, `text-body`, etc.) and shadcn/ui components in `src/components/ui/`.
- Use `cn()` from `src/lib/utils.ts` for conditional className building.

Testing
- Vitest config: `vitest.config.ts` (jsdom + globals + `src/test/setup.ts`).
- Prefer Testing Library: query by role/text; avoid implementation details; test user-visible behavior.

## Code Style: Rust / Tauri

General
- Keep code `rustfmt`-clean.
- Tauri commands should return `Result<T, XxxError>` where `XxxError: Serialize { message: String }`.
- Avoid introducing new `unwrap()`/`expect()` in command paths; return structured errors instead.

Tauri boundary conventions
- Command name == Rust function name (see `src-tauri/src/lib.rs`).
- Invoke payload keys should match Rust parameter names (prefer `snake_case` keys).
- Keep `docs/API_REFERENCE.md` aligned when adding/renaming commands or args.

Async + locking
- Do not hold a mutex guard across `.await` (clone needed data, drop lock, then await).
- For heavy blocking IO, consider `tokio::task::spawn_blocking`.

Logging + secrets
- Backend logging uses `log::debug!/info!/warn!/error!` (see `src-tauri/src/utils/logger.rs`).
- Never log secrets or long-lived credentials:
  - `.env` is gitignored; dev reads `TELEGRAM_API_ID/HASH` from env in debug.
  - Release builds embed these env vars at compile time (see `src-tauri/src/telegram/mod.rs`).

## Versioning / Release Workflows (CI)
- Keep versions in sync: `VERSION`, `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.
- Release flow is gated by commit message containing `new release` (see `.github/workflows/release.yml` and `.github/workflows/version.yml`).
