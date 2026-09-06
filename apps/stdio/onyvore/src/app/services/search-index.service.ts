import { Injectable } from '@nestjs/common';
import { create, insert, remove, search, save, load } from '@orama/orama';
import type { Orama } from '@orama/orama';
import { LinkGraphService } from './link-graph.service';

const SCHEMA = {
  relativePath: 'string',
  title: 'string',
  content: 'string',
} as const;

type OnyvoreIndex = Orama<typeof SCHEMA>;

/** Serialized index format. Bump when the envelope shape changes. */
const INDEX_FORMAT_VERSION = 2;

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
    const id = await insert(index, { relativePath, title, content });
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

  async searchNotebook(
    notebookId: string,
    query: string,
    limit = 20,
  ): Promise<Array<{ relativePath: string; title: string; score: number; snippets: string[] }>> {
    const index = this.indexes.get(notebookId);
    if (!index) return [];

    const results = await search(index, {
      term: query,
      properties: ['title', 'relativePath', 'content'],
      tolerance: 1,
      limit: limit * 2, // Fetch extra so we can re-rank
    });

    // Graph-boosted ranking: finalScore = oramaScore * (1 + log2(1 + inboundLinkCount))
    const boosted = results.hits.map((hit) => {
      const doc = hit.document as { relativePath: string; title: string; content: string };
      const inboundCount = this.linkGraphService.getInboundCount(
        notebookId,
        doc.relativePath,
      );
      const boost = 1 + Math.log2(1 + inboundCount);
      return {
        relativePath: doc.relativePath,
        title: doc.title,
        score: hit.score * boost,
        snippets: this.extractSnippets(doc.content, query),
      };
    });

    boosted.sort((a, b) => b.score - a.score);
    return boosted.filter((r) => r.snippets.length > 0).slice(0, limit);
  }

  private extractSnippets(content: string, query: string): string[] {
    if (!content) return [];
    const lowerContent = content.toLowerCase();
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    // Find all match positions
    const positions: number[] = [];
    for (const term of terms) {
      let idx = 0;
      while ((idx = lowerContent.indexOf(term, idx)) !== -1) {
        positions.push(idx);
        idx += term.length;
      }
    }
    if (positions.length === 0) return [];
    positions.sort((a, b) => a - b);

    // Merge overlapping windows into non-overlapping snippets
    const windowSize = 120;
    const padding = 40;
    const windows: Array<{ start: number; end: number }> = [];
    for (const pos of positions) {
      const start = Math.max(0, pos - padding);
      const end = Math.min(content.length, pos + padding + windowSize - 2 * padding);
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
