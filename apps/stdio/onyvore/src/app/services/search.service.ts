import { Injectable } from '@nestjs/common';
import {
  parseSearchQuery,
  isEmptyQuery,
  isFilterOnlyQuery,
  resolveWikilinkTarget,
  hasAnyWordPrefix,
  hasPhrase,
  type ParsedQuery,
  type NotebookSearchHit,
  type NotebookSearchResults,
} from '@onivoro/isomorphic-onyvore';
import {
  SearchIndexService,
  pathTextFor,
  type IndexedDocument,
  type SearchIndexHit,
  type SearchProperty,
} from './search-index.service';
import { LinkGraphService } from './link-graph.service';
import { MetadataService } from './metadata.service';

/** A candidate before ranking — index hits and filter-only rows converge here. */
interface Candidate {
  relativePath: string;
  title: string;
  content: string;
  score: number;
  matchedIn: NotebookSearchHit['matchedIn'];
  approximate: boolean;
}

/**
 * Query semantics: parse, retrieve, filter, rank.
 *
 * Retrieval belongs to `SearchIndexService`; what a query *means* belongs here,
 * so the operators that read the link graph live beside the ones that read
 * text rather than being bolted onto the index.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly searchIndexService: SearchIndexService,
    private readonly linkGraphService: LinkGraphService,
    private readonly metadataService: MetadataService,
  ) {}

  async search(
    notebookId: string,
    rawQuery: string,
    limit = 20,
  ): Promise<NotebookSearchResults> {
    const query = parseSearchQuery(rawQuery);
    if (isEmptyQuery(query)) return { hits: [], widened: false };

    const { candidates, widened } = isFilterOnlyQuery(query)
      ? { candidates: await this.enumerate(notebookId), widened: false }
      : await this.retrieve(notebookId, query, limit);

    const kept = candidates.filter((c) => this.passes(notebookId, query, c));
    const ranked = this.rank(notebookId, kept, isFilterOnlyQuery(query));

    return {
      hits: ranked.slice(0, limit).map((c) => this.present(query, c)),
      widened,
    };
  }

  /** The parsed form, so callers can explain the query without reparsing. */
  parse(rawQuery: string): ParsedQuery {
    return parseSearchQuery(rawQuery);
  }

  // ---- retrieval -----------------------------------------------------------

  private async retrieve(
    notebookId: string,
    query: ParsedQuery,
    limit: number,
  ): Promise<{ candidates: Candidate[]; widened: boolean }> {
    // A field-scoped query searches only that field; otherwise all of them.
    const scoped: SearchProperty[] = [];
    if (query.title.length) scoped.push('title');
    if (query.path.length) scoped.push('pathText');

    const terms = [
      ...query.terms,
      ...query.title,
      ...query.path,
      // A phrase still needs its words retrieved; contiguity is checked after.
      ...query.phrases.flatMap((phrase) => phrase.split(/\s+/).filter(Boolean)),
    ];

    if (terms.length === 0) {
      return { candidates: await this.enumerate(notebookId), widened: false };
    }

    const { hits, widened } = await this.searchIndexService.searchNotebook(
      notebookId,
      terms,
      limit,
      scoped.length && !query.terms.length && !query.phrases.length
        ? { fieldProperties: scoped }
        : {},
    );

    return { candidates: hits.map(toCandidate), widened };
  }

  /**
   * Every note in the notebook, for a query with filters but nothing to rank —
   * `is:orphan`, `links:x`, `in:folder/`. There is no term to score, so the
   * index cannot answer it and the notebook is enumerated instead.
   */
  private async enumerate(notebookId: string): Promise<Candidate[]> {
    const docs = await this.searchIndexService.allDocuments(notebookId);
    return docs.map((doc: IndexedDocument) => ({
      relativePath: doc.relativePath,
      title: doc.title,
      content: doc.content,
      score: 0,
      matchedIn: [],
      approximate: false,
    }));
  }

  // ---- filtering -----------------------------------------------------------

  private passes(
    notebookId: string,
    query: ParsedQuery,
    candidate: Candidate,
  ): boolean {
    const { relativePath, title, content } = candidate;
    const pathText = pathTextFor(relativePath);

    for (const phrase of query.phrases) {
      if (!hasPhrase(content, phrase) && !hasPhrase(title, phrase)) return false;
    }

    for (const term of query.title) {
      if (!hasAnyWordPrefix(title, [term])) return false;
    }

    for (const term of query.path) {
      if (!hasAnyWordPrefix(pathText, [term])) return false;
    }

    for (const term of query.exclude) {
      if (
        hasAnyWordPrefix(content, [term]) ||
        hasAnyWordPrefix(title, [term]) ||
        hasAnyWordPrefix(pathText, [term])
      ) {
        return false;
      }
    }

    if (query.inFolder !== null && !this.inFolder(relativePath, query.inFolder)) {
      return false;
    }

    if (query.isOrphan && !this.isOrphan(notebookId, relativePath)) return false;

    if (query.links !== null) {
      const target = this.resolveNote(notebookId, query.links);
      if (!target) return false;
      if (!this.linksTo(notebookId, relativePath, target)) return false;
    }

    if (query.related !== null) {
      const target = this.resolveNote(notebookId, query.related);
      if (!target) return false;
      if (relativePath === target) return false;
      if (!this.isRelatedTo(notebookId, relativePath, target)) return false;
    }

    return true;
  }

  /** `in:work` matches `work/a.md` and `work/deep/b.md`, not `workshop/c.md`. */
  private inFolder(relativePath: string, folder: string): boolean {
    if (!folder) return true;
    const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
    return normalized.startsWith(`${folder.toLowerCase()}/`);
  }

  private isOrphan(notebookId: string, relativePath: string): boolean {
    return this.linkGraphService.getOrphans(notebookId).includes(relativePath);
  }

  /** Does `source` have any edge pointing at `target`? */
  private linksTo(notebookId: string, source: string, target: string): boolean {
    const links = this.linkGraphService.getLinksForNote(notebookId, source);
    return [...links.explicitOutbound, ...links.mentionOutbound].some(
      (entry) => entry.notePath === target,
    );
  }

  private isRelatedTo(notebookId: string, source: string, target: string): boolean {
    return this.linkGraphService
      .getLinksForNote(notebookId, source)
      .similar.some((entry) => entry.notePath === target);
  }

  /**
   * Resolve a note reference in `links:` / `related:`.
   *
   * Reuses wikilink resolution so `links:hotsauce` accepts exactly what
   * `[[hotsauce]]` accepts — one concept, one rule.
   */
  private resolveNote(notebookId: string, reference: string): string | null {
    const files = Object.keys(this.metadataService.getAllFiles(notebookId));
    return resolveWikilinkTarget(reference, files);
  }

  // ---- ranking and presentation --------------------------------------------

  private rank(
    notebookId: string,
    candidates: Candidate[],
    filterOnly: boolean,
  ): Candidate[] {
    if (filterOnly) {
      // Nothing was scored, so order by path — stable and predictable.
      return [...candidates].sort((a, b) =>
        a.relativePath.localeCompare(b.relativePath),
      );
    }

    return [...candidates]
      .map((candidate) => ({
        ...candidate,
        score: candidate.score * this.graphBoost(notebookId, candidate.relativePath),
      }))
      .sort((a, b) => b.score - a.score);
  }

  /** Well-connected notes outrank isolated ones at equal text relevance. */
  private graphBoost(notebookId: string, relativePath: string): number {
    const inbound = this.linkGraphService.getInboundCount(notebookId, relativePath);
    return 1 + Math.log2(1 + inbound);
  }

  private present(query: ParsedQuery, candidate: Candidate): NotebookSearchHit {
    const highlightTerms = [
      ...query.terms,
      ...query.title,
      ...query.path,
      ...query.phrases.flatMap((phrase) => phrase.split(/\s+/).filter(Boolean)),
    ];

    const snippets = this.searchIndexService.extractSnippets(
      candidate.content,
      highlightTerms,
    );

    return {
      relativePath: candidate.relativePath,
      title: candidate.title,
      score: candidate.score,
      snippets,
      matchedIn: candidate.matchedIn,
      // A note matched by its name has no snippet to show, so show its opening
      // line instead of an empty result.
      preview:
        snippets.length === 0
          ? this.searchIndexService.leadPreview(candidate.content)
          : undefined,
      approximate: candidate.approximate || undefined,
    };
  }
}

function toCandidate(hit: SearchIndexHit): Candidate {
  return {
    relativePath: hit.relativePath,
    title: hit.title,
    content: hit.content,
    score: hit.score,
    matchedIn: hit.matchedIn,
    approximate: hit.approximate,
  };
}
