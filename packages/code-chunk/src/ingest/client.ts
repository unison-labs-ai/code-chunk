/**
 * Minimal REST client for the Unison brain API.
 *
 * Reads UNISON_TOKEN and UNISON_API_URL from environment variables.
 * Sends Authorization: Bearer <token> on every request.
 *
 * All paths are relative to /v1 on the base URL.
 */

export interface BrainClientOptions {
	/** Override the API base URL (defaults to UNISON_API_URL env var, then https://brain.unisonlabs.ai) */
	baseUrl?: string
	/** API token (defaults to UNISON_TOKEN env var) */
	token?: string
	/** Custom fetch implementation */
	fetch?: typeof fetch
	/**
	 * Maximum automatic retries for rate-limited (429) and transient (502/503/504)
	 * responses. Set to 0 to disable. Default: 8.
	 */
	maxRetries?: number
	/**
	 * Base delay in milliseconds for exponential backoff between retries.
	 * A server `Retry-After` header, when present, takes precedence. Default: 500.
	 */
	retryBaseMs?: number
	/** Custom sleep implementation (mainly for tests). Defaults to setTimeout. */
	sleep?: (ms: number) => Promise<void>
}

export interface BrainDocument {
	path: string
	title?: string
	bodyMd?: string
	tldr?: string
	tags?: string[]
	kind?: string
	visibility?: 'workspace' | 'private'
}

export interface WriteDocInput {
	path: string
	bodyMd: string
	kind?: string
	title?: string
	tldr?: string
	tags?: string[]
	visibility?: 'workspace' | 'private'
	expectedContentHash?: string
	source?: { kind: string; ref: string }
}

export interface WhoAmIResponse {
	user: { id: string; email: string }
	workspace: { id: string; name: string; verified: boolean }
	scopes: string[]
}

export interface BrainStatusResponse {
	docCount: number
	docWithEmbedding: number
	entityCount: number
	factCount: number
	lastIngestAt: string | null
	pendingJobs: number
	staleWikiPageCount: number
}

export class BrainApiError extends Error {
	readonly _tag = 'BrainApiError'
	readonly statusCode: number
	readonly code: string

	constructor(statusCode: number, code: string, message: string) {
		super(message)
		this.name = 'BrainApiError'
		this.statusCode = statusCode
		this.code = code
	}
}

/**
 * Lightweight REST client for the Unison brain API.
 *
 * @example
 * ```ts
 * const client = new BrainClient()
 * await client.write({ path: '/private/notes/foo.md', bodyMd: '# Hello' })
 * ```
 */
/** HTTP statuses that are safe to retry: rate limiting + transient gateway errors. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])

export class BrainClient {
	private readonly baseUrl: string
	private readonly token: string | undefined
	private readonly fetchFn: typeof fetch
	private readonly maxRetries: number
	private readonly retryBaseMs: number
	private readonly sleepFn: (ms: number) => Promise<void>

	constructor(opts: BrainClientOptions = {}) {
		const rawBase =
			opts.baseUrl ??
			(typeof process !== 'undefined'
				? process.env['UNISON_API_URL']
				: undefined) ??
			'https://brain.unisonlabs.ai'

		// Strip trailing slash
		this.baseUrl = rawBase.replace(/\/$/, '')

		this.token =
			opts.token ??
			(typeof process !== 'undefined' ? process.env['UNISON_TOKEN'] : undefined)

		this.fetchFn = opts.fetch ?? globalThis.fetch
		this.maxRetries = opts.maxRetries ?? 8
		this.retryBaseMs = opts.retryBaseMs ?? 500
		this.sleepFn =
			opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
	}

	/**
	 * Compute the backoff delay (ms) before the next retry. Honours the server's
	 * `Retry-After` header (seconds or HTTP-date); otherwise uses exponential
	 * backoff with "equal jitter" — a growing floor plus randomised half. The
	 * floor matters: the brain rate-limits per key with a slow-refill quota, so
	 * a retry that fires near-instantly (full jitter) just hits the wall again.
	 */
	private retryDelayMs(attempt: number, retryAfter: string | null): number {
		if (retryAfter) {
			const asSeconds = Number(retryAfter)
			if (Number.isFinite(asSeconds)) return Math.max(0, asSeconds * 1000)
			const asDate = Date.parse(retryAfter)
			if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now())
		}
		// Equal jitter: delay in [floor/2, floor], floor growing exponentially,
		// capped at 60s. Guarantees retries actually space out under load.
		const floor = Math.min(this.retryBaseMs * 2 ** attempt, 60_000)
		return Math.round(floor / 2 + Math.random() * (floor / 2))
	}

	private headers(): Record<string, string> {
		const h: Record<string, string> = { 'Content-Type': 'application/json' }
		if (this.token) {
			h['Authorization'] = `Bearer ${this.token}`
		}
		return h
	}

	private url(path: string): string {
		const p = path.startsWith('/') ? path : `/${path}`
		return `${this.baseUrl}/v1${p}`
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
		params?: Record<string, string | string[]>,
	): Promise<T> {
		let urlStr = this.url(path)
		if (params) {
			const sp = new URLSearchParams()
			for (const [k, v] of Object.entries(params)) {
				if (Array.isArray(v)) {
					for (const item of v) sp.append(k, item)
				} else {
					sp.set(k, v)
				}
			}
			const qs = sp.toString()
			if (qs) urlStr += `?${qs}`
		}

		const reqInit: RequestInit = {
			method,
			headers: this.headers(),
			body: body !== undefined ? JSON.stringify(body) : undefined,
		}

		// Retry loop: rate-limited (429) and transient gateway errors back off and
		// retry up to maxRetries; everything else is returned/thrown immediately.
		for (let attempt = 0; ; attempt++) {
			const res = await this.fetchFn(urlStr, reqInit)

			if (res.ok) {
				const contentType = res.headers.get('content-type') ?? ''
				if (contentType.includes('application/json')) {
					return res.json() as Promise<T>
				}
				return res.text() as unknown as T
			}

			let code = 'unknown_error'
			let message = `HTTP ${res.status}`
			try {
				const json = (await res.json()) as {
					error?: { code?: string; message?: string }
				}
				code = json.error?.code ?? code
				message = json.error?.message ?? message
			} catch {
				// ignore json parse errors
			}

			if (RETRYABLE_STATUSES.has(res.status) && attempt < this.maxRetries) {
				await this.sleepFn(
					this.retryDelayMs(attempt, res.headers.get('retry-after')),
				)
				continue
			}

			throw new BrainApiError(res.status, code, message)
		}
	}

	async whoami(): Promise<WhoAmIResponse> {
		return this.request<WhoAmIResponse>('GET', '/auth/whoami')
	}

	async writeDoc(input: WriteDocInput): Promise<BrainDocument> {
		return this.request<BrainDocument>('PUT', '/brain/doc', input)
	}

	async getDoc(path: string): Promise<BrainDocument> {
		return this.request<BrainDocument>('GET', '/brain/doc', undefined, { path })
	}

	async deleteDoc(path: string): Promise<{ deleted: boolean }> {
		return this.request<{ deleted: boolean }>(
			'DELETE',
			'/brain/doc',
			undefined,
			{ path },
		)
	}

	async tagDoc(
		path: string,
		add?: string[],
		remove?: string[],
	): Promise<BrainDocument> {
		return this.request<BrainDocument>('POST', '/brain/doc/tag', {
			path,
			add,
			remove,
		})
	}

	async status(): Promise<BrainStatusResponse> {
		return this.request<BrainStatusResponse>('GET', '/brain/status')
	}
}
