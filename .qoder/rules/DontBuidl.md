---
trigger: always_on
---
# SkyBox — Agent Rules (Qoder)

These rules are mandatory for all work on **SkyBox**.

---

## 1) No Local Build / No Local Run
- **DO NOT** run the app locally.
- **DO NOT** attempt to build the app locally.
- **DO NOT** start dev servers (`npm run dev`, `npx tauri dev`, `cargo run`, etc.).
- **DO NOT** run platform builds (`tauri build`, `cargo build`, installers, bundlers).

✅ All builds, runs, and validations are handled by **GitHub Actions workflows**.

---

## 2) Workflow-First Development
- Assume CI is the source of truth.
- Make changes that are **CI-friendly**:
  - deterministic outputs
  - no machine-specific paths
  - no OS-specific hacks unless guarded properly
- If something requires verification, add:
  - tests, lint rules, type checks, or
  - workflow steps that catch regressions.

---

## 3) What You *Should* Do Instead
### Frontend
- Update code, configs, types, and UI components.
- Ensure TypeScript types are correct.
- Keep imports clean and consistent.

### Backend (Rust/Tauri)
- Implement commands and logic safely.
- Add structured error handling.
- Keep platform-specific code behind `#[cfg(...)]`.

### CI / GitHub Actions
- If a step needs automation, modify workflows rather than running locally.
- Prefer adding checks: lint, format, tests, typecheck.

---

## 4) Quality Gates (Non-Negotiable)
- No breaking TypeScript builds (type errors are unacceptable).
- No obvious Rust compile errors.
- No unused imports / dead code where avoidable.
- Clear error messages returned to the UI layer.

---

## 5) Commit Rules
- Use conventional commits:
  - `feat(module): ...`
  - `fix(module): ...`
  - `refactor(module): ...`
  - `chore: ...`
  - `docs: ...`
- Keep commits scoped and descriptive.

Examples:
- `feat(explorer): add directory breadcrumb navigation`
- `fix(fs): prevent invalid path traversal`
- `docs(ci): document github workflow-only build policy`

---

## 6) PR / Change Discipline
- Prefer small, reviewable changes.
- Avoid large refactors mixed with features.
- Add notes in PR description when changes affect CI or build steps.

---

## 7) Forbidden Actions
- Installing extra global tooling “just to test”.
- Hardcoding absolute paths (e.g., `C:\Users\...`).
- Depending on local environment state.
- Disabling CI checks to “make it pass”.

---

## 8) Definition of Done
A change is considered done only when:
- Code is committed with proper message format.
- CI workflows pass.
- The change is documented if it affects setup, configuration, or workflow behavior.

End of rules.
