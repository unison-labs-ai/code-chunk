/**
 * Brain FS path helpers for code-chunk ingest paths.
 *
 * By default, ingested chunks are written to:
 *   /tenant/code/<repo>/<filepath>/<chunkIndex>.md
 *
 * Custom root prefixes must be under /private/, /tenant/, or /teams/<slug>/.
 */

const WRITABLE_ROOTS = ['/private/', '/tenant/', '/teams/']

/**
 * Slugify a string for use in a brain path segment.
 * Lowercases, replaces non-alphanumeric (except . and -) with -.
 * Collapses consecutive dashes and trims them from ends.
 */
export function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9.\-/]/g, '-')
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
 * @param filepath - The original source file path (e.g. src/services/user.ts)
 * @param chunkIndex - The chunk index (0-based)
 * @param repo - Optional repo/project name (used as a namespace segment)
 * @param prefix - Optional writable root prefix (default: /tenant/code/)
 */
export function chunkBrainPath(
	filepath: string,
	chunkIndex: number,
	repo?: string,
	prefix?: string,
): string {
	const root = prefix ?? '/tenant/code/'

	if (!isWritableRoot(root)) {
		throw new Error(
			`Brain path prefix "${root}" is not under a writable root (/private/, /tenant/, /teams/<slug>/).`,
		)
	}

	// Normalise the root to end with /
	const normRoot = root.endsWith('/') ? root : `${root}/`

	// Slugify path segments
	const sluggedFile = slugify(filepath.replace(/^\//, ''))
	const repoSegment = repo ? `${slugify(repo)}/` : ''

	return `${normRoot}${repoSegment}${sluggedFile}/chunk-${chunkIndex}.md`
}
