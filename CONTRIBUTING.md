# Contributing to Supervisor

Thanks for your interest in contributing to Supervisor! This guide will help you get started.

## Getting started

1. **Fork the repo** and clone your fork locally.
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Run in dev mode:**
   ```bash
   npm run tauri dev
   ```

### Prerequisites

- Rust (latest stable) — [install via rustup](https://rustup.rs/)
- Node.js v18+
- npm or pnpm
- Claude Code installed (the app manages Claude Code instances)

## Project structure

```
├── src/                  # React frontend (Vite + TypeScript)
│   ├── components/       # UI components (canvas, chat, panels, sidebar)
│   ├── stores/           # Zustand state management
│   ├── hooks/            # Custom React hooks
│   └── types/            # TypeScript interfaces
├── src-tauri/            # Tauri backend (Rust)
│   └── src/              # Process management, IPC, database, socket server
├── cm/                   # CLI tool (Rust binary)
└── docs/                 # Design specs and architecture docs
```

## How to contribute

### Reporting bugs

Open an [issue](https://github.com/ParthJadhav/Supervisor/issues/new?template=bug_report.yml) with:
- Steps to reproduce
- Expected vs actual behavior
- OS and app version
- Logs if available (check the dev console or `src-tauri/logs/`)

### Suggesting features

Open a [feature request](https://github.com/ParthJadhav/Supervisor/issues/new?template=feature_request.yml). Describe:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

### Submitting pull requests

1. Create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. Make your changes. Keep commits focused and atomic.
3. Test your changes:
   ```bash
   # Frontend linting
   npm run lint

   # Rust checks
   cargo check --manifest-path src-tauri/Cargo.toml
   cargo clippy --manifest-path src-tauri/Cargo.toml
   ```
4. Push and open a PR against `main`.

### PR guidelines

- Keep PRs small and focused on a single change.
- Write a clear title and description.
- Reference related issues with `Fixes #123` or `Closes #123`.
- Add screenshots for UI changes.
- Make sure CI passes before requesting review.

## Code style

### TypeScript / React
- Use functional components with hooks.
- Keep components small and focused.
- Use Zustand for shared state.
- Follow existing patterns in the codebase.

### Rust
- Run `cargo clippy` and fix warnings.
- Use `Result` types for error handling.
- Follow the existing module structure.

## Commit messages

Use conventional commits:

```
feat: add agent-to-agent handoff
fix: resolve crash on startup when no projects exist
docs: update README with new shortcuts
refactor: simplify socket server connection handling
```

## Questions?

Open a [discussion](https://github.com/ParthJadhav/Supervisor/discussions) or reach out via issues.
