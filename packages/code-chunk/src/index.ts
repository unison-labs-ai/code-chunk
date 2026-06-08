/**
 * @unisonlabs/code-chunk — AST-aware code chunking for the Unison brain
 *
 * Provides intelligent code chunking that preserves semantic context by
 * leveraging tree-sitter for AST parsing. Each chunk includes contextual
 * information about its scope, entities, siblings, and imports.
 *
 * Integration with the Unison brain: use the `ingest` export to push
 * chunks directly into your Unison brain workspace.
 *
 * @packageDocumentation
 */

// Batch processing
export {
	chunkBatch,
	chunkBatchEffect,
	chunkBatchStream,
	chunkBatchStreamEffect,
} from './batch'

// Main chunking functions
export {
	ChunkingError,
	chunk,
	chunkStream,
	chunkStreamEffect,
	UnsupportedLanguageError,
} from './chunk'

// Chunker factory
export { createChunker } from './chunker'

// Context formatting utility
export { formatChunkWithContext } from './context/format'
export type {
	BrainClientOptions,
	BrainDocument,
	IngestBatchOptions,
	IngestFileError,
	IngestFileResult,
	IngestOptions,
	IngestResult,
	WhoAmIResponse,
	WriteDocInput,
} from './ingest'

// Unison brain ingest
export {
	BrainApiError,
	BrainClient,
	chunkBrainPath,
	chunkDocumentTitle,
	chunkDocumentTldr,
	formatChunkDocument,
	ingestBatch,
	ingestBatchStream,
	ingestFile,
	isWritableRoot,
	pushChunks,
	slugify,
} from './ingest'
// Language detection
export { detectLanguage, LANGUAGE_EXTENSIONS } from './parser/languages'
// All public types
export type {
	ASTWindow,
	BatchFileError,
	BatchFileResult,
	BatchOptions,
	BatchResult,
	ByteRange,
	Chunk,
	ChunkContext,
	ChunkEntityInfo,
	Chunker,
	ChunkOptions,
	EntityInfo,
	EntityType,
	ExtractedEntity,
	FileInput,
	ImportInfo,
	Language,
	LineRange,
	ParseError,
	ParseResult,
	ScopeNode,
	ScopeTree,
	SiblingInfo,
	SyntaxNode,
	SyntaxTree,
} from './types'
