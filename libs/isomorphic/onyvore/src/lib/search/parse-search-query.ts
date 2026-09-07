export interface ParsedQuery {
  /** Bare words. ANDed, matched by prefix. */
  terms: string[];
  /** "quoted phrases". Must appear as consecutive whole words. */
  phrases: string[];
  /** -excluded words. A note containing any of them is dropped. */
  exclude: string[];
  /** title: scoped terms. */
  title: string[];
  /** path: scoped terms. */
  path: string[];
  /** in:folder/ — restricts results to a path prefix. */
  inFolder: string | null;
  /** links:note — notes linking to that note. */
  links: string | null;
  /** related:note — notes similar to that note. */
  related: string | null;
  /** is:orphan — notes with no authored or mention links. */
  isOrphan: boolean;
  /** The query as typed. */
  raw: string;
}

/** Operators that take a value. Anything else before a colon is literal text. */
const VALUE_OPERATORS = new Set(['title', 'path', 'in', 'links', 'related']);

function empty(raw: string): ParsedQuery {
  return {
    terms: [],
    phrases: [],
    exclude: [],
    title: [],
    path: [],
    inFolder: null,
    links: null,
    related: null,
    isOrphan: false,
    raw,
  };
}

/**
 * Parse a search query.
 *
 * Everything narrows: terms, phrases, and filters all AND together. There is no
 * OR and no grouping — see the non-goals in the search plan.
 *
 * An unrecognized `word:value` is treated as literal text rather than an error.
 * Notes contain colons, and a search box that rejects what the user typed is
 * worse than one that searches for it.
 */
export function parseSearchQuery(raw: string): ParsedQuery {
  const result = empty(raw);

  for (const token of splitTokens(raw)) {
    const { text, quoted } = token;
    if (!text) continue;

    if (quoted) {
      result.phrases.push(text);
      continue;
    }

    if (text.startsWith('-') && text.length > 1) {
      result.exclude.push(text.slice(1).toLowerCase());
      continue;
    }

    const colon = text.indexOf(':');
    if (colon > 0) {
      const key = text.slice(0, colon).toLowerCase();
      const value = text.slice(colon + 1);

      if (key === 'is' && value.toLowerCase() === 'orphan') {
        result.isOrphan = true;
        continue;
      }

      if (VALUE_OPERATORS.has(key) && value) {
        applyOperator(result, key, value);
        continue;
      }
      // Unknown operator, or one with no value: fall through as literal text.
    }

    result.terms.push(text.toLowerCase());
  }

  return result;
}

function applyOperator(result: ParsedQuery, key: string, value: string): void {
  switch (key) {
    case 'title':
      result.title.push(value.toLowerCase());
      break;
    case 'path':
      result.path.push(value.toLowerCase());
      break;
    case 'in':
      // Normalize separators and drop a trailing slash so `in:work` and
      // `in:work/` mean the same thing.
      result.inFolder = value.replace(/\\/g, '/').replace(/\/+$/, '');
      break;
    case 'links':
      result.links = value;
      break;
    case 'related':
      result.related = value;
      break;
  }
}

interface RawToken {
  text: string;
  quoted: boolean;
}

/**
 * Split on whitespace, keeping "quoted runs" together.
 *
 * A quote directly after an operator — `title:"cold proof"` — keeps the
 * operator attached, so the phrase scopes to that field instead of becoming a
 * separate bare phrase.
 */
function splitTokens(raw: string): RawToken[] {
  const tokens: RawToken[] = [];
  let current = '';
  let quoted = false;
  let inQuotes = false;

  const push = () => {
    if (current) tokens.push({ text: current, quoted });
    current = '';
    quoted = false;
  };

  for (const char of raw) {
    if (char === '"') {
      if (inQuotes) {
        inQuotes = false;
        // `title:"..."` stays one token; a bare quote becomes a phrase.
        if (!current.includes(':')) quoted = true;
      } else {
        inQuotes = true;
      }
      continue;
    }

    if (!inQuotes && /\s/.test(char)) {
      push();
      continue;
    }

    current += char;
  }

  // An unterminated quote still yields its content — the user is mid-typing.
  if (inQuotes && current && !current.includes(':')) quoted = true;
  push();

  return tokens;
}

/** True when the query asks for nothing at all. */
export function isEmptyQuery(query: ParsedQuery): boolean {
  return (
    query.terms.length === 0 &&
    query.phrases.length === 0 &&
    query.title.length === 0 &&
    query.path.length === 0 &&
    query.exclude.length === 0 &&
    !query.inFolder &&
    !query.links &&
    !query.related &&
    !query.isOrphan
  );
}

/**
 * True when the query has filters but nothing to rank by.
 *
 * These cannot go through the search index at all — there is no term to score —
 * so they are answered by enumerating the notebook and filtering.
 */
export function isFilterOnlyQuery(query: ParsedQuery): boolean {
  if (isEmptyQuery(query)) return false;
  return (
    query.terms.length === 0 &&
    query.phrases.length === 0 &&
    query.title.length === 0 &&
    query.path.length === 0
  );
}

/** A short human description of what will run, for the search box. */
export function describeQuery(query: ParsedQuery): string {
  const parts: string[] = [];

  if (query.terms.length) parts.push(query.terms.join(' + '));
  for (const phrase of query.phrases) parts.push(`"${phrase}"`);
  for (const value of query.title) parts.push(`title has ${value}`);
  for (const value of query.path) parts.push(`path has ${value}`);
  if (query.inFolder) parts.push(`in ${query.inFolder}/`);
  if (query.links) parts.push(`links to ${query.links}`);
  if (query.related) parts.push(`related to ${query.related}`);
  if (query.isOrphan) parts.push('unlinked');
  for (const value of query.exclude) parts.push(`not ${value}`);

  return parts.join(', ');
}
