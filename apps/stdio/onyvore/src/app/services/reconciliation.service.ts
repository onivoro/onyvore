import { Injectable, Inject } from '@nestjs/common';
import { MESSAGE_BUS, MessageBus } from '@onivoro/isomorphic-jsonrpc';
import * as fs from 'fs/promises';
import * as path from 'path';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';
import { NlpService } from './nlp.service';
import { SearchIndexService } from './search-index.service';
import { LinkGraphService } from './link-graph.service';
import { MetadataService } from './metadata.service';
import { PersistenceService } from './persistence.service';

interface ScannedFile {
  relativePath: string;
  mtimeMs: number;
}

@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(MESSAGE_BUS) private readonly messageBus: MessageBus,
    private readonly nlpService: NlpService,
    private readonly searchIndexService: SearchIndexService,
    private readonly linkGraphService: LinkGraphService,
    private readonly metadataService: MetadataService,
    private readonly persistenceService: PersistenceService,
  ) {}

  async reconcile(notebookId: string): Promise<void> {
    const knownFiles = this.metadataService.getAllFiles(notebookId);
    const currentFiles = await this.scanFilesystem(notebookId);

    const knownPaths = new Set(Object.keys(knownFiles));
    const currentPaths = new Set(currentFiles.map((f) => f.relativePath));

    const created: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    for (const file of currentFiles) {
      if (!knownPaths.has(file.relativePath)) {
        created.push(file.relativePath);
      } else if (file.mtimeMs > knownFiles[file.relativePath].mtimeMs) {
        modified.push(file.relativePath);
      }
    }

    for (const knownPath of knownPaths) {
      if (!currentPaths.has(knownPath)) {
        deleted.push(knownPath);
      }
    }

    const total = created.length + modified.length + deleted.length;
    if (total === 0) {
      this.messageBus.sendNotification(onyvoreRpcMethods.NOTEBOOK_READY, {
        notebookId,
      });
      return;
    }

    let processed = 0;

    // Process deletes first
    for (const relPath of deleted) {
      this.processDelete(notebookId, relPath);
      processed++;
      this.sendProgress(notebookId, processed, total);
    }

    // Then creates and modifications
    for (const relPath of [...created, ...modified]) {
      const content = await this.readFile(notebookId, relPath);
      const stat = await this.statFile(notebookId, relPath);
      const title = this.searchTitleFromPath(relPath);
      const isCreate = created.includes(relPath);

      if (isCreate) {
        await this.searchIndexService.addDocument(notebookId, relPath, title, content);
        this.linkGraphService.processCreate(notebookId, relPath, content);
      } else {
        await this.searchIndexService.updateDocument(notebookId, relPath, title, content);
        this.linkGraphService.processChange(notebookId, relPath, content);
      }

      this.metadataService.setFile(notebookId, relPath, stat.mtimeMs);
      processed++;
      this.sendProgress(notebookId, processed, total);
    }

    await this.persistenceService.persistAll(notebookId);
    this.messageBus.sendNotification(onyvoreRpcMethods.NOTEBOOK_READY, {
      notebookId,
    });
  }

  async initialize(notebookId: string): Promise<void> {
    const files = await this.scanFilesystem(notebookId);
    const total = files.length;
    let processed = 0;

    for (const file of files) {
      const content = await this.readFile(notebookId, file.relativePath);
      const title = this.searchTitleFromPath(file.relativePath);

      await this.searchIndexService.addDocument(
        notebookId,
        file.relativePath,
        title,
        content,
      );
      this.linkGraphService.processCreate(notebookId, file.relativePath, content);
      this.metadataService.setFile(notebookId, file.relativePath, file.mtimeMs);

      processed++;
      if (processed % 10 === 0 || processed === total) {
        this.sendInitProgress(notebookId, processed, total);
      }

      // Checkpoint every 100 files
      if (processed % 100 === 0) {
        await this.persistenceService.persistAll(notebookId);
      }
    }

    await this.persistenceService.persistAll(notebookId);
    this.messageBus.sendNotification(onyvoreRpcMethods.NOTEBOOK_READY, {
      notebookId,
    });
  }

  private processDelete(notebookId: string, relativePath: string): void {
    this.linkGraphService.processDelete(notebookId, relativePath);
    this.metadataService.removeFile(notebookId, relativePath);
    // Search index removeDocument is async but we fire-and-forget for deletes during reconciliation
    this.searchIndexService.removeDocument(notebookId, relativePath).catch(() => {});
  }

  private async scanFilesystem(notebookId: string): Promise<ScannedFile[]> {
    const results: ScannedFile[] = [];
    await this.walkDirectory(notebookId, notebookId, results);
    return results;
  }

  private async walkDirectory(
    notebookId: string,
    dirPath: string,
    results: ScannedFile[],
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Skip .onyvore directory
        if (entry.name === '.onyvore') continue;

        // Skip nested notebooks (directories containing their own .onyvore/)
        try {
          await fs.access(path.join(fullPath, '.onyvore'));
          continue; // Nested notebook boundary
        } catch {
          // Not a nested notebook, recurse
        }

        await this.walkDirectory(notebookId, fullPath, results);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const stat = await fs.stat(fullPath);
        const relativePath = path.relative(notebookId, fullPath);
        results.push({ relativePath, mtimeMs: stat.mtimeMs });
      }
    }
  }

  private async readFile(notebookId: string, relativePath: string): Promise<string> {
    const fullPath = path.join(notebookId, relativePath);
    return fs.readFile(fullPath, 'utf-8');
  }

  private async statFile(
    notebookId: string,
    relativePath: string,
  ): Promise<{ mtimeMs: number }> {
    const fullPath = path.join(notebookId, relativePath);
    const stat = await fs.stat(fullPath);
    return { mtimeMs: stat.mtimeMs };
  }

  private sendProgress(
    notebookId: string,
    processed: number,
    total: number,
  ): void {
    const progress = total > 0 ? Math.round((processed / total) * 100) : 100;
    this.messageBus.sendNotification(
      onyvoreRpcMethods.NOTEBOOK_RECONCILE_PROGRESS,
      { notebookId, processed, total, progress },
    );
  }

  private searchTitleFromPath(relativePath: string): string {
    const basename = path.basename(relativePath, '.md');
    const dir = path.dirname(relativePath);
    if (dir && dir !== '.') {
      return `${path.basename(dir)} ${basename}`;
    }
    return basename;
  }

  private sendInitProgress(
    notebookId: string,
    processed: number,
    total: number,
  ): void {
    const progress = total > 0 ? Math.round((processed / total) * 100) : 100;
    this.messageBus.sendNotification(
      onyvoreRpcMethods.NOTEBOOK_INIT_PROGRESS,
      { notebookId, processed, total, progress },
    );
  }
}
