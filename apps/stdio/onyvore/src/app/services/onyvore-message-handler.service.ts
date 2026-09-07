import { Injectable, Inject } from '@nestjs/common';
import { StdioHandler } from '@onivoro/server-stdio';
import { MESSAGE_BUS, MessageBus } from '@onivoro/isomorphic-jsonrpc';
import * as path from 'path';
import {
  onyvoreRpcMethods,
  type FileEventBatch,
  type NotebookInfo,
  type LinksForNote,
  type NotebookSearchGroup,
  type NotebookSearchResults,
  type NotebookSearchHit,
  type NotebookGraph,
  detectRenames,
} from '@onivoro/isomorphic-onyvore';
import { SearchIndexService } from './search-index.service';
import { LinkGraphService } from './link-graph.service';
import { MetadataService } from './metadata.service';
import { PersistenceService } from './persistence.service';
import { ReconciliationService } from './reconciliation.service';
import { IndexingService } from './indexing.service';
import { IgnoreService } from './ignore.service';
import { TfidfService } from './tfidf.service';
import { SearchService } from './search.service';
import {
  AppStdioOnyvoreConfig,
  type OnyvoreServerSettings,
} from '../app-stdio-onyvore-config.class';

/**
 * How strong a notebook's best hit is, on a scale that survives crossing
 * notebooks.
 *
 * Raw scores cannot be compared between indexes — BM25 depends on each corpus's
 * own statistics, so a 3.4 from a 40-note notebook and a 3.4 from a 4,000-note
 * one mean different things, and ordering groups by them made group order an
 * artifact of notebook size. Where the query matched is comparable: a title
 * match is a strong signal in any notebook.
 */
function groupStrength(hit: NotebookSearchHit): number {
  if (hit.approximate) return 0;
  let strength = 0;
  if (hit.matchedIn.includes('title')) strength += 3;
  if (hit.matchedIn.includes('path')) strength += 2;
  if (hit.matchedIn.includes('content')) strength += 1;
  return strength;
}

interface RegisteredNotebook {
  id: string;
  rootPath: string;
  name: string;
  status: 'initializing' | 'reconciling' | 'ready';
  progress?: number;
}

@Injectable()
export class OnyvoreMessageHandlerService {
  private notebooks = new Map<string, RegisteredNotebook>();

  constructor(
    @Inject(MESSAGE_BUS) private readonly messageBus: MessageBus,
    private readonly searchIndexService: SearchIndexService,
    private readonly linkGraphService: LinkGraphService,
    private readonly metadataService: MetadataService,
    private readonly persistenceService: PersistenceService,
    private readonly reconciliationService: ReconciliationService,
    private readonly indexingService: IndexingService,
    private readonly ignoreService: IgnoreService,
    private readonly tfidfService: TfidfService,
    private readonly searchService: SearchService,
    private readonly config: AppStdioOnyvoreConfig,
  ) {}

  /**
   * Apply user settings. Changing anything that shapes the similarity graph
   * makes the stored `similar` edges stale, so they are recomputed immediately
   * rather than drifting until the next rebuild.
   */
  @StdioHandler(onyvoreRpcMethods.SERVER_CONFIGURE)
  async configure(
    params: Partial<OnyvoreServerSettings>,
  ): Promise<{ success: boolean }> {
    if (!this.config.update(params)) return { success: true };

    for (const notebookId of this.notebooks.keys()) {
      this.linkGraphService.replaceAllEdgesOfType(
        notebookId,
        'similar',
        this.tfidfService.computeAllEdges(notebookId),
      );
      await this.persistenceService.persistLinks(notebookId);
      this.messageBus.sendNotification(onyvoreRpcMethods.NOTEBOOK_INDEX_UPDATED, {
        notebookId,
      });
    }

    return { success: true };
  }

  @StdioHandler('health')
  async health(): Promise<{ status: string; timestamp: string }> {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @StdioHandler(onyvoreRpcMethods.NOTEBOOK_REGISTER)
  async registerNotebook(params: {
    notebookId: string;
    rootPath: string;
    name: string;
  }): Promise<{ success: boolean }> {
    const { notebookId, rootPath, name } = params;
    this.notebooks.set(notebookId, {
      id: notebookId,
      rootPath,
      name,
      status: 'ready',
    });
    return { success: true };
  }

  @StdioHandler(onyvoreRpcMethods.NOTEBOOK_UNREGISTER)
  async unregisterNotebook(params: {
    notebookId: string;
  }): Promise<{ success: boolean }> {
    const { notebookId } = params;
    this.notebooks.delete(notebookId);
    this.indexingService.clearNotebook(notebookId);
    this.ignoreService.remove(notebookId);
    return { success: true };
  }

  @StdioHandler(onyvoreRpcMethods.NOTEBOOK_INITIALIZE)
  async initializeNotebook(params: {
    notebookId: string;
  }): Promise<{ success: boolean }> {
    const { notebookId } = params;
    const notebook = this.notebooks.get(notebookId);
    if (!notebook) return { success: false };

    notebook.status = 'initializing';
    // Run asynchronously so the response returns immediately.
    this.runBuild(notebook, 'Initialization');

    return { success: true };
  }

  @StdioHandler(onyvoreRpcMethods.NOTEBOOK_RECONCILE)
  async reconcileNotebook(params: {
    notebookId: string;
  }): Promise<{ success: boolean }> {
    const { notebookId } = params;
    const notebook = this.notebooks.get(notebookId);
    if (!notebook) return { success: false };

    notebook.status = 'reconciling';

    // The four artifacts are written independently, so a torn write can leave
    // them disagreeing about what is indexed. If any fails to load, rebuild
    // rather than serving a half-loaded index that metadata.json contradicts.
    const loaded = await this.persistenceService.loadAll(notebookId);

    if (!loaded) {
      this.indexingService.clearNotebook(notebookId);
      notebook.status = 'initializing';
      this.runBuild(notebook, 'Rebuild after incomplete artifacts');
      return { success: true };
    }

    // Register known files so orphan detection sees notes with no edges.
    for (const relPath of Object.keys(this.metadataService.getAllFiles(notebookId))) {
      this.linkGraphService.registerFile(notebookId, relPath);
    }

    this.reconciliationService
      .reconcile(notebookId)
      .then(() => {
        notebook.status = 'ready';
      })
      .catch((err) => {
        console.error(`[Onyvore] Reconciliation failed for ${notebookId}:`, err);
        notebook.status = 'ready';
      });

    return { success: true };
  }

  @StdioHandler(onyvoreRpcMethods.NOTEBOOK_FILE_EVENT)
  async handleFileEvent(params: FileEventBatch): Promise<{ success: boolean }> {
    const { notebookId, events } = params;
    const notebook = this.notebooks.get(notebookId);
    if (!notebook) return { success: false };

    const fs = await import('fs/promises');

    const deletes = events.filter((e) => e.type === 'delete');
    const upserts = events.filter(
      (e) =>
        e.type !== 'delete' && !this.ignoreService.ignores(notebookId, e.relativePath),
    );

    // Read every upsert up front: the contents are needed to derive edges, and
    // their hashes are what identify a rename.
    const contentCache = new Map<string, string>();
    const hashes = new Map<string, string>();
    const stats = new Map<string, number>();

    for (const event of upserts) {
      const fullPath = path.join(notebookId, event.relativePath);
      try {
        const [content, stat] = await Promise.all([
          fs.readFile(fullPath, 'utf-8'),
          fs.stat(fullPath),
        ]);
        contentCache.set(event.relativePath, content);
        hashes.set(event.relativePath, this.indexingService.hash(content));
        stats.set(event.relativePath, stat.mtimeMs);
      } catch {
        // Deleted or replaced between the event firing and this read.
      }
    }

    // A rename arrives as delete + create. Pairing them lets the note move
    // without re-running the NLP pass over content that did not change.
    const renames = detectRenames(
      deletes.map((e) => ({
        relativePath: e.relativePath,
        hash: this.metadataService.getFile(notebookId, e.relativePath)?.hash,
      })),
      upserts
        .filter((e) => !this.metadataService.getFile(notebookId, e.relativePath))
        .map((e) => ({ relativePath: e.relativePath, hash: hashes.get(e.relativePath) })),
    );

    const renamedFrom = new Set(renames.map((r) => r.from));
    const renamedTo = new Map(renames.map((r) => [r.to, r.from]));

    for (const { from, to } of renames) {
      await this.indexingService.renameDocument(
        notebookId,
        from,
        to,
        contentCache.get(to)!,
        stats.get(to) ?? Date.now(),
        hashes.get(to),
      );
    }

    // Remaining deletes, before any edge is derived from the corpus.
    for (const event of deletes) {
      if (renamedFrom.has(event.relativePath)) continue;
      await this.indexingService.removeDocument(notebookId, event.relativePath);
    }

    // Register the rest of the batch, then derive edges once per file.
    // Computing edges inline would run a full corpus pass per file.
    const created = new Set<string>();

    for (const event of upserts) {
      if (renamedTo.has(event.relativePath)) continue;
      const content = contentCache.get(event.relativePath);
      if (content === undefined) continue;

      if (
        event.type === 'create' ||
        !this.metadataService.getFile(notebookId, event.relativePath)
      ) {
        created.add(event.relativePath);
      }

      await this.indexingService.registerDocument(
        notebookId,
        event.relativePath,
        content,
        stats.get(event.relativePath) ?? Date.now(),
        hashes.get(event.relativePath),
      );
    }

    // A renamed note needs its inbound links rebuilt too: its title changed, so
    // mentions of the old name no longer match and wikilinks against the new
    // one now resolve.
    for (const [to] of renamedTo) created.add(to);

    for (const [relativePath, content] of contentCache) {
      if (renamedFrom.has(relativePath)) continue;
      this.indexingService.computeEdges(notebookId, relativePath, content, {
        refreshInbound: created.has(relativePath),
      });
    }

    await this.persistenceService.persistAll(notebookId);

    this.messageBus.sendNotification(onyvoreRpcMethods.NOTEBOOK_INDEX_UPDATED, {
      notebookId,
    });

    return { success: true };
  }

  /**
   * `.onyvoreignore` changed. Reloading the rules and re-running reconciliation
   * produces exactly the right diff: files the new rules exclude are missing
   * from the scan and get removed, files they now admit look newly created.
   */
  @StdioHandler(onyvoreRpcMethods.NOTEBOOK_IGNORE_CHANGED)
  async handleIgnoreChanged(params: {
    notebookId: string;
  }): Promise<{ success: boolean }> {
    const { notebookId } = params;
    const notebook = this.notebooks.get(notebookId);
    if (!notebook) return { success: false };

    notebook.status = 'reconciling';

    this.reconciliationService
      .reconcile(notebookId)
      .then(() => {
        notebook.status = 'ready';
        this.messageBus.sendNotification(
          onyvoreRpcMethods.NOTEBOOK_INDEX_UPDATED,
          { notebookId },
        );
      })
      .catch((err) => {
        console.error(`[Onyvore] Ignore re-evaluation failed for ${notebookId}:`, err);
        notebook.status = 'ready';
      });

    return { success: true };
  }

  @StdioHandler(onyvoreRpcMethods.NOTEBOOK_SEARCH)
  async searchNotebook(params: {
    notebookId: string;
    query: string;
    limit?: number;
  }): Promise<NotebookSearchResults> {
    const { notebookId, query, limit } = params;
    return this.searchService.search(notebookId, query, limit);
  }

  /** Search every registered notebook, grouped so results stay attributable. */
  @StdioHandler(onyvoreRpcMethods.NOTEBOOK_SEARCH_ALL)
  async searchAllNotebooks(params: {
    query: string;
    limit?: number;
  }): Promise<{ groups: NotebookSearchGroup[]; widened: boolean }> {
    const { query, limit } = params;
    const groups: NotebookSearchGroup[] = [];
    let widened = false;

    for (const notebook of this.notebooks.values()) {
      const result = await this.searchService.search(notebook.id, query, limit);
      if (result.hits.length === 0) continue;
      widened = widened || result.widened;

      groups.push({
        notebookId: notebook.id,
        notebookName: notebook.name,
        results: result.hits,
        topScore: groupStrength(result.hits[0]),
      });
    }

    groups.sort(
      (a, b) => b.topScore - a.topScore || b.results.length - a.results.length,
    );
    return { groups, widened };
  }

  @StdioHandler(onyvoreRpcMethods.NOTEBOOK_GET_GRAPH)
  async getGraph(params: {
    notebookId: string;
    maxNodes?: number;
  }): Promise<NotebookGraph> {
    return this.linkGraphService.getGraph(params.notebookId, params.maxNodes);
  }

  @StdioHandler(onyvoreRpcMethods.NOTEBOOK_GET_LINKS)
  async getLinks(params: {
    notebookId: string;
    relativePath: string;
  }): Promise<LinksForNote> {
    const { notebookId, relativePath } = params;
    return this.linkGraphService.getLinksForNote(notebookId, relativePath);
  }

  @StdioHandler(onyvoreRpcMethods.NOTEBOOK_GET_NOTEBOOKS)
  async getNotebooks(): Promise<{
    notebooks: Array<NotebookInfo & { files: Array<{ relativePath: string; basename: string }> }>;
  }> {
    const results = [];
    for (const notebook of this.notebooks.values()) {
      const files = this.metadataService.getAllFiles(notebook.id);
      const fileList = Object.keys(files).map((relPath) => ({
        relativePath: relPath,
        basename: path.basename(relPath, '.md'),
      }));
      fileList.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

      results.push({
        id: notebook.id,
        rootPath: notebook.rootPath,
        name: notebook.name,
        fileCount: fileList.length,
        status: notebook.status,
        progress: notebook.progress,
        files: fileList,
      });
    }
    return { notebooks: results };
  }

  @StdioHandler(onyvoreRpcMethods.NOTEBOOK_GET_ORPHANS)
  async getOrphans(params: {
    notebookId: string;
  }): Promise<{ orphans: string[] }> {
    const { notebookId } = params;
    const orphans = this.linkGraphService.getOrphans(notebookId);
    return { orphans };
  }

  @StdioHandler(onyvoreRpcMethods.NOTEBOOK_REBUILD)
  async rebuildNotebook(params: {
    notebookId: string;
  }): Promise<{ success: boolean }> {
    const { notebookId } = params;
    const notebook = this.notebooks.get(notebookId);
    if (!notebook) return { success: false };

    await this.persistenceService.deleteArtifacts(notebookId);
    this.indexingService.clearNotebook(notebookId);

    notebook.status = 'initializing';
    this.runBuild(notebook, 'Rebuild');

    return { success: true };
  }

  /** Run a full build in the background, always clearing the busy status. */
  private runBuild(notebook: RegisteredNotebook, label: string): void {
    this.reconciliationService
      .initialize(notebook.id)
      .catch((err) => {
        console.error(`[Onyvore] ${label} failed for ${notebook.id}:`, err);
      })
      .finally(() => {
        notebook.status = 'ready';
      });
  }
}
