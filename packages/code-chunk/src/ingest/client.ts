/**
 * Minimal REST client for the Unison brain API.
 *
 * Reads UNISON_TOKEN and UNISON_API_URL from environment variables.
 * Sends Authorization: Bearer <token> on every request.
 *
 * All paths are relative to /v1 on the base URL.
 */

export interface BrainClientOptions {
	/** Override the API base URL (defaults to UNISON_API_URL env var, then https://api.unisonlabs.ai) */
	baseUrl?: string
	/** API token (defaults to UNISON_TOKEN env var) */
	token?: string
	/** Custom fetch implementation */
	fetch?: typeof fetch
}

export interface BrainDocument {
	path: string
	title?: string
	bodyMd?: string
	tldr?: string
	tags?: string[]
	kind?: string
	visibility?: 'tenant' | 'private'
}

export interface WriteDocInput {
	path: string
	bodyMd: string
	kind?: string
	title?: string
	tldr?: string
	tags?: string[]
	visibility?: 'tenant' | 'private'
	expectedContentHash?: string
	source?: { kind: string; ref: string }
}

export interface WhoAmIResponse {
	user: { id: string; email: string }
	tenant: { id: string; name: string; verified: boolean }
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
export class BrainClient {
	private readonly baseUrl: string
	private readonly token: string | undefined
	private readonly fetchFn: typeof fetch

	constructor(opts: BrainClientOptions = {}) {
		const rawBase =
			opts.baseUrl ??
			(typeof process !== 'undefined'
				? process.env['UNISON_API_URL']
				: undefined) ??
			'https://api.unisonlabs.ai'

		// Strip trailing slash
		this.baseUrl = rawBase.replace(/\/$/, '')

		this.token =
			opts.token ??
			(typeof process !== 'undefined' ? process.env['UNISON_TOKEN'] : undefined)

		this.fetchFn = opts.fetch ?? globalThis.fetch
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

		const res = await this.fetchFn(urlStr, {
			method,
			headers: this.headers(),
			body: body !== undefined ? JSON.stringify(body) : undefined,
		})

		if (!res.ok) {
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
			throw new BrainApiError(res.status, code, message)
		}

		const contentType = res.headers.get('content-type') ?? ''
		if (contentType.includes('application/json')) {
			return res.json() as Promise<T>
		}
		return res.text() as unknown as T
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
