# Contributing to Coreclaw

## Prerequisites

- **Node.js** 20+
- **pnpm** (pinned version in `package.json`)

## Development Setup

```bash
# Clone and install
git clone <repo-url>
cd coreclaw
pnpm install --frozen-lockfile

# Run in development mode
export OPENAI_API_KEY=YOUR_KEY
pnpm run dev

# Type-check
pnpm run typecheck

# Run tests
pnpm run test

# Build
pnpm run build
```

## Package Manager

- Use **pnpm only** (pinned via `packageManager` in `package.json`).
- Always install with `pnpm install --frozen-lockfile`.
- Commit both `pnpm-lock.yaml` and `pnpm-workspace.yaml`.
- If a new dependency needs lifecycle scripts, run `pnpm approve-builds` and commit the updated policy.

## Code Style

- **TypeScript** with strict mode.
- **ES modules** (`"type": "module"` in `package.json`).
- Use `import type` for type-only imports.
- Zod schemas for all tool parameter validation.
- Prefer explicit types over `any` (existing `any` casts in tool specs are a known debt).

## Project Structure

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full repo layout and design.

Key conventions:
- Source code in `src/`, organized by subsystem (`agent/`, `bus/`, `tools/`, etc.).
- Built-in tools in `src/tools/builtins/`, one file per tool category.
- Tests in `test/`, named `*.test.ts`.
- Operational scripts in `scripts/`.

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Commitizen is configured for assistance.

Format: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `build`, `ci`

Examples:
```
feat(tools): add image generation tool
fix(bus): prevent duplicate message processing
docs(readme): update configuration reference
test(scheduler): add cron edge case coverage
```

## Adding a New Built-in Tool

1. Create or edit a file in `src/tools/builtins/`.
2. Define a `ToolSpec` with Zod schema, name, description, and `run` function.
3. Export it from `src/tools/builtins/index.ts`.
4. Add policy rules in `src/tools/policy.ts` if the tool needs access control.
5. Add tests in `test/`.
6. Document the tool in `README.md` (Tool API Reference section).

## Adding a New Channel

1. Implement the `Channel` interface from `src/channels/base.ts`.
2. The channel must call `bus.publishInbound()` for incoming messages.
3. Register the channel in `src/app.ts` startup logic.
4. Add configuration options to `src/config/schema.ts` and `src/config/load.ts`.

## Pull Request Process

1. Fork the repo and create a feature branch.
2. Make your changes with tests.
3. Run `pnpm run verify` (typecheck + test) to ensure everything passes.
4. Submit a PR with a clear description of what and why.
5. PRs require passing CI before merge.

## Testing

```bash
# Run all tests
pnpm run test

# Run a specific test
npx tsx --test test/storage.test.ts
```

Tests use Node.js built-in test runner (`node:test`). Each test file creates isolated fixtures (temp directories, in-memory databases) and cleans up after itself.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
