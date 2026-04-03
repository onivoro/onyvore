import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SearchIndexService } from './search-index.service';
import { LinkGraphService } from './link-graph.service';
import { MetadataService } from './metadata.service';

@Injectable()
export class PersistenceService {
  constructor(
    private readonly searchIndexService: SearchIndexService,
    private readonly linkGraphService: LinkGraphService,
    private readonly metadataService: MetadataService,
  ) {}

  private onyvoreDir(rootPath: string): string {
    return path.join(rootPath, '.onyvore');
  }

  async persistAll(notebookId: string): Promise<void> {
    const dir = this.onyvoreDir(notebookId);
    await fs.mkdir(dir, { recursive: true });

    await Promise.all([
      this.persistIndex(notebookId),
      this.persistLinks(notebookId),
      this.persistMetadata(notebookId),
    ]);
  }

  async persistIndex(notebookId: string): Promise<void> {
    const data = await this.searchIndexService.serialize(notebookId);
    if (!data) return;
    await this.atomicWrite(
      path.join(this.onyvoreDir(notebookId), 'index.bin'),
      data,
    );
  }

  async persistLinks(notebookId: string): Promise<void> {
    const edges = this.linkGraphService.getEdgesForPersistence(notebookId);
    const json = JSON.stringify({ edges }, null, 2);
    await this.atomicWrite(
      path.join(this.onyvoreDir(notebookId), 'links.json'),
      json,
    );
  }

  async persistMetadata(notebookId: string): Promise<void> {
    const data = this.metadataService.serialize(notebookId);
    if (!data) return;
    const json = JSON.stringify(data, null, 2);
    await this.atomicWrite(
      path.join(this.onyvoreDir(notebookId), 'metadata.json'),
      json,
    );
  }

  async loadAll(notebookId: string): Promise<boolean> {
    const dir = this.onyvoreDir(notebookId);

    try {
      await fs.access(dir);
    } catch {
      return false;
    }

    const [indexLoaded, linksLoaded, metadataLoaded] = await Promise.all([
      this.loadIndex(notebookId),
      this.loadLinks(notebookId),
      this.loadMetadata(notebookId),
    ]);

    return indexLoaded && linksLoaded && metadataLoaded;
  }

  async loadIndex(notebookId: string): Promise<boolean> {
    try {
      const filePath = path.join(this.onyvoreDir(notebookId), 'index.bin');
      const data = await fs.readFile(filePath);
      await this.searchIndexService.deserialize(notebookId, data);
      return true;
    } catch {
      return false;
    }
  }

  async loadLinks(notebookId: string): Promise<boolean> {
    try {
      const filePath = path.join(this.onyvoreDir(notebookId), 'links.json');
      const raw = await fs.readFile(filePath, 'utf-8');
      const { edges } = JSON.parse(raw);
      this.linkGraphService.loadEdges(notebookId, edges);
      return true;
    } catch {
      return false;
    }
  }

  async loadMetadata(notebookId: string): Promise<boolean> {
    try {
      const filePath = path.join(this.onyvoreDir(notebookId), 'metadata.json');
      const raw = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(raw);
      this.metadataService.load(notebookId, data);
      return true;
    } catch {
      return false;
    }
  }

  async deleteArtifacts(notebookId: string): Promise<void> {
    const dir = this.onyvoreDir(notebookId);
    const files = ['index.bin', 'links.json', 'metadata.json'];
    for (const file of files) {
      try {
        await fs.unlink(path.join(dir, file));
      } catch {
        // File may not exist
      }
    }
  }

  private async atomicWrite(filePath: string, data: Buffer | string): Promise<void> {
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, data);
    await fs.rename(tmpPath, filePath);
  }
}
