/**
 * One definition of "this text matched", shared by the server (which finds
 * snippet positions) and the webview (which highlights them).
 *
 * The rule mirrors what the search engine actually does: Orama matches tokens
 * by *prefix*, so `ferment` matches "fermented" but nothing matches the middle
 * of a word. Matching by plain substring — as this used to — highlights the
 * `run` inside "brunch" for a document the engine matched on something else
 * entirely.
 */

const WORD_CHAR = '[\\p{L}\\p{N}_]';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split a word-ish run of characters, lowercased. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/**
 * A pattern matching any of `terms` at the start of a word.
 *
 * Returns null when there is nothing to match, so callers can skip the work
 * rather than build a regex that matches everything.
 */
export function wordPrefixPattern(terms: string[]): RegExp | null {
  const cleaned = terms.map((t) => t.trim()).filter(Boolean).map(escapeRegExp);
  if (cleaned.length === 0) return null;

  // Longest first, so "sourdough" wins over "sour" when both are present.
  cleaned.sort((a, b) => b.length - a.length);
  return new RegExp(`(?<!${WORD_CHAR})(${cleaned.join('|')})`, 'giu');
}

/** Does any word in `text` start with `term`? */
export function hasWordPrefix(text: string, term: string): boolean {
  const pattern = wordPrefixPattern([term]);
  return pattern ? pattern.test(text) : false;
}

/** Does any word in `text` start with any of `terms`? */
export function hasAnyWordPrefix(text: string, terms: string[]): boolean {
  return terms.some((term) => hasWordPrefix(text, term));
}

/**
 * Does `text` contain `phrase` as consecutive whole words?
 *
 * Phrase search is the one place a user has asked for exactness, so the final
 * word must match whole rather than by prefix — `"cold proof"` should not
 * match "cold proofing".
 */
export function hasPhrase(text: string, phrase: string): boolean {
  const words = tokenize(phrase);
  if (words.length === 0) return false;

  const pattern = new RegExp(
    `(?<!${WORD_CHAR})${words.map(escapeRegExp).join(`(?:${WORD_CHAR}*[^\\p{L}\\p{N}_]+)`)}(?!${WORD_CHAR})`,
    'iu',
  );
  return pattern.test(text);
}

/** Offsets where any term begins a word. */
export function matchPositions(text: string, terms: string[]): number[] {
  const pattern = wordPrefixPattern(terms);
  if (!pattern) return [];

  const positions: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    positions.push(match.index);
    if (match[0].length === 0) pattern.lastIndex++; // guard against zero-width
  }
  return positions;
}
