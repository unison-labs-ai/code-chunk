<div align="center">

<img src="https://raw.githubusercontent.com/unison-labs-ai/unison-brain/main/assets/brain.svg" width="140" alt="Unison Brain" />

# code-chunk

**Feed your whole codebase to your agent's brain — chunked the way code actually reads.**

AST-aware code chunking for contextual retrieval into the [Unison brain](https://unisonlabs.ai).
Splits at semantic boundaries — functions, classes, methods — never mid-expression.

[![CI](https://github.com/unison-labs-ai/code-chunk/actions/workflows/ci.yml/badge.svg)](https://github.com/unison-labs-ai/code-chunk/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@unisonlabs/code-chunk?logo=npm&color=cb3837)](https://www.npmjs.com/package/@unisonlabs/code-chunk)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/unison-labs-ai/code-chunk?style=social)](https://github.com/unison-labs-ai/code-chunk)

[**Why AST-aware?**](#why-ast-aware-vs-naive-chunking) • [**Install**](#installation) • [**Quickstart**](#quickstart) • [**API**](#api-reference) • [**Languages**](#supported-languages)

</div>

---

### Why AST-aware vs naive chunking

Naive character-limit chunkers split wherever the byte count runs out — mid-function, mid-class, sometimes mid-expression. The embedding model sees an amputated fragment with no context about what it belongs to. Retrieval degrades.

`code-chunk` parses with [tree-sitter](https://tree-sitter.github.io/tree-sitter/) first. Every chunk boundary is a real semantic boundary. Every chunk carries:

- **Scope chain** — `UserService > getUser` tells the model exactly where the code lives
- **Entity signatures** — what's defined, not just what's present
- **Siblings** — what came before and after, for continuity
- **Imports** — what dependencies are in play

The result: embeddings that retrieve the *right* function, not a random slice of it.

## How It Works

### 1. Parse

Source code is parsed into an Abstract Syntax Tree (AST) using [tree-sitter](https://tree-sitter.github.io/tree-sitter/). This gives a structured representation that understands language grammar.

### 2. Extract

The AST is traversed to extract semantic entities: functions, methods, classes, interfaces, types, and imports. For each entity:
- Name and type
- Full signature (e.g., `async getUser(id: string): Promise<User>`)
- Docstring/comments if present
- Byte and line ranges

### 3. Build Scope Tree

Entities are organized into a hierarchical scope tree. A method inside a class knows its parent; a nested function knows its containing function. This enables scope context like `UserService > getUser`.

### 4. Chunk

Code is split at semantic boundaries while respecting `maxChunkSize`. The chunker:
- Prefers to keep complete entities together
- Splits oversized entities at logical points (statement boundaries)
- Never cuts mid-expression or mid-statement
- Merges small adjacent chunks to reduce fragmentation

### 5. Enrich with Context

Each chunk is enriched with contextual metadata:
- **Scope chain**: Where this code lives (inside which class/function)
- **Entities**: What's defined in this chunk
- **Siblings**: What comes before/after (for continuity)
- **Imports**: What dependencies are used

### 6. Ingest into Brain (Unison-specific)

Each chunk is written to the Unison brain as a document at:
```
/private/notes/code-<repo?>-<filepath-slug>-chunk-N.md
```
The document body includes inline metadata comments, the contextualized text (for semantic search), and the raw code in a fenced block (for grep/exact search).

## Installation

```bash
npm install @unisonlabs/code-chunk
# or
bun add @unisonlabs/code-chunk
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `UNISON_TOKEN` | Yes (for ingest) | Your Unison API key (`usk_live_...`) |
| `UNISON_API_URL` | No | Override the Unison API base URL (default: `https://brain.unisonlabs.ai`) |

Obtain a token:
```bash
# 1. Provision an account (headless)
curl -X POST https://brain.unisonlabs.ai/v1/auth/provision \
  -H 'Content-Type: application/json' \
  -d '{"email": "you@example.com"}'
# → { "apiKey": "usk_live_...", "workspaceId": "...", "status": "unverified" }

# 2. Verify with the OTP emailed to you
curl -X POST https://brain.unisonlabs.ai/v1/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{"email": "you@example.com", "code": "123456"}'

export UNISON_TOKEN=usk_live_...
```

## Quickstart

### Basic Chunking

```typescript
import { chunk } from '@unisonlabs/code-chunk'

const chunks = await chunk('src/user.ts', sourceCode)

for (const c of chunks) {
  console.log(c.text)
  console.log(c.context.scope)    // [{ name: 'UserService', type: 'class' }]
  console.log(c.context.entities) // [{ name: 'getUser', type: 'method', ... }]
}
```

### Ingest into the Unison Brain

```typescript
import { ingestFile } from '@unisonlabs/code-chunk'

const result = await ingestFile('src/user.ts', sourceCode, {
  repo: 'my-project',
  tags: ['typescript', 'services'],
  visibility: 'workspace',
})

console.log(`Pushed ${result.chunks} chunks`)
// result.paths → ['/private/notes/code-my-project-src-user-ts-chunk-0.md', ...]
```

### Batch Ingest

```typescript
import { ingestBatch } from '@unisonlabs/code-chunk'

const results = await ingestBatch(
  [
    { filepath: 'src/user.ts', code: userCode },
    { filepath: 'src/auth.ts', code: authCode },
  ],
  {
    repo: 'my-project',
    concurrency: 5,
    onProgress: (done, total, path, ok) =>
      console.log(`[${done}/${total}] ${path}: ${ok ? 'ok' : 'failed'}`),
  },
)
```

### Rate Limits & Reliability

The Unison brain rate-limits **per API key** with a slow-refill quota. The
`BrainClient` handles this automatically:

- **Retries** on `429` and transient `5xx` with exponential backoff + jitter
  (configurable via `maxRetries`, default 8; honours a `Retry-After` header).
- **Atomic per-file ingest** — if a chunk write ultimately fails, chunks already
  written for that file are rolled back, leaving no orphaned documents.
  `IngestFileError.rolledBack` lists the paths that were cleaned up.

For large codebases, keep `concurrency` low (2–3) and **split work across
multiple keys** — one key's quota is the throughput ceiling.

### Stream Ingest Results

```typescript
import { ingestBatchStream } from '@unisonlabs/code-chunk'

for await (const result of ingestBatchStream(files, { concurrency: 3 })) {
  if (result.error) {
    console.error(`Failed: ${result.filepath}`, result.error)
  } else {
    console.log(`${result.filepath} → ${result.chunks} chunks`)
  }
}
```

### Streaming Large Files

```typescript
import { chunkStream } from '@unisonlabs/code-chunk'

for await (const c of chunkStream('src/large.ts', code)) {
  await process(c)
}
```

### Reusable Chunker

```typescript
import { createChunker } from '@unisonlabs/code-chunk'

const chunker = createChunker({ maxChunkSize: 2048 })

for (const file of files) {
  const chunks = await chunker.chunk(file.path, file.content)
}
```

### Direct Brain Client Access

```typescript
import { BrainClient } from '@unisonlabs/code-chunk'

const client = new BrainClient() // reads UNISON_TOKEN from env

const me = await client.whoami()
console.log(me.workspace.name, me.scopes)

await client.writeDoc({
  path: '/private/notes/research.md',
  bodyMd: '# Research Notes\n...',
  tags: ['research'],
})
```

## API Reference

### Chunking

#### `chunk(filepath, code, options?)`

Chunk source code into semantic pieces with context.

**Returns:** `Promise<Chunk[]>`

**Throws:** `ChunkingError`, `UnsupportedLanguageError`

---

#### `chunkStream(filepath, code, options?)`

Stream chunks incrementally. `chunk.totalChunks` is `-1` in streaming mode.

**Returns:** `AsyncGenerator<Chunk>`

---

#### `chunkBatch(files, options?)`

Process multiple files concurrently with per-file error handling.

**Returns:** `Promise<BatchResult[]>`

---

#### `createChunker(options?)`

Create a reusable chunker instance.

**Returns:** `Chunker` with `chunk()`, `stream()`, `chunkBatch()`, `chunkBatchStream()` methods

---

### Ingest (Unison brain)

#### `ingestFile(filepath, code, options?)`

Chunk a file and push all chunks to the Unison brain.

**Returns:** `Promise<IngestFileResult>` — `{ filepath, chunks, paths, error: null }`

---

#### `ingestBatch(files, options?)`

Chunk and ingest multiple files concurrently. Never throws — errors are per-file.

**Returns:** `Promise<IngestResult[]>`

---

#### `ingestBatchStream(files, options?)`

Stream ingest results as files complete.

**Returns:** `AsyncGenerator<IngestResult>`

---

#### `pushChunks(filepath, chunks, options?)`

Push pre-computed chunks to the brain (skip chunking step).

**Returns:** `Promise<IngestFileResult>`

---

### Options

#### ChunkOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `maxChunkSize` | `number` | `1500` | Maximum chunk size in bytes |
| `contextMode` | `'none' \| 'minimal' \| 'full'` | `'full'` | Context level |
| `siblingDetail` | `'none' \| 'names' \| 'signatures'` | `'signatures'` | Sibling detail |
| `filterImports` | `boolean` | `false` | Filter out import statements |
| `language` | `Language` | auto | Override language detection |
| `overlapLines` | `number` | `10` | Lines from previous chunk to include |

#### IngestOptions (extends ChunkOptions)

| Option | Type | Default | Description |
|---|---|---|---|
| `repo` | `string` | — | Repository/project namespace |
| `pathPrefix` | `string` | `/private/notes/` | Writable brain root prefix |
| `tags` | `string[]` | `[]` | Tags for chunk documents |
| `visibility` | `'workspace' \| 'private'` | `'workspace'` | Brain doc visibility |
| `client` | `BrainClientOptions` | — | API token/URL override |

---

### Supported Languages

| Language | Extensions |
|---|---|
| TypeScript | `.ts`, `.tsx`, `.mts`, `.cts` |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` |
| Python | `.py`, `.pyi` |
| Rust | `.rs` |
| Go | `.go` |
| Java | `.java` |

---

### Errors

**`ChunkingError`** — chunking pipeline failed  
**`UnsupportedLanguageError`** — file extension not supported  
**`BrainApiError`** — Unison brain API error (has `.statusCode` and `.code`)

All errors have a `_tag` property for Effect-style error handling.

## Star History

If this library saves you from a bad retrieval pipeline, a ⭐ helps others find it.

<a href="https://star-history.com/#unison-labs-ai/code-chunk&Date">
  <img src="https://api.star-history.com/svg?repos=unison-labs-ai/code-chunk&type=Date" width="600" alt="Star History Chart" />
</a>

---

## Part of the Unison Labs constellation

**One brain, every agent.** Every repo below reads from _and writes to_ the same [Unison brain](https://unisonlabs.ai) — no per-tool memory silos.

| Repo | What it does |
|---|---|
| [unison-brain](https://github.com/unison-labs-ai/unison-brain) | CLI · SDK · MCP server — the core |
| [claude-unison](https://github.com/unison-labs-ai/claude-unison) | Memory for Claude Code |
| [cursor-unison](https://github.com/unison-labs-ai/cursor-unison) | Memory for Cursor |
| [codex-unison](https://github.com/unison-labs-ai/codex-unison) | Memory for OpenAI Codex CLI |
| [opencode-unison](https://github.com/unison-labs-ai/opencode-unison) | Memory for OpenCode |
| [openclaw-unison](https://github.com/unison-labs-ai/openclaw-unison) | Memory for OpenClaw |
| [pipecat-unison](https://github.com/unison-labs-ai/pipecat-unison) | Memory for Pipecat voice agents |
| [python-sdk](https://github.com/unison-labs-ai/python-sdk) | Python SDK for the brain |
| [install-mcp](https://github.com/unison-labs-ai/install-mcp) | One-command MCP installer |
| **[code-chunk](https://github.com/unison-labs-ai/code-chunk)** | **AST-aware code chunking ← you are here** |
| [unison-fs](https://github.com/unison-labs-ai/unison-fs) | Mount the brain as a filesystem |
| [backchannel](https://github.com/unison-labs-ai/backchannel) | Async messaging between agents |
| [Unison-evals](https://github.com/unison-labs-ai/Unison-evals) | Open memory benchmark suite |

## License

MIT
