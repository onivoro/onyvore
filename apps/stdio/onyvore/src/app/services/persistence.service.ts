import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SearchIndexService } from './search-index.service';
import { LinkGraphService } from './link-graph.service';
import { MetadataService } from './metadata.service';
import { TfidfService } from './tfidf.service';

/**
 * Artifact format version. Every derived file carries it, and a mismatch is
 * treated as unreadable so the notebook rebuilds instead of accumulating
 * compatibility shims for formats that were never released.
 */
const ARTIFACT_VERSION = 2;

@Injectable()
export class PersistenceService {
  constructor(
    private readonly searchIndexService: SearchIndexService,
    private readonly linkGraphService: LinkGraphService,
    private readonly metadataService: MetadataService,
    private readonly tfidfService: TfidfService,
  ) {}

  private onyvoreDir(rootPath: string): string {
    return path.join(rootPath, '.onyvore');
  }

  async persistAll(notebookId: string): Promise<void> {
    await fs.mkdir(this.onyvoreDir(notebookId), { recursive: true });

    await Promise.all([
      this.persistIndex(notebookId),
      this.persistLinks(notebookId),
      this.persistMetadata(notebookId),
      this.persistTfidf(notebookId),
    ]);
  }

  async persistIndex(notebookId: string): Promise<void> {
    const data = await this.searchIndexService.serialize(notebookId);
    await this.write(notebookId, 'index.bin', data ?? Buffer.from(''));
  }

  async persistLinks(notebookId: string): Promise<void> {
    const edges = this.linkGraphService.getEdgesForPersistence(notebookId);
    await this.writeJson(notebookId, 'links.json', { edges });
  }

  async persistMetadata(notebookId: string): Promise<void> {
    const data = this.metadataService.serialize(notebookId);
    await this.writeJson(notebookId, 'metadata.json', data ?? { files: {} });
  }

  async persistTfidf(notebookId: string): Promise<void> {
    const data = this.tfidfService.serialize(notebookId);
    await this.writeJson(notebookId, 'tfidf.json', data ?? { tf: {}, df: {} });
  }

  /**
   * Load every artifact. Returns false if any is missing, unreadable, or from
   * a different format version — the caller rebuilds rather than trusting a
   * partially restored state.
   */
  async loadAll(notebookId: string): Promise<boolean> {
    try {
      await fs.access(this.onyvoreDir(notebookId));
    } catch {
      return false;
    }

    const results = await Promise.all([
      this.loadIndex(notebookId),
      this.loadLinks(notebookId),
      this.loadMetadata(notebookId),
      this.loadTfidf(notebookId),
    ]);

    return results.every(Boolean);
  }

  async loadIndex(notebookId: string): Promise<boolean> {
    try {
      const data = await fs.readFile(
        path.join(this.onyvoreDir(notebookId), 'index.bin'),
      );
      if (data.length === 0) return false;
      await this.searchIndexService.deserialize(notebookId, data);
      return true;
    } catch {
      return false;
    }
  }

  async loadLinks(notebookId: string): Promise<boolean> {
    const data = await this.readJson<{ edges: unknown }>(notebookId, 'links.json');
    if (!data || !Array.isArray(data.edges)) return false;
    this.linkGraphService.loadEdges(notebookId, data.edges);
    return true;
  }

  async loadMetadata(notebookId: string): Promise<boolean> {
    const data = await this.readJson<{ files: unknown }>(notebookId, 'metadata.json');
    if (!data || typeof data.files !== 'object' || data.files === null) return false;
    this.metadataService.load(notebookId, data as any);
    return true;
  }

  async loadTfidf(notebookId: string): Promise<boolean> {
    const data = await this.readJson<{ tf: unknown; df: unknown }>(
      notebookId,
      'tfidf.json',
    );
    if (!data || !data.tf || !data.df) return false;
    this.tfidfService.deserialize(notebookId, data as any);
    return true;
  }

  async deleteArtifacts(notebookId: string): Promise<void> {
    const dir = this.onyvoreDir(notebookId);
    for (const file of ['index.bin', 'links.json', 'metadata.json', 'tfidf.json']) {
      try {
        await fs.unlink(path.join(dir, file));
      } catch {
        // Already absent.
      }
    }
  }

  private async writeJson(
    notebookId: string,
    fileName: string,
    payload: object,
  ): Promise<void> {
    // Compact, not pretty-printed: these are machine-written artifacts and
    // links.json in particular grows with the square of the notebook size.
    await this.write(
      notebookId,
      fileName,
      JSON.stringify({ version: ARTIFACT_VERSION, ...payload }),
    );
  }

  private async readJson<T>(
    notebookId: string,
    fileName: string,
  ): Promise<T | null> {
    try {
      const raw = await fs.readFile(
        path.join(this.onyvoreDir(notebookId), fileName),
        'utf-8',
      );
      const parsed = JSON.parse(raw);
      if (parsed?.version !== ARTIFACT_VERSION) return null;
      return parsed as T;
    } catch {
      return null;
    }
  }

  private async write(
    notebookId: string,
    fileName: string,
    data: Buffer | string,
  ): Promise<void> {
    const dir = this.onyvoreDir(notebookId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, fileName);
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, data);
    await fs.rename(tmpPath, filePath);
  }
}
