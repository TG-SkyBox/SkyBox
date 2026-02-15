# SkyBox: Agent Notes

SkyBox is a Tauri v2 desktop app.

- Frontend: Vite + React + TypeScript + Tailwind (shadcn/ui)
- Backend: Rust (Tauri) in `src-tauri/`
- Tests: Vitest + Testing Library
- Local data: SQLite (Rust `sqlite` crate)

## Cursor / Copilot Rules

- No Cursor rules found (`.cursor/rules/` and `.cursorrules` are not present).
- No Copilot instructions found (`.github/copilot-instructions.md` is not present).

## Existing Agent Rules (MUST FOLLOW)

This repo contains Qoder agent rules in `/.qoder/rules/DontBuidl.md`.

- Do NOT run the app locally (no `dev`, no `tauri dev`, no `cargo run`).
- Do NOT build locally (no `vite build`, no `tauri build`, no installers).
- Assume GitHub Actions workflows are the source of truth.
- Make CI-friendly changes (no machine-specific paths; guard OS-specific code).
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.

If you need validation, prefer adding/adjusting tests and CI steps rather than running locally.

## Build / Lint / Test Commands (REFERENCE)

CI currently uses Node 20 + Rust stable (see `/.github/workflows/*`). Prefer `npm` for scripts.

Frontend (run from repo root):

```bash
npm install
npm run dev
npm run build
npm run preview
npm run lint
npm run test
npm run test:watch
```

Tauri (repo root):

```bash
npm run tauri:dev
npm run tauri:build

# Also used in CI:
npm run tauri build
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

Lint a single file:

```bash
npx eslint src/pages/ExplorerPage.tsx
```

Rust (run from `src-tauri/`):

```bash
cargo fmt
cargo clippy
cargo test

# single Rust test (substring)
cargo test test_name_substring
```

Notes:

- Minimum Rust version is pinned in `src-tauri/Cargo.toml` (`rust-version = "1.77.2"`).
- `src-tauri/tauri.conf.json` runs `npm run dev` / `npm run build` as pre-commands.

## Code Style: TypeScript / React

Formatting

- Use 2-space indentation, semicolons, and double quotes (matches existing TS/TSX).
- Keep file line endings consistent with the file you are editing (repo is mixed).

Imports

- Prefer `@/` alias for cross-folder imports (see `vite.config.ts`, `tsconfig*.json`).
- Keep shadcn alias conventions from `components.json`:
  - `@/components`, `@/components/ui`, `@/hooks`, `@/lib`
- Use `import type` for type-only imports.
- Aim for consistent grouping: React -> third-party -> internal (`@/`) -> relative -> styles.

Types

- TS is configured non-strict in `tsconfig.app.json`, but keep code strongly typed anyway.
- Avoid `any`; prefer `unknown` and narrow.
- Boundary types from Rust are typically `snake_case` (serde defaults). Keep them separate from
  UI models (`camelCase`) and convert explicitly.
  - Example pattern: `FileEntry { is_directory }` -> `FileItem { isDirectory }`.

Naming

- Components: `PascalCase` and file names `PascalCase.tsx`.
- Hooks: `useXxx`.
- Variables/functions: `camelCase`.
- Constants: `SCREAMING_SNAKE_CASE`.

UI + CSS

- Tailwind is the default; design tokens live in `src/index.css` + `tailwind.config.ts`.
- Prefer semantic utility classes already used by the app (`bg-glass`, `text-body`, etc.).
- Use `cn()` from `src/lib/utils.ts` for conditional class names.
- Prefer existing shadcn/ui + Radix components in `src/components/ui/*`.

Error handling

- User-facing errors: show a toast via `toast()` from `src/hooks/use-toast.ts`.
- Developer diagnostics: log to `console.*` and/or `logger` (`src/lib/logger.ts`).
- Tauri `invoke()` errors are not always `Error`; handle as `unknown` and extract
  `{ message }` defensively.

Testing

- Vitest config: `vitest.config.ts` (jsdom + globals + `src/test/setup.ts`).
- Prefer Testing Library patterns (render, query by role/text, avoid implementation details).

## Code Style: Rust / Tauri

General

- Keep code `rustfmt`-clean (`cargo fmt`).
- Prefer `Result<T, XxxError>` where `XxxError` is `Serialize` with `message: String`.
- Avoid `unwrap()` / `expect()` in Tauri command paths; return structured errors instead.

Tauri boundary conventions

- Command names come from the Rust function name (see `src-tauri/src/lib.rs`).
- Invoke payload keys should match Rust parameter names (prefer `snake_case` keys).
- Keep `docs/API_REFERENCE.md` aligned with actual commands and argument names.

Async + locking

- Do not hold a mutex guard across `.await`.
  - Pattern used in `src-tauri/src/telegram/*`: take/clone needed fields, drop lock, then await.
- If you add heavy blocking IO, consider `tokio::task::spawn_blocking`.

Logging + secrets

- Backend logs: `log::debug!/info!/warn!/error!` (see `src-tauri/src/utils/logger.rs`).
- Never log secrets or long-lived credentials:
  - `.env` is gitignored; dev loads `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` from env.
  - Release builds embed these env vars at compile time (see `src-tauri/src/telegram/mod.rs`).

## Versioning / Releases (CI)

- Keep versions in sync: `VERSION`, `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.
- Release workflow is gated by commit message containing `new release` (see `/.github/workflows/cross-platform.yml`).
