/**
 * Tests for the Unison brain ingest module.
 *
 * The ingest tests that touch the real brain API are gated behind
 * UNISON_TOKEN being set. Without a token, only local logic (path
 * generation, formatting, path validation) is tested.
 *
 * To run the live ingest tests:
 *   UNISON_TOKEN=usk_live_... bun test test/ingest.test.ts
 */

import { describe, expect, test } from 'bun:test'
import {
	BrainApiError,
	BrainClient,
	chunkBrainPath,
	chunkDocumentTitle,
	chunkDocumentTldr,
	formatChunkDocument,
	ingestFile,
	isWritableRoot,
	slugify,
} from '../src/ingest'
import type { Chunk } from '../src/types'

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

describe('slugify', () => {
	test('lowercases and replaces spaces', () => {
		expect(slugify('Hello World')).toBe('hello-world')
	})

	test('replaces dots and slashes with dashes', () => {
		expect(slugify('src/utils.ts')).toBe('src-utils-ts')
	})

	test('collapses consecutive dashes', () => {
		expect(slugify('foo--bar')).toBe('foo-bar')
	})
})

describe('isWritableRoot', () => {
	test('accepts /private/', () => {
		expect(isWritableRoot('/private/notes/foo.md')).toBe(true)
	})
	test('accepts /tenant/', () => {
		expect(isWritableRoot('/tenant/code/foo.md')).toBe(true)
	})
	test('accepts /teams/eng/', () => {
		expect(isWritableRoot('/teams/eng/docs/foo.md')).toBe(true)
	})
	test('rejects /actions/', () => {
		expect(isWritableRoot('/actions/foo.md')).toBe(false)
	})
	test('rejects bare path', () => {
		expect(isWritableRoot('foo.md')).toBe(false)
	})
})

describe('chunkBrainPath', () => {
	test('generates flat path under /private/notes/ by default', () => {
		const p = chunkBrainPath('src/user.ts', 0)
		expect(p).toBe('/private/notes/code-src-user-ts-chunk-0.md')
	})

	test('includes repo as slug prefix when provided', () => {
		const p = chunkBrainPath('src/auth.ts', 2, 'my-project')
		expect(p).toBe('/private/notes/code-my-project-src-auth-ts-chunk-2.md')
	})

	test('respects custom prefix (must be a valid writable root)', () => {
		const p = chunkBrainPath('lib/utils.py', 1, undefined, '/private/notes/')
		expect(p).toBe('/private/notes/code-lib-utils-py-chunk-1.md')
	})

	test('throws on non-writable prefix', () => {
		expect(() => chunkBrainPath('foo.ts', 0, undefined, '/actions/')).toThrow()
	})

	test('path ends with .md', () => {
		const p = chunkBrainPath('main.go', 0)
		expect(p.endsWith('.md')).toBe(true)
	})

	test('slug contains no path separators', () => {
		const p = chunkBrainPath('deeply/nested/src/file.ts', 0)
		const slug = p.replace('/private/notes/', '').replace('.md', '')
		expect(slug).not.toContain('/')
	})
})

// ---------------------------------------------------------------------------
// Document formatting
// ---------------------------------------------------------------------------

const makeChunk = (overrides: Partial<Chunk> = {}): Chunk => ({
	text: 'function greet(name: string) {\n  return `Hello, ${name}!`\n}',
	contextualizedText:
		'# test.ts\n# Defines: greet(name: string): string\n\nfunction greet(name: string) {\n  return `Hello, ${name}!`\n}',
	byteRange: { start: 0, end: 60 },
	lineRange: { start: 0, end: 2 },
	context: {
		filepath: 'test.ts',
		language: 'typescript',
		scope: [],
		entities: [
			{
				name: 'greet',
				type: 'function',
				signature: 'greet(name: string): string',
			},
		],
		siblings: [],
		imports: [],
	},
	index: 0,
	totalChunks: 1,
	...overrides,
})

describe('formatChunkDocument', () => {
	test('includes chunk metadata comment', () => {
		const doc = formatChunkDocument(makeChunk(), 'test.ts', 1)
		expect(doc).toContain('<!-- chunk: 1/1 -->')
		expect(doc).toContain('<!-- file: test.ts -->')
		expect(doc).toContain('<!-- lines: 1-3 -->')
		expect(doc).toContain('<!-- language: typescript -->')
	})

	test('includes defines comment for non-import entities', () => {
		const doc = formatChunkDocument(makeChunk(), 'test.ts', 1)
		expect(doc).toContain('<!-- defines: greet(name: string): string -->')
	})

	test('contains fenced code block', () => {
		const doc = formatChunkDocument(makeChunk(), 'test.ts', 1)
		expect(doc).toContain('```typescript')
		expect(doc).toContain('function greet')
	})

	test('contains contextualized text block', () => {
		const doc = formatChunkDocument(makeChunk(), 'test.ts', 1)
		expect(doc).toContain('contextualised text for semantic search')
		expect(doc).toContain('# Defines: greet')
	})
})

describe('chunkDocumentTitle', () => {
	test('formats title with chunk number', () => {
		expect(chunkDocumentTitle('src/user.ts', 0, 3)).toBe('user.ts [1/3]')
	})

	test('includes scope when provided', () => {
		expect(chunkDocumentTitle('src/user.ts', 1, 3, 'UserService')).toBe(
			'user.ts · UserService [2/3]',
		)
	})
})

describe('chunkDocumentTldr', () => {
	test('includes filename and line range', () => {
		const tldr = chunkDocumentTldr(makeChunk(), 'src/user.ts')
		expect(tldr).toContain('user.ts')
		expect(tldr).toContain('lines 1-3')
	})

	test('includes entity names when present', () => {
		const tldr = chunkDocumentTldr(makeChunk(), 'test.ts')
		expect(tldr).toContain('greet')
	})
})

// ---------------------------------------------------------------------------
// BrainClient — live tests (only run when UNISON_TOKEN is set)
// ---------------------------------------------------------------------------

const LIVE = !!process.env['UNISON_TOKEN']

describe('BrainClient', () => {
	test('whoami succeeds with a valid token', async () => {
		if (!LIVE) {
			console.log('Skipping live test: UNISON_TOKEN not set')
			return
		}

		const client = new BrainClient()
		const result = await client.whoami()

		expect(result).toHaveProperty('user')
		expect(result).toHaveProperty('tenant')
		expect(result).toHaveProperty('scopes')
		expect(result.scopes).toContain('brain:read')
	})

	test('throws BrainApiError on 401 with bad token', async () => {
		const client = new BrainClient({ token: 'usk_live_bad_token' })
		try {
			await client.whoami()
			expect(true).toBe(false) // should not reach here
		} catch (err) {
			expect(err).toBeInstanceOf(BrainApiError)
			expect((err as BrainApiError).statusCode).toBe(401)
		}
	})
})

// ---------------------------------------------------------------------------
// ingestFile — live ingest test (only runs when UNISON_TOKEN is set)
// ---------------------------------------------------------------------------

describe('ingestFile', () => {
	test('ingests a TypeScript snippet into the brain', async () => {
		if (!LIVE) {
			console.log('Skipping live ingest test: UNISON_TOKEN not set')
			return
		}

		const code = `import { readFile } from 'fs/promises'

export async function loadConfig(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as Record<string, unknown>
}

export function mergeConfigs(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return { ...base, ...overrides }
}`

		const result = await ingestFile('test/fixtures/config.ts', code, {
			repo: 'code-chunk-test',
			tags: ['test', 'code-chunk'],
			visibility: 'tenant',
			maxChunkSize: 800,
		})

		expect(result.error).toBeNull()
		expect(result.chunks).toBeGreaterThan(0)
		expect(result.paths.length).toBe(result.chunks)

		// All paths should be flat slugs under /private/notes/
		for (const path of result.paths) {
			expect(path.startsWith('/private/notes/')).toBe(true)
			expect(path.endsWith('.md')).toBe(true)
			// No subfolders — exactly 3 segments: ['private','notes','<slug>.md']
			expect(path.split('/').filter(Boolean).length).toBe(3)
		}

		// Best-effort cleanup — some brain deployments may not support delete
		const client = new BrainClient()
		for (const path of result.paths) {
			await client.deleteDoc(path).catch(() => {
				// Ignore cleanup errors (e.g. delete not permitted on this deployment)
			})
		}
	})
})
