export interface HashedPath {
  relativePath: string;
  hash?: string;
}

export interface RenamePair {
  from: string;
  to: string;
}

/**
 * Pair deletions with creations that carry identical content — a rename.
 *
 * `FileSystemWatcher` reports a rename as a delete followed by a create, and so
 * does a startup diff against `metadata.json`. Recognizing the pair lets the
 * indexer move the note instead of re-parsing content that never changed.
 *
 * A hash is only allowed to pair when exactly one deletion and one creation
 * share it. Identical content is common in practice — two empty notes, two
 * copies of a template — and guessing which became which would attribute a
 * note's links to the wrong file. Ambiguous groups fall back to delete +
 * create, which is always correct, just slower.
 */
export function detectRenames(
  deleted: HashedPath[],
  created: HashedPath[],
): RenamePair[] {
  const deletedByHash = groupByHash(deleted);
  const createdByHash = groupByHash(created);

  const pairs: RenamePair[] = [];
  for (const [hash, froms] of deletedByHash) {
    const tos = createdByHash.get(hash);
    if (!tos || froms.length !== 1 || tos.length !== 1) continue;
    pairs.push({ from: froms[0], to: tos[0] });
  }

  return pairs;
}

function groupByHash(entries: HashedPath[]): Map<string, string[]> {
  const byHash = new Map<string, string[]>();

  for (const { relativePath, hash } of entries) {
    if (!hash) continue; // no hash, no pairing
    const paths = byHash.get(hash);
    if (paths) {
      paths.push(relativePath);
    } else {
      byHash.set(hash, [relativePath]);
    }
  }

  return byHash;
}
