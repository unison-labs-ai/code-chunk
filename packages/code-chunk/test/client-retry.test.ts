/**
 * Tests for BrainClient retry/backoff and pushChunks rollback.
 *
 * These run with an injected fake `fetch` — no UNISON_TOKEN and no network.
 * They cover the wire contract and the failure-handling the live smoke test
 * surfaced (429 rate limiting, orphaned chunks on mid-file failure).
 */

import { describe, expect, test } from 'bun:test'
import { ingestFile } from '../src/ingest'
import { BrainApiError, BrainClient } from '../src/ingest/client'

// A fake Response good enough for the client's needs.
function jsonResponse(
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...headers },
	})
}

const noSleep = async () => {}

describe('BrainClient retry/backoff', () => {
	test('retries on 429 then succeeds', async () => {
		let calls = 0
		const fetchFn = (async () => {
			calls++
			if (calls < 3) {
				return jsonResponse(429, {
					error: { code: 'rate_limited', message: 'slow down' },
				})
			}
			return jsonResponse(200, { user: { id: 'u', email: 'e' } })
		}) as unknown as typeof fetch

		const client = new BrainClient({
			token: 't',
			fetch: fetchFn,
			sleep: noSleep,
		})
		const res = await client.whoami()
		expect(calls).toBe(3)
		expect(res).toHaveProperty('user')
	})

	test('retries on transient 503', async () => {
		let calls = 0
		const fetchFn = (async () => {
			calls++
			if (calls < 2)
				return jsonResponse(503, { error: { code: 'unavailable' } })
			return jsonResponse(200, { ok: true })
		}) as unknown as typeof fetch

		const client = new BrainClient({
			token: 't',
			fetch: fetchFn,
			sleep: noSleep,
		})
		await client.status()
		expect(calls).toBe(2)
	})

	test('gives up after maxRetries and throws BrainApiError', async () => {
		let calls = 0
		const fetchFn = (async () => {
			calls++
			return jsonResponse(429, { error: { code: 'rate_limited' } })
		}) as unknown as typeof fetch

		const client = new BrainClient({
			token: 't',
			fetch: fetchFn,
			sleep: noSleep,
			maxRetries: 3,
		})
		try {
			await client.whoami()
			expect(true).toBe(false) // should not reach
		} catch (err) {
			expect(err).toBeInstanceOf(BrainApiError)
			expect((err as BrainApiError).statusCode).toBe(429)
		}
		// 1 initial attempt + 3 retries
		expect(calls).toBe(4)
	})

	test('does NOT retry on non-retryable 4xx (e.g. 401)', async () => {
		let calls = 0
		const fetchFn = (async () => {
			calls++
			return jsonResponse(401, { error: { code: 'unauthorized' } })
		}) as unknown as typeof fetch

		const client = new BrainClient({
			token: 't',
			fetch: fetchFn,
			sleep: noSleep,
		})
		await expect(client.whoami()).rejects.toBeInstanceOf(BrainApiError)
		expect(calls).toBe(1)
	})

	test('honours Retry-After header (seconds)', async () => {
		let calls = 0
		const delays: number[] = []
		const fetchFn = (async () => {
			calls++
			if (calls < 2)
				return jsonResponse(
					429,
					{ error: { code: 'rate_limited' } },
					{ 'retry-after': '2' },
				)
			return jsonResponse(200, { ok: true })
		}) as unknown as typeof fetch

		const client = new BrainClient({
			token: 't',
			fetch: fetchFn,
			sleep: async (ms) => {
				delays.push(ms)
			},
		})
		await client.status()
		expect(delays).toEqual([2000])
	})

	test('sends bearer token and correct URL/body shape', async () => {
		let captured: { url: string; init: RequestInit } | null = null
		const fetchFn = (async (url: string, init: RequestInit) => {
			captured = { url, init }
			return jsonResponse(200, { path: '/private/notes/x.md' })
		}) as unknown as typeof fetch

		const client = new BrainClient({
			token: 'usk_live_abc',
			fetch: fetchFn,
			baseUrl: 'https://brain.example.ai/',
		})
		await client.writeDoc({ path: '/private/notes/x.md', bodyMd: '# hi' })

		expect(captured).not.toBeNull()
		const c = captured as unknown as { url: string; init: RequestInit }
		expect(c.url).toBe('https://brain.example.ai/v1/brain/doc')
		expect(c.init.method).toBe('PUT')
		expect((c.init.headers as Record<string, string>).Authorization).toBe(
			'Bearer usk_live_abc',
		)
		const body = JSON.parse(c.init.body as string)
		expect(body.path).toBe('/private/notes/x.md')
		expect(body.bodyMd).toBe('# hi')
	})
})

describe('pushChunks rollback on mid-file failure', () => {
	test('deletes already-written chunks when a later write fails', async () => {
		const written: string[] = []
		const deleted: string[] = []
		let writeCalls = 0

		const fetchFn = (async (url: string, init: RequestInit) => {
			const method = init.method
			if (method === 'PUT') {
				writeCalls++
				const body = JSON.parse(init.body as string)
				// Fail on the 2nd chunk write.
				if (writeCalls === 2) {
					return jsonResponse(500, {
						error: { code: 'boom', message: 'write failed' },
					})
				}
				written.push(body.path)
				return jsonResponse(200, { path: body.path })
			}
			if (method === 'DELETE') {
				const u = new URL(url)
				deleted.push(u.searchParams.get('path') ?? '')
				return jsonResponse(200, { deleted: true })
			}
			return jsonResponse(200, {})
		}) as unknown as typeof fetch

		// A file large enough to produce multiple chunks.
		const code = `export function a(){ return 1 }
export function b(){ return 2 }
export function c(){ return 3 }
export function d(){ return 4 }`

		let threw = false
		try {
			await ingestFile('multi.ts', code, {
				maxChunkSize: 40,
				client: { token: 't', fetch: fetchFn, maxRetries: 0 },
			})
		} catch (err) {
			threw = true
			// The first successfully-written chunk must have been rolled back.
			expect((err as { rolledBack?: string[] }).rolledBack).toEqual(written)
		}
		expect(threw).toBe(true)
		// At least one chunk was written, and every written chunk was deleted.
		expect(written.length).toBeGreaterThan(0)
		expect(deleted).toEqual(written)
	})
})
