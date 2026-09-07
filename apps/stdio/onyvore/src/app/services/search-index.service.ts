import { Injectable } from '@nestjs/common';
import { create, insert, remove, search, save, load, getByID } from '@orama/orama';
import type { Orama } from '@orama/orama';
import {
  hasAnyWordPrefix,
  matchPositions,
  type SearchMatchField,
} from '@onivoro/isomorphic-onyvore';
import { LinkGraphService } from './link-graph.service';

export interface IndexedDocument {
  relativePath: string;
  title: string;
  pathText: string;
  content: string;
}

export interface SearchIndexHit {
  relativePath: string;
  title: string;
  content: string;
  score: number;
  matchedIn: SearchMatchField[];
  approximate: boolean;
}

/**
 * Searchable text for a path: directory segments and basename, extension
 * stripped, so `work/deep/notes.md` searches as "work deep notes".
 */
export function pathTextFor(relativePath: string): string {
  return relativePath
    .replace(/\.md$/i, '')
    .split(/[\\/]/)
    .filter(Boolean)
    .join(' ');
}

/**
 * Indexed fields. `relativePath` is deliberately absent: Orama preserves fields
 * outside the schema on the stored document, so the path still comes back with
 * every hit without every note sharing the token `md` — which used to make
 * searching "md" match the entire notebook. Path text is searchable through
 * `pathText`, which carries the directory segments with the extension stripped.
 */
const SCHEMA = {
  title: 'string',
  pathText: 'string',
  content: 'string',
} as const;

export type SearchProperty = 'title' | 'pathText' | 'content';

/** Fields a plain query searches, and how much each is worth. */
const SEARCH_PROPERTIES: SearchProperty[] = ['title', 'pathText', 'content'];
const FIELD_BOOST = { title: 4, pathText: 2, content: 1 };

/** Below this length, one edit of tolerance reaches too much of the vocabulary. */
const TOLERANCE_MIN_LENGTH = 4;

type OnyvoreIndex = Orama<typeof SCHEMA>;

/** Serialized index format. Bump when the envelope shape changes. */
const INDEX_FORMAT_VERSION = 3;

interface PersistedIndex {
  version: number;
  index: unknown;
  /** relativePath -> Orama internal document id */
  docIds: Record<string, string>;
}

@Injectable()
export class SearchIndexService {
  private indexes = new Map<string, OnyvoreIndex>();
  /** notebookId -> (relativePath -> Orama document id) */
  private docIds = new Map<string, Map<string, string>>();

  constructor(private readonly linkGraphService: LinkGraphService) {}

  async getOrCreateIndex(notebookId: string): Promise<OnyvoreIndex> {
    let index = this.indexes.get(notebookId);
    if (!index) {
      index = await create({ schema: SCHEMA });
      this.indexes.set(notebookId, index);
    }
    return index;
  }

  removeIndex(notebookId: string): void {
    this.indexes.delete(notebookId);
    this.docIds.delete(notebookId);
  }

  hasDocument(notebookId: string, relativePath: string): boolean {
    return this.docIds.get(notebookId)?.has(relativePath) ?? false;
  }

  getIndexedPaths(notebookId: string): string[] {
    const ids = this.docIds.get(notebookId);
    return ids ? Array.from(ids.keys()) : [];
  }

  /**
   * Insert a document, replacing any existing entry for the same path.
   * Idempotent — repeated adds for one path never accumulate duplicates.
   */
  async addDocument(
    notebookId: string,
    relativePath: string,
    title: string,
    content: string,
  ): Promise<void> {
    const index = await this.getOrCreateIndex(notebookId);
    await this.removeDocument(notebookId, relativePath);
    const id = await insert(index, {
      relativePath,
      title,
      pathText: pathTextFor(relativePath),
      content,
    });
    this.getOrCreateIds(notebookId).set(relativePath, id);
  }

  async updateDocument(
    notebookId: string,
    relativePath: string,
    title: string,
    content: string,
  ): Promise<void> {
    await this.addDocument(notebookId, relativePath, title, content);
  }

  /**
   * Remove a document by its tracked Orama id.
   *
   * Never resolve the target by searching for the path: Orama tokenizes
   * `relativePath`, so a search matches every note sharing a basename token
   * and can remove an unrelated note when the intended one is absent.
   */
  async removeDocument(notebookId: string, relativePath: string): Promise<void> {
    const index = this.indexes.get(notebookId);
    if (!index) return;

    const ids = this.docIds.get(notebookId);
    const id = ids?.get(relativePath);
    if (id === undefined) return;

    await remove(index, id);
    ids!.delete(relativePath);
  }

  /**
   * Run a free-text query against one notebook.
   *
   * Every hit Orama returns is kept. Deciding whether a result is *useful* and
   * deciding what to *show* for it are different questions, and conflating them
   * meant a note matched by its own filename was discarded for having no
   * content snippet — the single strongest signal, thrown away.
   */
  async searchNotebook(
    notebookId: string,
    terms: string[],
    limit = 20,
    options: { fieldProperties?: SearchProperty[] } = {},
  ): Promise<{ hits: SearchIndexHit[]; widened: boolean }> {
    const index = this.indexes.get(notebookId);
    if (!index || terms.length === 0) return { hits: [], widened: false };

    const properties = options.fieldProperties ?? SEARCH_PROPERTIES;
    const term = terms.join(' ');

    const run = (opts: { threshold?: number; tolerance?: number }) =>
      search(index, {
        term,
        properties,
        boost: FIELD_BOOST,
        limit: limit * 4,
        ...opts,
      });

    // Retrieval ladder, strictest first. Each rung only runs when the one
    // above found nothing, so recall widens only as far as it has to.
    //
    // 1. Every term must match, exactly. Typing another word narrows.
    let results = await run({ threshold: 0 });
    let widened = false;

    // 2. Any term matches. Reported, so the UI can say the search widened
    //    rather than silently changing what the query meant.
    if (results.hits.length === 0 && terms.length > 1) {
      results = await run({});
      widened = results.hits.length > 0;
    }

    // 3. Typo tolerance, last. Applying it on every pass is what made `md`
    //    match "my" and defeated the all-terms threshold — a fuzzy match
    //    always qualified. Short terms are excluded because at two or three
    //    characters, one edit reaches most of the vocabulary.
    if (results.hits.length === 0 && terms.some((t) => t.length >= TOLERANCE_MIN_LENGTH)) {
      results = await run({ tolerance: 1 });
    }

    const hits = results.hits.map((hit) => {
      const doc = hit.document as unknown as IndexedDocument;
      const matchedIn = this.matchFields(doc, terms);
      return {
        relativePath: doc.relativePath,
        title: doc.title,
        content: doc.content,
        score: hit.score,
        matchedIn,
        // Orama returned it, but no term begins a word in any field: it got
        // here through typo tolerance.
        approximate: matchedIn.length === 0,
      };
    });

    return { hits, widened };
  }

  /** Where each term begins a word, so a result can explain why it surfaced. */
  private matchFields(doc: IndexedDocument, terms: string[]): SearchMatchField[] {
    const fields: SearchMatchField[] = [];
    if (hasAnyWordPrefix(doc.content, terms)) fields.push('content');
    if (hasAnyWordPrefix(doc.title, terms)) fields.push('title');
    if (hasAnyWordPrefix(doc.pathText, terms)) fields.push('path');
    return fields;
  }

  /** Every indexed document, for queries that filter without ranking. */
  async allDocuments(notebookId: string): Promise<IndexedDocument[]> {
    const index = this.indexes.get(notebookId);
    const ids = this.docIds.get(notebookId);
    if (!index || !ids) return [];

    const docs: IndexedDocument[] = [];
    for (const [relativePath, id] of ids) {
      const doc = (await getByID(index, id)) as unknown as IndexedDocument | undefined;
      if (doc) docs.push({ ...doc, relativePath });
    }
    return docs;
  }

  /**
   * Text excerpts around each match.
   *
   * Positions come from the shared word-prefix rule rather than a raw substring
   * scan, so a highlight can never land somewhere the engine did not match —
   * searching `run` used to highlight the middle of "brunch".
   */
  extractSnippets(content: string, terms: string[]): string[] {
    if (!content || terms.length === 0) return [];

    const positions = matchPositions(content, terms);
    if (positions.length === 0) return [];

    const before = 40;
    const after = 80;
    const windows: Array<{ start: number; end: number }> = [];

    for (const pos of positions) {
      const start = Math.max(0, pos - before);
      const end = Math.min(content.length, pos + after);
      const last = windows[windows.length - 1];
      if (last && start <= last.end) {
        last.end = Math.max(last.end, end);
      } else {
        windows.push({ start, end });
      }
    }

    return windows.map(({ start, end }) => {
      let snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
      if (start > 0) snippet = '...' + snippet;
      if (end < content.length) snippet = snippet + '...';
      return snippet;
    });
  }

  /** The note's opening line, shown when a hit has no content match. */
  leadPreview(content: string, maxChars = 160): string | undefined {
    const text = content
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return undefined;
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  }

  async serialize(notebookId: string): Promise<Buffer | null> {
    const index = this.indexes.get(notebookId);
    if (!index) return null;

    const docIds: Record<string, string> = {};
    for (const [relativePath, id] of this.getOrCreateIds(notebookId)) {
      docIds[relativePath] = id;
    }

    const payload: PersistedIndex = {
      version: INDEX_FORMAT_VERSION,
      index: await save(index),
      docIds,
    };
    return Buffer.from(JSON.stringify(payload));
  }

  /**
   * Restore a persisted index. Throws on any format this build cannot read,
   * so the caller can fall back to a full rebuild rather than serving an
   * index that silently disagrees with metadata.json.
   */
  async deserialize(notebookId: string, data: Buffer): Promise<void> {
    const parsed = JSON.parse(data.toString());

    if (parsed?.version !== INDEX_FORMAT_VERSION) {
      throw new Error(
        `Unsupported index format (expected ${INDEX_FORMAT_VERSION}, got ${parsed?.version ?? 'none'})`,
      );
    }

    const index = await create({ schema: SCHEMA });
    await load(index, parsed.index);
    this.indexes.set(notebookId, index);

    const ids = new Map<string, string>(
      Object.entries((parsed as PersistedIndex).docIds ?? {}),
    );
    this.docIds.set(notebookId, ids);
  }

  private getOrCreateIds(notebookId: string): Map<string, string> {
    let ids = this.docIds.get(notebookId);
    if (!ids) {
      ids = new Map();
      this.docIds.set(notebookId, ids);
    }
    return ids;
  }
}
