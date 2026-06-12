# AGENTS.md

Guidance for AI agents. This file covers two jobs — jump to yours:

- **Use this library** — you're an agent helping someone ingest code into the Unison brain →
  [Ingest code into the Unison brain](#ingest-code-into-the-unison-brain)
- **Contribute to this repo** — you're changing this library's code →
  [Working in this repo](#working-in-this-repo)

Follows the [AGENTS.md](https://agents.md/) convention. Human contributors: see
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## Ingest code into the Unison brain

`@unisonlabs/code-chunk` gives you AST-aware chunking + one-call brain ingest. Every
chunk is a semantically complete piece of code (a function, class, method) enriched
with scope chain, imports, and sibling context — optimised for embedding and retrieval.

### 1. Install

```bash
bun add @unisonlabs/code-chunk
# or
npm install @unisonlabs/code-chunk
```

### 2. Authenticate

Set your Unison brain API key. If you don't have one:

```bash
# Provision a key (headless — no browser required)
curl -s -X POST https://brain.unisonlabs.ai/v1/auth/provision \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}'
# → { "apiKey": "usk_live_...", "tenantId": "...", "status": "unverified" }

export UNISON_TOKEN=usk_live_...
# Optionally, for a self-hosted brain:
# export UNISON_API_URL=http://localhost:4001
```

All API calls go to `UNISON_API_URL` (default: `https://brain.unisonlabs.ai`) with
`Authorization: Bearer $UNISON_TOKEN`. The key is a `usk_live_...` bearer token.

### 3. Chunk and ingest

```typescript
import { ingestFile, ingestBatch } from '@unisonlabs/code-chunk'

// Single file — chunks + pushes in one call
const result = await ingestFile('src/user.ts', sourceCode, {
  repo: 'my-project',         // optional namespace prefix
  tags: ['typescript'],       // optional tags on each chunk doc
  visibility: 'tenant',       // 'tenant' (org-wide) or 'private'
})
console.log(`Pushed ${result.chunks} chunks`)
// result.paths → ['/tenant/code/my-project/src/user.ts/chunk-0.md', ...]

// Batch — multiple files, controlled concurrency
const results = await ingestBatch(
  [
    { filepath: 'src/user.ts',  code: userCode  },
    { filepath: 'src/auth.ts',  code: authCode  },
  ],
  { repo: 'my-project', concurrency: 5 },
)
```

Chunks are stored as brain documents at:
```
/tenant/code/<repo>/<filepath>/chunk-N.md
```

Each document body contains inline metadata, the contextualized embedding text,
and the raw code in a fenced block — so both semantic search and exact grep work.

### 4. Verify

```typescript
import { BrainClient } from '@unisonlabs/code-chunk'

const client = new BrainClient()
const me = await client.whoami()
console.log(me.tenant.name, me.scopes) // → "my-org" ["brain:read","brain:write"]
```

### The loop — run this every session

- **Before answering a code question, search the brain first.** Chunks are
  already embedded; use the Unison brain search API or MCP to find relevant ones.
- **When a codebase changes, re-ingest the changed files.** `ingestFile` is
  idempotent — it upserts by path.
- **All paths are deterministic.** `/tenant/code/<repo>/<filepath>/chunk-N.md`
  so you can read back a specific chunk directly.

### Options reference

| Option | Type | Default | Description |
|---|---|---|---|
| `repo` | `string` | — | Namespace prefix (`my-project`) |
| `maxChunkSize` | `number` | `1500` | Max chunk size in bytes |
| `contextMode` | `'none'\|'minimal'\|'full'` | `'full'` | Context detail level |
| `tags` | `string[]` | `[]` | Tags for each chunk document |
| `visibility` | `'tenant'\|'private'` | `'tenant'` | Brain doc visibility |

### Errors

- `ChunkingError` — AST parse or split pipeline failed
- `UnsupportedLanguageError` — file extension not supported (TS/JS/Py/Rust/Go/Java)
- `BrainApiError` — Unison API error; has `.statusCode` and `.code`

---

## Working in this repo

A single-package Bun workspace. The package `packages/code-chunk` exports
`@unisonlabs/code-chunk`.

### Build, test, lint (run before every PR)

```bash
bun install
bun run build   # bundle to packages/code-chunk/dist/
bun test        # 313 unit tests
bun lint        # Biome (lint + format check); bun run lint:fix to auto-fix
```

CI runs all three (`bun install && bun run build && bun test`) on every PR.

### Conventions

- TypeScript + ESM. Biome formatting: tabs, single quotes, semicolons-as-needed.
- The package has zero runtime deps beyond tree-sitter grammars + effect.
- **The client enforces nothing** — the Unison backend is the only security boundary.
  Never add client-side scope checks or path allow-lists; surface the server's response.
- Test-only: `noTemplateCurlyInString` + `noNonNullAssertion` are turned off in
  `**/test/**/*.ts` (test fixtures intentionally contain raw template strings).

### PRs

One logical change per PR. Never push to `main` — open a PR. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).
