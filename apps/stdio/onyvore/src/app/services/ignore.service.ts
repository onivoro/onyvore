import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import ignore from 'ignore';

type IgnoreFilter = ReturnType<typeof ignore>;

/**
 * Owns `.onyvoreignore` evaluation for the server.
 *
 * The rules have to apply to filesystem scans (initialization, reconciliation,
 * rebuild) as well as live file events, so the filter lives here rather than in
 * the extension host's watcher — one implementation, every code path.
 */
@Injectable()
export class IgnoreService {
  private filters = new Map<string, IgnoreFilter | null>();

  /** Read `<notebook>/.onyvoreignore`, replacing any previously loaded rules. */
  async load(notebookId: string): Promise<void> {
    try {
      const content = await fs.readFile(
        path.join(notebookId, '.onyvoreignore'),
        'utf-8',
      );
      this.filters.set(notebookId, ignore().add(content));
    } catch {
      this.filters.set(notebookId, null);
    }
  }

  ignores(notebookId: string, relativePath: string): boolean {
    const filter = this.filters.get(notebookId);
    if (!filter || !relativePath) return false;
    // `ignore` rejects absolute paths and paths escaping the root.
    if (path.isAbsolute(relativePath) || relativePath.startsWith('..')) return false;
    return filter.ignores(relativePath);
  }

  remove(notebookId: string): void {
    this.filters.delete(notebookId);
  }
}
