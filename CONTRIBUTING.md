# Contributing to @unisonlabs/code-chunk

Thanks for helping improve this library.

## Repo layout

A single-package [Bun](https://bun.sh) workspace:

- `packages/code-chunk/` — `@unisonlabs/code-chunk`, the published package
  - `src/` — TypeScript source
  - `test/` — Bun tests

## Development

```bash
bun install
bun test               # unit tests (313 total)
bun lint               # Biome (lint + format check)
bun run lint:fix       # auto-fix lint + formatting
bun run build          # bundle to packages/code-chunk/dist/
```

## Before opening a PR

1. `bun lint` must report zero errors (warnings are ok).
2. `bun test` must pass.
3. `bun run build` must succeed.
4. Keep changes scoped — one logical change per PR.

## Live ingest tests

The `test/ingest.test.ts` tests that touch the real brain are gated behind
`UNISON_TOKEN`. To run them:

```bash
export UNISON_TOKEN=usk_live_...
export UNISON_API_URL=https://api.unisonlabs.ai   # or a local brain
bun test packages/code-chunk/test/ingest.test.ts
```

## Conventions

- TypeScript, ESM, Biome formatting (tabs, single quotes, `semicolons: asNeeded` — see `biome.json`).
- The package has zero runtime dependencies beyond tree-sitter grammars and `effect`.
- The client enforces nothing — the Unison backend is the security boundary. Never
  add client-side scope or path checks.

## Reporting bugs / proposing features

Use the issue templates. For security issues, see [`SECURITY.md`](./SECURITY.md) —
do **not** open a public issue.
