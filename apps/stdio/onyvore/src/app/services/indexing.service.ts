import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { createHash } from 'crypto';
import { NlpService } from './nlp.service';
import { SearchIndexService } from './search-index.service';
import { LinkGraphService } from './link-graph.service';
import { MetadataService } from './metadata.service';
import { TfidfService } from './tfidf.service';
import { WikilinkService } from './wikilink.service';
import { MentionService } from './mention.service';

/**
 * The single indexing pipeline, shared by file events, ignore-rule changes,
 * initialization, and reconciliation.
 *
 * Indexing is deliberately two-phase. `registerDocument` populates the corpus;
 * `computeEdges` derives links from it. Both TF-IDF (which needs corpus-wide
 * document frequency) and mention matching (which needs every title registered)
 * produce wrong answers if edges are computed while documents are still being
 * added, so callers must finish registering a batch before computing its edges.
 */
@Injectable()
export class IndexingService {
  constructor(
    private readonly nlpService: NlpService,
    private readonly searchIndexService: SearchIndexService,
    private readonly linkGraphService: LinkGraphService,
    private readonly metadataService: MetadataService,
    private readonly tfidfService: TfidfService,
    private readonly wikilinkService: WikilinkService,
    private readonly mentionService: MentionService,
  ) {}

  /** Content hash used to recognize a rename. */
  hash(content: string): string {
    return createHash('sha1').update(content).digest('hex');
  }

  /**
   * Move a note that was renamed rather than edited.
   *
   * The saving is the NLP pass: extracting noun phrases dominates indexing
   * cost, and a rename changes none of the content it reads. Term vectors and
   * document frequency are re-keyed rather than recomputed.
   *
   * Links still have to be rebuilt — the note's *title* changed, so notes
   * mentioning the old name no longer match and wikilinks written against it
   * now resolve elsewhere or nowhere.
   */
  async renameDocument(
    notebookId: string,
    from: string,
    to: string,
    content: string,
    mtimeMs: number,
    contentHash?: string,
  ): Promise<void> {
    // Drop everything keyed by the old path, keeping the terms themselves.
    this.linkGraphService.removeAllEdgesForFile(notebookId, from);
    this.linkGraphService.unregisterFile(notebookId, from);
    this.mentionService.unregisterFile(notebookId, from);
    this.metadataService.removeFile(notebookId, from);
    await this.searchIndexService.removeDocument(notebookId, from);

    this.tfidfService.renameDocument(notebookId, from, to);
    this.wikilinkService.renameFile(notebookId, from, to);

    await this.searchIndexService.addDocument(
      notebookId,
      to,
      this.searchTitleFromPath(to),
      content,
    );
    this.mentionService.registerFile(notebookId, to);
    this.linkGraphService.registerFile(notebookId, to);
    this.metadataService.setFile(
      notebookId,
      to,
      mtimeMs,
      contentHash ?? this.hash(content),
    );
  }

  /** Phase 1 — add or replace a document across every index. */
  async registerDocument(
    notebookId: string,
    relativePath: string,
    content: string,
    mtimeMs: number,
    contentHash?: string,
  ): Promise<void> {
    await this.searchIndexService.addDocument(
      notebookId,
      relativePath,
      this.searchTitleFromPath(relativePath),
      content,
    );

    const terms = this.nlpService.extractTerms(content);
    this.tfidfService.setDocument(notebookId, relativePath, terms);
    this.mentionService.registerFile(notebookId, relativePath);
    this.linkGraphService.registerFile(notebookId, relativePath);
    this.metadataService.setFile(
      notebookId,
      relativePath,
      mtimeMs,
      contentHash ?? this.hash(content),
    );
  }

  /**
   * Phase 2 — recompute this document's edges.
   *
   * `refreshInbound` additionally re-derives the edges pointing *at* this file.
   * Set it when the file is new: notes already in the corpus may mention its
   * title or contain a wikilink that could not resolve until now.
   */
  computeEdges(
    notebookId: string,
    relativePath: string,
    content: string,
    options: { refreshInbound: boolean },
  ): void {
    const similar = this.tfidfService.computeEdgesForDocument(notebookId, relativePath);
    this.linkGraphService.replaceSymmetricEdgesForFile(
      notebookId,
      relativePath,
      'similar',
      similar,
    );

    const mentions = this.mentionService.computeOutboundEdges(notebookId, relativePath);
    this.linkGraphService.replaceOutboundEdgesForFile(
      notebookId,
      relativePath,
      'mention',
      mentions,
    );

    const wikilinks = this.wikilinkService.extractAndResolve(
      notebookId,
      relativePath,
      content,
    );
    this.linkGraphService.replaceOutboundEdgesForFile(
      notebookId,
      relativePath,
      'explicit',
      wikilinks,
    );

    if (options.refreshInbound) {
      this.linkGraphService.replaceInboundEdgesForFile(
        notebookId,
        relativePath,
        'mention',
        this.mentionService.computeInboundEdges(notebookId, relativePath),
      );
      this.linkGraphService.replaceInboundEdgesForFile(
        notebookId,
        relativePath,
        'explicit',
        this.wikilinkService.computeInboundEdges(notebookId, relativePath),
      );
    }
  }

  /** Remove a document from every index and prune its edges. */
  async removeDocument(notebookId: string, relativePath: string): Promise<void> {
    await this.searchIndexService.removeDocument(notebookId, relativePath);
    this.tfidfService.removeDocument(notebookId, relativePath);
    this.mentionService.unregisterFile(notebookId, relativePath);
    this.wikilinkService.unregisterFile(notebookId, relativePath);
    this.linkGraphService.removeAllEdgesForFile(notebookId, relativePath);
    this.linkGraphService.unregisterFile(notebookId, relativePath);
    this.metadataService.removeFile(notebookId, relativePath);
  }

  /** Drop every trace of a notebook from memory. */
  clearNotebook(notebookId: string): void {
    this.searchIndexService.removeIndex(notebookId);
    this.linkGraphService.removeGraph(notebookId);
    this.metadataService.remove(notebookId);
    this.tfidfService.removeCorpus(notebookId);
    this.mentionService.removeNotebook(notebookId);
    this.wikilinkService.removeNotebook(notebookId);
  }

  /**
   * Search title for a note, path-qualified so "work overview" ranks
   * `work/overview.md` above `personal/overview.md`.
   */
  searchTitleFromPath(relativePath: string): string {
    const basename = path.basename(relativePath, '.md');
    const dir = path.dirname(relativePath);
    if (dir && dir !== '.') {
      return `${path.basename(dir)} ${basename}`;
    }
    return basename;
  }
}
