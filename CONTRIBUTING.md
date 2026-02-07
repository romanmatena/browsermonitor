# Contributing to Browser Monitor

Thank you for your interest in contributing.

## How to Contribute

1. **Fork** the repository on GitHub
2. **Clone** your fork locally
3. **Create a branch** for your change: `git checkout -b feat/my-feature` or `fix/my-fix`
4. **Make your changes**, following existing code style
5. **Commit** with a clear message: `feat: add X` / `fix: resolve Y`
6. **Push** to your fork and open a **Pull Request**

## Development Setup

```bash
git clone https://github.com/romanmatena/browsermonitor.git
cd browsermonitor
pnpm install
```

Run the tool: `node src/cli.mjs --open` or link globally: `npm link && browsermonitor --open`

## Code Style

- 2 spaces indentation
- ESM modules (`.mjs`)
- Follow patterns used in existing files

## Pull Request Guidelines

- Describe what you changed and why
- Keep PRs focused; one feature or fix per PR
- Ensure the tool runs correctly on your changes

## Questions

Open an [Issue](https://github.com/romanmatena/browsermonitor/issues) for questions or discussions.
