/**
 * How an edge between two notes was derived.
 *
 * - `explicit` — the author wrote a [[wikilink]]. Directional.
 * - `mention`  — a noun phrase in the source matched the target's title.
 *                Directional; `count` is the number of occurrences.
 * - `similar`  — TF-IDF cosine similarity between whole documents.
 *                Symmetric; `count` is `similarity * 100`, not a mention count.
 */
export type EdgeType = 'explicit' | 'mention' | 'similar';

export interface Edge {
  source: string;
  target: string;
  type: EdgeType;
  /** The matched phrase (`explicit`/`mention`) or top shared term (`similar`). */
  noun: string;
  displayText?: string;
  count: number;
}
