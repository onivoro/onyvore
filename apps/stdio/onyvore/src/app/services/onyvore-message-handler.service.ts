import { Injectable, Inject } from '@nestjs/common';
import { StdioHandler } from '@onivoro/server-stdio';
import { MESSAGE_BUS, MessageBus } from '@onivoro/isomorphic-jsonrpc';
import * as path from 'path';
import {
  onyvoreRpcMethods,
  type FileEventBatch,
  type NotebookInfo,
  type NotebookFileTree,
  type LinksForNote,
} from '@onivoro/isomorphic-onyvore';
import { NlpService } from './nlp.service';
import { SearchIndexService } from './search-index.service';
import { LinkGraphService } from './link-graph.service';
import { MetadataService } from './metadata.service';
import { PersistenceService } from './persistence.service';
import { ReconciliationService } from './reconciliation.service';

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
    private readonly nlpService: NlpService,
    private readonly searchIndexService: SearchIndexService,
    private readonly linkGraphService: LinkGraphService,
    private readonly metadataService: MetadataService,
    private readonly persistenceService: PersistenceService,
    private readonly reconciliationService: ReconciliationService,
  ) {}

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
    this.searchIndexService.removeIndex(notebookId);
    this.linkGraphService.removeGraph(notebookId);
    this.metadataService.remove(notebookId);
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
    // Run initialization asynchronously so the response returns immediately
    this.reconciliationService
      .initialize(notebookId)
      .then(() => {
        notebook.status = 'ready';
      })
      .catch((err) => {
        console.error(`[Onyvore] Initialization failed for ${notebookId}:`, err);
        notebook.status = 'ready';
      });

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

    // Load persisted state first
    await this.persistenceService.loadAll(notebookId);

    // Re-register titles from metadata for link graph
    const files = this.metadataService.getAllFiles(notebookId);
    for (const relPath of Object.keys(files)) {
      this.linkGraphService.registerTitle(notebookId, relPath);
    }

    // Run reconciliation asynchronously
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

    for (const event of events) {
      const { type, relativePath } = event;
      const title = this.searchTitleFromPath(relativePath);

      switch (type) {
        case 'create': {
          const fullPath = path.join(notebookId, relativePath);
          const content = await fs.readFile(fullPath, 'utf-8');
          const stat = await fs.stat(fullPath);

          await this.searchIndexService.addDocument(
            notebookId,
            relativePath,
            title,
            content,
          );
          this.linkGraphService.processCreate(notebookId, relativePath, content);
          this.metadataService.setFile(notebookId, relativePath, stat.mtimeMs);
          break;
        }
        case 'change': {
          const fullPath = path.join(notebookId, relativePath);
          const content = await fs.readFile(fullPath, 'utf-8');
          const stat = await fs.stat(fullPath);

          await this.searchIndexService.updateDocument(
            notebookId,
            relativePath,
            title,
            content,
          );
          this.linkGraphService.processChange(notebookId, relativePath, content);
          this.metadataService.setFile(notebookId, relativePath, stat.mtimeMs);
          break;
        }
        case 'delete': {
          await this.searchIndexService.removeDocument(notebookId, relativePath);
          this.linkGraphService.processDelete(notebookId, relativePath);
          this.metadataService.removeFile(notebookId, relativePath);
          break;
        }
      }
    }

    // Persist after processing the batch
    await this.persistenceService.persistAll(notebookId);

    // Notify extension that the index has been updated
    this.messageBus.sendNotification(onyvoreRpcMethods.NOTEBOOK_INDEX_UPDATED, {
      notebookId,
    });

    return { success: true };
  }

  @StdioHandler(onyvoreRpcMethods.NOTEBOOK_IGNORE_CHANGED)
  async handleIgnoreChanged(params: {
    notebookId: string;
    ignoredPaths: string[];
    includedPaths: string[];
  }): Promise<{ success: boolean }> {
    const { notebookId, ignoredPaths, includedPaths } = params;
    const fs = await import('fs/promises');

    // Remove newly-ignored files
    for (const relPath of ignoredPaths) {
      await this.searchIndexService.removeDocument(notebookId, relPath);
      this.linkGraphService.processDelete(notebookId, relPath);
      this.metadataService.removeFile(notebookId, relPath);
    }

    // Process newly-included files
    for (const relPath of includedPaths) {
      const fullPath = path.join(notebookId, relPath);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const stat = await fs.stat(fullPath);
        const title = this.searchTitleFromPath(relPath);

        await this.searchIndexService.addDocument(notebookId, relPath, title, content);
        this.linkGraphService.processCreate(notebookId, relPath, content);
        this.metadataService.setFile(notebookId, relPath, stat.mtimeMs);
      } catch {
        // File may have been deleted between detection and processing
      }
    }

    await this.persistenceService.persistAll(notebookId);
    this.messageBus.sendNotification(onyvoreRpcMethods.NOTEBOOK_INDEX_UPDATED, {
      notebookId,
    });

    return { success: true };
  }

  @StdioHandler(onyvoreRpcMethods.NOTEBOOK_SEARCH)
  async searchNotebook(params: {
    notebookId: string;
    query: string;
    limit?: number;
  }): Promise<{ results: Array<{ relativePath: string; title: string; score: number; snippets: string[] }> }> {
    const { notebookId, query, limit } = params;
    const results = await this.searchIndexService.searchNotebook(
      notebookId,
      query,
      limit,
    );
    return { results };
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

    // Delete all derived artifacts
    await this.persistenceService.deleteArtifacts(notebookId);

    // Clear in-memory state
    this.searchIndexService.removeIndex(notebookId);
    this.linkGraphService.removeGraph(notebookId);
    this.metadataService.remove(notebookId);

    // Re-initialize from scratch
    notebook.status = 'initializing';
    this.reconciliationService
      .initialize(notebookId)
      .then(() => {
        notebook.status = 'ready';
      })
      .catch((err) => {
        console.error(`[Onyvore] Rebuild failed for ${notebookId}:`, err);
        notebook.status = 'ready';
      });

    return { success: true };
  }

  private searchTitleFromPath(relativePath: string): string {
    const basename = path.basename(relativePath, '.md');
    const dir = path.dirname(relativePath);
    if (dir && dir !== '.') {
      return `${path.basename(dir)} ${basename}`;
    }
    return basename;
  }
}
