import { Injectable } from '@nestjs/common';
import type { NotebookMetadata, NoteMetadata } from '@onivoro/isomorphic-onyvore';

@Injectable()
export class MetadataService {
  private metadata = new Map<string, NotebookMetadata>();

  getOrCreate(notebookId: string): NotebookMetadata {
    let meta = this.metadata.get(notebookId);
    if (!meta) {
      meta = { files: {} };
      this.metadata.set(notebookId, meta);
    }
    return meta;
  }

  remove(notebookId: string): void {
    this.metadata.delete(notebookId);
  }

  setFile(notebookId: string, relativePath: string, mtimeMs: number): void {
    const meta = this.getOrCreate(notebookId);
    meta.files[relativePath] = { relativePath, mtimeMs };
  }

  removeFile(notebookId: string, relativePath: string): void {
    const meta = this.metadata.get(notebookId);
    if (meta) {
      delete meta.files[relativePath];
    }
  }

  getFile(notebookId: string, relativePath: string): NoteMetadata | undefined {
    const meta = this.metadata.get(notebookId);
    return meta?.files[relativePath];
  }

  getAllFiles(notebookId: string): Record<string, NoteMetadata> {
    const meta = this.metadata.get(notebookId);
    return meta?.files ?? {};
  }

  getFileCount(notebookId: string): number {
    const meta = this.metadata.get(notebookId);
    return meta ? Object.keys(meta.files).length : 0;
  }

  load(notebookId: string, data: NotebookMetadata): void {
    this.metadata.set(notebookId, data);
  }

  serialize(notebookId: string): NotebookMetadata | null {
    return this.metadata.get(notebookId) ?? null;
  }
}
