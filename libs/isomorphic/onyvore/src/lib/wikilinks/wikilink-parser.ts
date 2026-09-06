export interface ParsedWikilink {
  /** The link target as written, before resolution. */
  target: string;
  /** The `|display text` half, when present. */
  displayText: string | null;
  /** Offset of the opening `[[` in the original content. */
  start: number;
  /** Offset just past the closing `]]`. */
  end: number;
}

/**
 * Wikilink parsing and resolution, shared by the stdio server (which builds the
 * link graph) and the extension host (which drives editor navigation,
 * completion, and diagnostics).
 *
 * This lives in the isomorphic library on purpose: if the two processes
 * resolved links separately, ctrl-clicking `[[foo]]` could open a different
 * note than the one the graph drew an edge to.
 */

/**
 * Blank out fenced and inline code with equal-length whitespace.
 *
 * Replacing rather than deleting keeps every subsequent offset valid, which is
 * what lets callers map a parsed link back to its position in the document.
 */
function maskCode(content: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, ' ');
  return content
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/`[^`\n]*`/g, blank);
}

/** Parse `[[target]]` and `[[target|display text]]`, skipping code. */
export function parseWikilinks(content: string): ParsedWikilink[] {
  const masked = maskCode(content);
  const results: ParsedWikilink[] = [];
  const regex = /\[\[([^\][]+)\]\]/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(masked)) !== null) {
    const inner = match[1];
    if (!inner.trim()) continue;

    const pipeIndex = inner.indexOf('|');
    const rawTarget = pipeIndex === -1 ? inner : inner.substring(0, pipeIndex);
    const target = rawTarget.trim();
    if (!target) continue;

    const displayText =
      pipeIndex === -1 ? null : inner.substring(pipeIndex + 1).trim() || null;

    results.push({
      target,
      displayText,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return results;
}

/** Normalize separators so Windows-style relative paths compare correctly. */
function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/** Filename without its `.md` extension. */
export function noteBasename(relativePath: string): string {
  const posix = toPosix(relativePath);
  const name = posix.slice(posix.lastIndexOf('/') + 1);
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

/**
 * Resolve a wikilink target to a file path, Obsidian-compatibly:
 *
 * 1. A trailing `.md` on the target is ignored.
 * 2. A target containing `/` is matched as a path, case-insensitively.
 * 3. Otherwise it matches any note with that basename, case-insensitively.
 * 4. When several notes match, the shortest path wins.
 *
 * Returns null when nothing matches — an unresolved link produces no edge and
 * is reported to the author rather than silently dropped.
 */
export function resolveWikilinkTarget(
  target: string,
  allFiles: string[],
): string | null {
  const normalized = target.endsWith('.md') ? target.slice(0, -3) : target;
  if (!normalized) return null;

  if (normalized.includes('/')) {
    const wanted = toPosix(`${normalized}.md`).toLowerCase();
    return allFiles.find((f) => toPosix(f).toLowerCase() === wanted) ?? null;
  }

  const wanted = normalized.toLowerCase();
  const matches = allFiles.filter((f) => noteBasename(f).toLowerCase() === wanted);

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Shortest path wins — the note closest to the notebook root is the most
  // likely referent when a basename is ambiguous.
  return [...matches].sort((a, b) => a.length - b.length)[0];
}

/**
 * The link text to suggest for a note, qualified by its parent directory only
 * when the bare basename would be ambiguous.
 */
export function wikilinkCompletionFor(
  relativePath: string,
  allFiles: string[],
): string {
  const basename = noteBasename(relativePath);
  const ambiguous =
    allFiles.filter((f) => noteBasename(f).toLowerCase() === basename.toLowerCase())
      .length > 1;

  if (!ambiguous) return basename;

  const posix = toPosix(relativePath);
  return posix.endsWith('.md') ? posix.slice(0, -3) : posix;
}
