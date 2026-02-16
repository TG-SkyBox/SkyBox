<div align="center">

# SkyBox

<img src="src-tauri/icons/icon.png" width="200" alt="SkyBox Icon" />

A Tauri-based file explorer application with Telegram integration

</div>

## Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS
- **UI Components**: shadcn/ui, Radix UI
- **Backend**: Rust (Tauri)
- **Build Tool**: Vite
- **Testing**: Vitest, Testing Library
- **Platform**: Desktop (Windows, macOS, Linux)

## Why This Project Exists

- **Problem**: Cloud storage services cost money and have storage limits, while users need free unlimited storage for their files
- **Goal**: Create a file explorer that uses Telegram as unlimited free cloud storage for seamless file backup and sharing
- **Outcome**: A native desktop application that turns Telegram into personal cloud storage while providing modern file management capabilities

## Project Structure

```
src/
├── components/          # React components
│   ├── skybox/         # SkyBox-specific components
│   └── ui/             # shadcn/ui components
├── hooks/              # Custom React hooks
├── lib/                # Utility functions
├── pages/              # Application pages
├── test/               # Test setup and examples
├── App.tsx             # Main application component
└── main.tsx            # Application entry point

src-tauri/
├── src/                # Rust backend code
│   ├── db/             # Database operations
│   ├── fs/             # File system operations
│   ├── telegram/       # Telegram integration
│   ├── utils/          # Utility functions
│   ├── lib.rs          # Library exports
│   └── main.rs         # Tauri entry point
├── capabilities/       # Tauri permissions
├── icons/              # Application icons
├── Cargo.toml          # Rust dependencies
└── tauri.conf.json     # Tauri configuration

public/                 # Static assets
screenshots/            # Application screenshots
docs/                   # Documentation
.github/workflows/      # CI/CD workflows
README.md
package.json
vite.config.ts
tsconfig.json
tailwind.config.ts
```

<h2 align="center">Screenshots</h2>

<p align="center">
  <img src="screenshots/Screenshot-1.png" alt="Screenshot 1" width="420" />
  <img src="screenshots/Screenshot-2.png" alt="Screenshot 2" width="420" />
  <img src="screenshots/Screenshot-3.png" alt="Screenshot 3" width="420" />
  <img src="screenshots/Screenshot-4.png" alt="Screenshot 4" width="420" />
  <img src="screenshots/Screenshot-5.png" alt="Screenshot 5" width="420" />
  <img src="screenshots/Screenshot-6.png" alt="Screenshot 6" width="420" />
</p>

## Key Features

- Browse and manage files with a modern, responsive interface
- Search files and folders quickly
- Integrate with Telegram for seamless file sharing
- Access files across Windows, macOS, and Linux platforms
- Navigate using an intuitive breadcrumb system
- View file details in a dedicated panel
- Manage files through a grid or list view
- Secure local data storage with SQLite