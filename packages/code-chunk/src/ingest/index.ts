/**
 * Unison brain ingest for code chunks.
 *
 * Chunks source code using tree-sitter AST-aware splitting, then pushes
 * each chunk as a document into the Unison brain via the REST API.
 *
 * Environment variables:
 *   UNISON_TOKEN      — usk_live_... API key (required)
 *   UNISON_API_URL    — override API base URL (default: https://brain.unisonlabs.ai)
 *
 * @example
 * ```ts
 * import { ingestFile, ingestBatch } from '@unisonlabs/code-chunk/ingest'
 *
 * // Ingest a single file
 * const result = await ingestFile('src/user.ts', sourceCode)
 * console.log(`Pushed ${result.chunks} chunks to ${result.paths.length} brain docs`)
 *
 * // Ingest a batch
 * const results = await ingestBatch([
 *   { filepath: 'src/user.ts', code: userCode },
 *   { filepath: 'src/auth.ts', code: authCode },
 * ])
 * ```
 */

export type {
	BrainClientOptions,
	BrainDocument,
	WhoAmIResponse,
	WriteDocInput,
} from './client'
export { BrainApiError, BrainClient } from './client'
export {
	chunkDocumentTitle,
	chunkDocumentTldr,
	formatChunkDocument,
} from './format'
export { chunkBrainPath, isWritableRoot, slugify } from './path'

import {
	ChunkingError,
	chunk as chunkCode,
	UnsupportedLanguageError,
} from '../chunk'
import type { Chunk, ChunkOptions } from '../types'
import type { BrainClientOptions } from './client'
import { BrainClient } from './client'
import {
	chunkDocumentTitle,
	chunkDocumentTldr,
	formatChunkDocument,
} from './format'
import { chunkBrainPath } from './path'

export { ChunkingError, UnsupportedLanguageError }

/**
 * Options for brain ingest operations.
 */
export interface IngestOptions extends ChunkOptions {
	/**
	 * Repository / project name used as a prefix in the flat brain path slug.
	 * E.g. "my-repo" → /private/notes/code-my-repo-src-user-ts-chunk-0.md
	 */
	repo?: string

	/**
	 * Writable brain root prefix (default: /private/notes/).
	 * Must be under /private/ or /workspace/. Team docs must be placed under
	 * /workspace/teams/<slug>/ — a bare /teams/ root is rejected by the brain.
	 * The brain FS contract requires exactly one slug segment after the kind
	 * directory; chunkBrainPath produces a flat slug with no subfolders.
	 */
	pathPrefix?: string

	/**
	 * Tags to attach to every ingested chunk document.
	 */
	tags?: string[]

	/**
	 * Brain visibility: 'workspace' (visible to whole org) or 'private'.
	 * Default: 'workspace'
	 */
	visibility?: 'workspace' | 'private'

	/**
	 * Brain client options (token, baseUrl, etc.).
	 * Falls back to UNISON_TOKEN / UNISON_API_URL environment variables.
	 */
	client?: BrainClientOptions
}

/**
 * Result of ingesting a single file.
 */
export interface IngestFileResult {
	/** The source file path that was ingested */
	filepath: string
	/** Number of chunks pushed to the brain */
	chunks: number
	/** Brain document paths written (one per chunk) */
	paths: string[]
	/** Any error that occurred (null on success) */
	error: null
}

/**
 * Error result when ingesting a single file.
 */
export interface IngestFileError {
	/** The source file path that failed */
	filepath: string
	/** null on error */
	chunks: null
	/** null on error */
	paths: null
	/**
	 * Brain document paths that were written before the failure and then rolled
	 * back (best-effort deleted). Present for observability; on success the file
	 * is atomic — either all chunks land or none remain.
	 */
	rolledBack?: string[]
	/** The error that occurred */
	error: Error
}

export type IngestResult = IngestFileResult | IngestFileError

/**
 * Options for batch ingest.
 */
export interface IngestBatchOptions extends IngestOptions {
	/**
	 * Maximum number of files to ingest concurrently.
	 * @default 5
	 */
	concurrency?: number

	/**
	 * Progress callback called after each file is processed.
	 */
	onProgress?: (
		completed: number,
		total: number,
		filepath: string,
		success: boolean,
	) => void
}

/**
 * Push a single set of pre-computed chunks to the Unison brain.
 *
 * @param filepath - Original source file path (used for path generation and metadata)
 * @param chunks   - Pre-computed chunks from `chunk()` or `chunkStream()`
 * @param opts     - Ingest options
 * @returns IngestFileResult with paths of written brain documents
 */
export async function pushChunks(
	filepath: string,
	chunks: Chunk[],
	opts: IngestOptions = {},
): Promise<IngestFileResult> {
	const client = new BrainClient(opts.client)
	const tags = opts.tags ?? []
	const visibility = opts.visibility ?? 'workspace'
	const totalChunks = chunks.length
	const paths: string[] = []

	try {
		for (const chunk of chunks) {
			const brainPath = chunkBrainPath(
				filepath,
				chunk.index,
				opts.repo,
				opts.pathPrefix,
			)
			const bodyMd = formatChunkDocument(chunk, filepath, totalChunks)
			const scope =
				chunk.context.scope.length > 0
					? chunk.context.scope
							.map((s) => s.name)
							.reverse()
							.join(' > ')
					: undefined
			const title = chunkDocumentTitle(
				filepath,
				chunk.index,
				totalChunks,
				scope,
			)
			const tldr = chunkDocumentTldr(chunk, filepath)

			await client.writeDoc({
				path: brainPath,
				bodyMd,
				kind: 'raw',
				title,
				tldr,
				tags,
				visibility,
			})

			paths.push(brainPath)
		}
	} catch (err) {
		// Roll back: a file is atomic — if any chunk write fails, best-effort
		// delete the chunks already written so no orphaned docs are left behind.
		const rolledBack: string[] = []
		for (const path of paths) {
			try {
				await client.deleteDoc(path)
				rolledBack.push(path)
			} catch {
				// Ignore rollback errors (e.g. delete not permitted on this deployment).
			}
		}
		const error = err instanceof Error ? err : new Error(String(err))
		Object.assign(error, { rolledBack })
		throw error
	}

	return { filepath, chunks: totalChunks, paths, error: null }
}

/**
 * Chunk a source file and push all chunks into the Unison brain.
 *
 * This is the primary ingest entry point. It:
 * 1. Chunks the source code using AST-aware splitting
 * 2. Writes each chunk as a brain document at /private/notes/code-<repo?>-<filepath-slug>-chunk-N.md
 *
 * @param filepath - File path (used for language detection and brain path generation)
 * @param code     - Source code string
 * @param opts     - Chunk + ingest options
 * @returns Ingest result with paths of written brain documents
 *
 * @throws ChunkingError if chunking fails
 * @throws UnsupportedLanguageError if the file extension is not supported
 * @throws BrainApiError if any brain write fails
 */
export async function ingestFile(
	filepath: string,
	code: string,
	opts: IngestOptions = {},
): Promise<IngestFileResult> {
	const chunks = await chunkCode(filepath, code, opts)
	return pushChunks(filepath, chunks, opts)
}

/**
 * Chunk and ingest multiple files concurrently into the Unison brain.
 *
 * @param files   - Array of { filepath, code, options? }
 * @param opts    - Batch ingest options
 * @returns Array of ingest results (one per file, never throws)
 */
export async function ingestBatch(
	files: Array<{ filepath: string; code: string; options?: IngestOptions }>,
	opts: IngestBatchOptions = {},
): Promise<IngestResult[]> {
	const { concurrency = 5, onProgress, ...sharedOpts } = opts
	const total = files.length
	const results: IngestResult[] = []
	let completed = 0

	// Process files with limited concurrency
	const semaphore = new Semaphore(concurrency)

	await Promise.all(
		files.map(async (file) => {
			await semaphore.acquire()
			try {
				const mergedOpts = { ...sharedOpts, ...file.options }
				const result = await ingestFile(file.filepath, file.code, mergedOpts)
				results.push(result)
				completed++
				onProgress?.(completed, total, file.filepath, true)
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err))
				results.push({
					filepath: file.filepath,
					chunks: null,
					paths: null,
					rolledBack: (error as { rolledBack?: string[] }).rolledBack,
					error,
				})
				completed++
				onProgress?.(completed, total, file.filepath, false)
			} finally {
				semaphore.release()
			}
		}),
	)

	return results
}

/**
 * Stream ingest results as files complete.
 */
export async function* ingestBatchStream(
	files: Array<{ filepath: string; code: string; options?: IngestOptions }>,
	opts: IngestBatchOptions = {},
): AsyncGenerator<IngestResult> {
	const { concurrency = 5, ...sharedOpts } = opts
	const semaphore = new Semaphore(concurrency)
	const queue: Array<Promise<IngestResult>> = []

	for (const file of files) {
		const p = semaphore.run(async () => {
			try {
				const mergedOpts = { ...sharedOpts, ...file.options }
				return await ingestFile(file.filepath, file.code, mergedOpts)
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err))
				return {
					filepath: file.filepath,
					chunks: null,
					paths: null,
					rolledBack: (error as { rolledBack?: string[] }).rolledBack,
					error,
				} satisfies IngestFileError
			}
		})
		queue.push(p)
	}

	for (const p of queue) {
		yield await p
	}
}

/**
 * Minimal semaphore for concurrency control.
 */
class Semaphore {
	private permits: number
	private waiting: Array<() => void> = []

	constructor(permits: number) {
		this.permits = permits
	}

	async acquire(): Promise<void> {
		if (this.permits > 0) {
			this.permits--
			return
		}
		return new Promise<void>((resolve) => {
			this.waiting.push(resolve)
		})
	}

	release(): void {
		const next = this.waiting.shift()
		if (next) {
			next()
		} else {
			this.permits++
		}
	}

	async run<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquire()
		try {
			return await fn()
		} finally {
			this.release()
		}
	}
}
