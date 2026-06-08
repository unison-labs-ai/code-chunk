/**
 * Markdown formatter for brain documents created from code chunks.
 *
 * Each chunk is stored as a Markdown document with YAML-like frontmatter
 * in the body, followed by the contextualized code text.
 */

import type { Chunk } from '../types'

/**
 * Format a code chunk as a brain document body (markdown).
 *
 * The document includes:
 * - Metadata section: filepath, language, line range, scope, entities
 * - The raw chunk text in a fenced code block (for grep/exact search)
 * - The contextualized text (for semantic search embedding)
 */
export function formatChunkDocument(
	chunk: Chunk,
	filepath: string,
	totalChunks: number,
): string {
	const { context, lineRange, index, text, contextualizedText } = chunk
	const language = context.language ?? 'unknown'

	const lines: string[] = []

	// Metadata section
	lines.push(`<!-- chunk: ${index + 1}/${totalChunks} -->`)
	lines.push(`<!-- file: ${filepath} -->`)
	lines.push(`<!-- lines: ${lineRange.start + 1}-${lineRange.end + 1} -->`)
	lines.push(`<!-- language: ${language} -->`)

	if (context.scope.length > 0) {
		const scopePath = context.scope
			.map((s) => s.name)
			.reverse()
			.join(' > ')
		lines.push(`<!-- scope: ${scopePath} -->`)
	}

	if (context.entities.length > 0) {
		const entityNames = context.entities
			.filter((e) => e.type !== 'import')
			.map((e) => e.signature ?? e.name)
			.join(', ')
		if (entityNames) {
			lines.push(`<!-- defines: ${entityNames} -->`)
		}
	}

	lines.push('')

	// Contextualised preamble (for embedding / semantic search)
	lines.push('<!-- contextualised text for semantic search:')
	lines.push(contextualizedText)
	lines.push('-->')
	lines.push('')

	// Raw code in fenced block (for grep / exact match)
	lines.push(`\`\`\`${language}`)
	lines.push(text)
	lines.push('```')

	return lines.join('\n')
}

/**
 * Build the title for a chunk brain document.
 */
export function chunkDocumentTitle(
	filepath: string,
	chunkIndex: number,
	totalChunks: number,
	scope?: string,
): string {
	const filename = filepath.split('/').pop() ?? filepath
	const scopePart = scope ? ` · ${scope}` : ''
	return `${filename}${scopePart} [${chunkIndex + 1}/${totalChunks}]`
}

/**
 * Build a TL;DR summary for a chunk document.
 */
export function chunkDocumentTldr(chunk: Chunk, filepath: string): string {
	const { context, lineRange } = chunk
	const filename = filepath.split('/').pop() ?? filepath
	const entities = context.entities
		.filter((e) => e.type !== 'import')
		.map((e) => e.name)
	const entityPart =
		entities.length > 0 ? `Defines: ${entities.slice(0, 3).join(', ')}.` : ''
	return `Code chunk from ${filename} (lines ${lineRange.start + 1}-${lineRange.end + 1}). ${entityPart}`.trim()
}
