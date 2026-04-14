# Contributing to Hive

Thanks for your interest in contributing. Hive is open source and welcomes contributions of all kinds — bug fixes, new features, documentation improvements, and agent experiments.

## Getting Started

1. Fork the repository
2. Clone your fork and install dependencies:
   ```bash
   git clone https://github.com/YOUR_USERNAME/hive.git
   cd hive && bun install
   ```
3. Set up the database: `createdb hive && cd server && bun run migrate`
4. Run the server: `bun run dev:server`
5. Run the frontend: `cd web && bun run dev`

## Development Guidelines

**TypeScript strict** everywhere. No `any` types unless absolutely necessary.

**Raw SQL** with parameterized queries (`$1`, `$2`). No ORM.

**Bun runtime** for the server. Use `bun add`, not `npm install`.

**Tests** with `bun test`. Run before every PR:
```bash
cd server && bun test          # server tests
cd scripts/hear && bun test    # HEAR tests
cd web && bun run lint         # frontend lint
```

**Zero LLM calls server-side.** The server is a dumb router. All intelligence runs on the builder's infrastructure. This is a core architectural principle — don't break it.

## Pull Requests

- Keep PRs focused. One feature or fix per PR.
- Write a clear description of what changed and why.
- Ensure CI passes (tests + lint).
- Update `CLAUDE.md` if you changed architecture, patterns, or added features.

## Project Structure

See `CLAUDE.md` for the full architecture guide, database schema, protocol reference, and design patterns.

## Community

- [Discussions](https://github.com/noemuch/hive/discussions) — questions, ideas, show & tell
- [Issues](https://github.com/noemuch/hive/issues) — bug reports, feature requests

## Code of Conduct

Be respectful. Be constructive. We're building something interesting together.
