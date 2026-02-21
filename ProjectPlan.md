# SkyBox — Project Plan (for Qoder AI Agent)

## 0) One-liner

SkyBox is a **Telegram-themed desktop file explorer** built as a **single Tauri app** (React + TypeScript frontend, Rust backend) with a **local embedded database**, featuring a **Telegram-style login UI** and a clean, fast, offline-first file management experience.

---

## 1) Goals

### 1.1 Product Goals

- Provide a **smooth desktop file explorer** with **Telegram dark theme look & feel**.
- Run fully **offline** (no external services required).
- Store app state, preferences, and metadata in a **local embedded DB**.
- Offer common file actions: browse, search, open, copy, move, delete, rename, create folder/file.

### 1.2 Engineering Goals

- Single repo, single app bundle using Tauri.
- Clean separation of concerns: UI (React) vs system ops (Rust commands).
- Fast UI: avoid heavy polling; use events where possible.
- Consistent types shared between frontend and backend.
- Minimal permissions principle on filesystem operations.

---

## 2) Scope

### 2.1 MVP Scope (Must-have)

- Telegram-like login page UI (phone input + optional QR mock/placeholder).
- File explorer UI:
  - Left sidebar: locations (Home, Desktop, Downloads, Documents, Drives)
  - Main panel: file list (name, size, modified, type)
  - Top bar: current path + back/forward + search
- File operations (backend-powered):
  - List directory contents
  - Open file / open folder in system file explorer
  - Create folder
  - Rename
  - Delete (safe delete if possible, fallback hard delete)
  - Copy/Move (basic)
- Local DB:
  - store user session (fake/local-only), settings, recent paths, favorites
- Settings:
  - Theme (dark fixed), language placeholders, default start directory
- Logging:
  - frontend + backend logs with useful prefixes

### 2.2 Nice-to-have (Post-MVP)

- Tabs for multiple directories
- File preview panel (images/text)
- Fuzzy search + filters
- Pinned folders + tags
- Trash bin UI
- Keyboard shortcuts similar to Telegram/Desktop explorers

### 2.3 Out of Scope (for now)

- Real Telegram authentication / network integration
- Cloud sync
- Multi-user OS-level security model beyond normal file permissions

---

## 3) Tech Stack

### 3.1 Frontend

- React + TypeScript (Vite)
- Tailwind CSS (Telegram-dark styling)
- State: Zustand (or Redux Toolkit if needed)
- Router: React Router
- UI components: Radix/shadcn optional, keep minimal

### 3.2 Backend (Tauri / Rust)

- Tauri v2
- Rust commands for filesystem operations
- Event emitters for long ops (copy/move progress)
- Logging via `tracing`

### 3.3 Local Database

Choose one:

- **SQLite** (recommended) via `rusqlite` or `sqlx` (local file DB)
  OR
- `sled` (pure Rust KV store) if we want super simple KV

MVP recommendation: SQLite for structure and future growth.

---

## 4) High-level Architecture

### 4.1 Data Flow

UI -> `invoke()` Tauri command -> Rust performs filesystem/DB -> returns result

- For long operations: Rust emits progress events -> UI subscribes -> updates progress bar.

### 4.2 Security

- Restrict filesystem access to explicit user actions.
- Validate and normalize paths.
- Prevent directory traversal issues.
- Avoid executing arbitrary file content.

---

## 5) Repository Structure

Target structure:

SkyBox/
src/
app/
routes/
layout/
store/
components/
features/
auth/
explorer/
settings/
lib/
tauri/
utils/
styles/
types/
src-tauri/
src/
commands/
db/
fs/
main.rs
icons/
tauri.conf.json
docs/
scripts/
README.md

---

## 6) Core Modules & Responsibilities

### 6.1 Auth Module (UI-only MVP)

- Telegram-like login screen
- Store "session" in DB (local only)
- States: LoggedOut -> LoggedIn

### 6.2 Explorer Module

- Directory listing view
- Breadcrumb / path input
- Back/forward history
- Search (MVP: filter current directory items)
- Context menu actions
- Drag-and-drop (optional post-MVP)

### 6.3 Rust Filesystem Commands

Commands (MVP):

- `fs_list_dir(path) -> Vec<FileEntry>`
- `fs_open_path(path)`
- `fs_create_dir(path)`
- `fs_rename(old, new)`
- `fs_delete(path)`
- `fs_copy(src, dst)` + progress events
- `fs_move(src, dst)` + progress events

### 6.4 DB Layer

Tables (SQLite suggestion):

- `settings(key TEXT PRIMARY KEY, value TEXT)`
- `recent_paths(id INTEGER PRIMARY KEY, path TEXT, last_opened INTEGER)`
- `favorites(id INTEGER PRIMARY KEY, path TEXT, label TEXT)`
- `session(id INTEGER PRIMARY KEY, phone TEXT, created_at INTEGER)`

---

## 7) UI/UX Requirements

### 7.1 Telegram Dark Theme Guidelines

- Background: deep dark
- Cards/panels: slightly lighter dark
- Accent: Telegram blue for highlights
- Rounded corners, soft shadows
- Typography similar to Telegram desktop
- Smooth transitions (subtle)

### 7.2 Screens

1. Login

- Phone number input
- Continue button
- Optional "Scan QR" tab (MVP placeholder)

2. Explorer

- Sidebar (locations, favorites)
- Main list
- Search
- Context actions

3. Settings

- Start directory
- Clear recent
- Toggle hidden files

---

## 8) Milestones & Tasks

### Milestone 1 — Project Bootstrap

- Create Vite React TS app
- Add Tailwind
- Add Tauri scaffold
- Confirm `tauri dev` works

### Milestone 2 — Theming + Layout

- Telegram-dark base styles
- Layout shell (sidebar/topbar/content)
- Dummy file list data

### Milestone 3 — Rust FS Commands

- Implement `fs_list_dir`
- Render real directory contents
- Implement open/reveal path
- Add error handling messages

### Milestone 4 — File Actions

- Create folder
- Rename
- Delete
- Copy/move basic

### Milestone 5 — Local DB

- Add SQLite init & migrations
- Persist settings + recent paths
- Favorites MVP

### Milestone 6 — Polish & Stability

- Loading states
- Empty states + error toasts
- Keyboard shortcuts (basic)
- Logging + crash-safe behavior

### Milestone 7 — Build & Release

- Windows build
- Installer assets + icons
- Versioning + changelog

---

## 9) Coding Standards (for Qoder)

### 9.1 General

- No giant files. Keep components and commands small and focused.
- Strong typing: no `any` unless absolutely unavoidable.
- Validate inputs at the boundary (Tauri commands).
- Prefer pure functions for formatting/parsing logic.

### 9.2 Frontend

- Feature-based foldering under `src/features/*`
- Shared UI under `src/components/*`
- Shared utilities under `src/lib/*`
- Use async error handling with user feedback (toast)

### 9.3 Backend

- Commands grouped by domain: `commands/fs.rs`, `commands/db.rs`
- All filesystem ops use safe path normalization and return structured errors.
- Use `tracing` for logs.

---

## 10) Git Workflow & Commit Convention

- Branch: `main` (stable) + `dev` (active)
- PRs preferred for big features

Commit format:

- `feat(module): ...`
- `fix(module): ...`
- `refactor(module): ...`
- `chore: ...`
- `docs: ...`

Examples:

- `feat(explorer): add directory listing with breadcrumbs`
- `fix(fs): normalize paths to prevent invalid traversal`
- `refactor(ui): split sidebar into reusable components`

---

## 11) Testing Plan

### Frontend

- Unit test utils (path formatting, filters)
- Minimal component tests for explorer list

### Backend

- Unit tests for path normalization
- Integration tests for DB init (if feasible)

---

## 12) Acceptance Criteria (MVP)

- App launches into login screen.
- After “login”, explorer opens.
- User can browse directories and see correct file metadata.
- User can create folder, rename, delete.
  -- Recent paths persist after restart.
- No crashes on invalid paths; errors are shown cleanly.

---

## 13) Deliverables

- Working Tauri app: `tauri dev` and `tauri build` succeed on Windows.
- `README.md` with:
  - setup steps
  - dev commands
  - build instructions
- `docs/` containing:
  - UI theme notes
  - command/API list

---

## 14) Qoder Instructions (Execution Order)

1. Bootstrap project (Vite + Tailwind + Tauri).
2. Build UI shell and Telegram theme.
3. Implement `fs_list_dir` and render real directory data.
4. Add file operations incrementally (create/rename/delete).
5. Add local DB and persist recents/settings.
6. Polish UI + add logging.
7. Prepare release build.

End of plan.
