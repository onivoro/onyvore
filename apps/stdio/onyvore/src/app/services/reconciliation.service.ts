import { Injectable, Inject } from '@nestjs/common';
import { MESSAGE_BUS, MessageBus } from '@onivoro/isomorphic-jsonrpc';
import * as fs from 'fs/promises';
import * as path from 'path';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';
import { LinkGraphService } from './link-graph.service';
import { MetadataService } from './metadata.service';
import { PersistenceService } from './persistence.service';
import { TfidfService } from './tfidf.service';
import { MentionService } from './mention.service';
import { IndexingService } from './indexing.service';
import { IgnoreService } from './ignore.service';
import { AppStdioOnyvoreConfig } from '../app-stdio-onyvore-config.class';

interface ScannedFile {
  relativePath: string;
  mtimeMs: number;
}

@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(MESSAGE_BUS) private readonly messageBus: MessageBus,
    private readonly linkGraphService: LinkGraphService,
    private readonly metadataService: MetadataService,
    private readonly persistenceService: PersistenceService,
    private readonly tfidfService: TfidfService,
    private readonly mentionService: MentionService,
    private readonly indexingService: IndexingService,
    private readonly ignoreService: IgnoreService,
    private readonly config: AppStdioOnyvoreConfig,
  ) {}

  /**
   * Diff persisted state against the filesystem and apply only what changed.
   *
   * Also the path used when `.onyvoreignore` changes: reloading the filter
   * turns newly-ignored files into deletions and newly-included files into
   * creations, which is exactly the diff this already computes.
   */
  async reconcile(notebookId: string): Promise<void> {
    await this.ignoreService.load(notebookId);

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
      this.sendReady(notebookId);
      return;
    }

    let processed = 0;

    // Deletes first, so the corpus is correct before any edge is computed.
    for (const relPath of deleted) {
      await this.indexingService.removeDocument(notebookId, relPath);
      processed++;
      this.sendProgress(notebookId, processed, total);
    }

    // Register every changed document before deriving links from any of them.
    const changedPaths = [...created, ...modified];
    const contentCache = new Map<string, string>();
    const createdSet = new Set(created);

    for (const relPath of changedPaths) {
      const content = await this.readFile(notebookId, relPath);
      const stat = await this.statFile(notebookId, relPath);
      contentCache.set(relPath, content);
      await this.indexingService.registerDocument(
        notebookId,
        relPath,
        content,
        stat.mtimeMs,
      );
    }

    for (const relPath of changedPaths) {
      this.indexingService.computeEdges(
        notebookId,
        relPath,
        contentCache.get(relPath)!,
        { refreshInbound: createdSet.has(relPath) },
      );
      processed++;
      this.sendProgress(notebookId, processed, total);
    }

    await this.persistenceService.persistAll(notebookId);
    this.sendReady(notebookId);
  }

  /** Build a notebook from scratch. */
  async initialize(notebookId: string): Promise<void> {
    await this.ignoreService.load(notebookId);

    const files = await this.scanFilesystem(notebookId);
    const total = files.length;
    let processed = 0;

    const contentCache = new Map<string, string>();

    for (const file of files) {
      const content = await this.readFile(notebookId, file.relativePath);
      contentCache.set(file.relativePath, content);
      await this.indexingService.registerDocument(
        notebookId,
        file.relativePath,
        content,
        file.mtimeMs,
      );

      processed++;
      if (processed % 10 === 0 || processed === total) {
        this.sendInitProgress(notebookId, processed, total);
      }

      if (processed % this.config.checkpointInterval === 0) {
        await this.persistenceService.persistIndex(notebookId);
        await this.persistenceService.persistMetadata(notebookId);
        await this.persistenceService.persistTfidf(notebookId);
      }
    }

    // Whole-corpus passes: IDF needs every document, mention matching needs
    // every title. Both are cheaper in one sweep than file by file.
    this.linkGraphService.replaceAllEdgesOfType(
      notebookId,
      'similar',
      this.tfidfService.computeAllEdges(notebookId),
    );
    this.linkGraphService.replaceAllEdgesOfType(
      notebookId,
      'mention',
      this.mentionService.computeAllEdges(notebookId),
    );

    // Wikilinks resolve per file, against the now-complete file list.
    for (const file of files) {
      this.indexingService.computeEdges(
        notebookId,
        file.relativePath,
        contentCache.get(file.relativePath)!,
        { refreshInbound: false },
      );
    }

    await this.persistenceService.persistAll(notebookId);
    this.sendReady(notebookId);
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
      const relativePath = path.relative(notebookId, fullPath);

      if (entry.isDirectory()) {
        if (entry.name === '.onyvore') continue;

        // A subdirectory with its own .onyvore/ is a separate notebook and
        // manages its own index — same boundary rule as nested .git/.
        try {
          await fs.access(path.join(fullPath, '.onyvore'));
          continue;
        } catch {
          // Not a nested notebook, recurse.
        }

        if (this.ignoreService.ignores(notebookId, `${relativePath}/`)) continue;

        await this.walkDirectory(notebookId, fullPath, results);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        if (this.ignoreService.ignores(notebookId, relativePath)) continue;
        const stat = await fs.stat(fullPath);
        results.push({ relativePath, mtimeMs: stat.mtimeMs });
      }
    }
  }

  private async readFile(notebookId: string, relativePath: string): Promise<string> {
    return fs.readFile(path.join(notebookId, relativePath), 'utf-8');
  }

  private async statFile(
    notebookId: string,
    relativePath: string,
  ): Promise<{ mtimeMs: number }> {
    const stat = await fs.stat(path.join(notebookId, relativePath));
    return { mtimeMs: stat.mtimeMs };
  }

  private sendReady(notebookId: string): void {
    this.messageBus.sendNotification(onyvoreRpcMethods.NOTEBOOK_READY, {
      notebookId,
    });
  }

  private sendProgress(notebookId: string, processed: number, total: number): void {
    this.messageBus.sendNotification(
      onyvoreRpcMethods.NOTEBOOK_RECONCILE_PROGRESS,
      { notebookId, processed, total, progress: this.percent(processed, total) },
    );
  }

  private sendInitProgress(notebookId: string, processed: number, total: number): void {
    this.messageBus.sendNotification(onyvoreRpcMethods.NOTEBOOK_INIT_PROGRESS, {
      notebookId,
      processed,
      total,
      progress: this.percent(processed, total),
    });
  }

  private percent(processed: number, total: number): number {
    return total > 0 ? Math.round((processed / total) * 100) : 100;
  }
}
