/**
 * Brain FS path helpers for code-chunk ingest paths.
 *
 * By default, ingested chunks are written to:
 *   /private/notes/code-<repo?>-<file-path-slug>-chunk-<n>.md
 *
 * This flat layout satisfies the FS contract's one-slug-segment rule for
 * /private/notes/<slug>.md. Path separators in the file path are collapsed
 * to dashes so the result is a single flat slug with no subfolders.
 *
 * Custom root prefixes must be under /private/notes/ or /workspace/<kind>/.
 * Team docs live under /workspace/teams/<slug>/ — a bare /teams/ root is
 * rejected by the brain's root-guard. Nested subfolders beyond the kind
 * segment are not accepted by the brain; use the flat slug approach below.
 */

const WRITABLE_ROOTS = ['/private/', '/workspace/']

/**
 * Slugify a string for use in a brain path segment.
 * Lowercases, replaces non-alphanumeric chars (including path separators)
 * with -, collapses consecutive dashes, and trims them from ends.
 */
export function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^-|-$/g, '')
}

/**
 * Check if a path is under a writable brain root.
 */
export function isWritableRoot(path: string): boolean {
	return WRITABLE_ROOTS.some((r) => path.startsWith(r))
}

/**
 * Build the brain document path for a code chunk.
 *
 * The default output is a flat /private/notes/<slug>.md path where the slug
 * encodes the repo (optional), file path, and chunk index as dash-separated
 * segments — no subfolders. This satisfies the brain's FS contract which
 * requires exactly one slug segment after the kind directory.
 *
 * Example (no repo):  /private/notes/code-src-user-ts-chunk-0.md
 * Example (with repo): /private/notes/code-my-project-src-auth-ts-chunk-2.md
 *
 * @param filepath - The original source file path (e.g. src/services/user.ts)
 * @param chunkIndex - The chunk index (0-based)
 * @param repo - Optional repo/project name used as a prefix in the slug
 * @param prefix - Optional override; must be a valid writable brain root such
 *   as '/private/notes/' (default) or '/workspace/notes/'. Nested subfolders are
 *   not supported by the brain FS contract.
 */
export function chunkBrainPath(
	filepath: string,
	chunkIndex: number,
	repo?: string,
	prefix?: string,
): string {
	const root = prefix ?? '/private/notes/'

	if (!isWritableRoot(root)) {
		throw new Error(
			`Brain path prefix "${root}" is not under a writable root (/private/, /workspace/). Team docs must be under /workspace/teams/<slug>/.`,
		)
	}

	// Normalise the root to end with /
	const normRoot = root.endsWith('/') ? root : `${root}/`

	// Build a flat slug: code-[repo-]<file-path-slug>-chunk-<n>
	// Path separators and dots in filepath are collapsed to dashes by slugify.
	const fileSlug = slugify(filepath.replace(/^\//, ''))
	const repoPart = repo ? `${slugify(repo)}-` : ''

	const slug = `code-${repoPart}${fileSlug}-chunk-${chunkIndex}`

	return `${normRoot}${slug}.md`
}
