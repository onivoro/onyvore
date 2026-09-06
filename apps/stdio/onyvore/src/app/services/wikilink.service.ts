import { Injectable } from '@nestjs/common';
import {
  parseWikilinks,
  resolveWikilinkTarget,
  type Edge,
  type ParsedWikilink,
} from '@onivoro/isomorphic-onyvore';
import { MetadataService } from './metadata.service';

@Injectable()
export class WikilinkService {
  /** notebookId -> (source file -> the wikilinks it contains) */
  private parsedCache = new Map<string, Map<string, ParsedWikilink[]>>();

  constructor(private readonly metadataService: MetadataService) {}

  removeNotebook(notebookId: string): void {
    this.parsedCache.delete(notebookId);
  }

  unregisterFile(notebookId: string, sourceFile: string): void {
    this.parsedCache.get(notebookId)?.delete(sourceFile);
  }

  /**
   * Extract wikilinks from content and resolve them to explicit edges.
   * Directional: the source note owns the links it wrote.
   */
  extractAndResolve(
    notebookId: string,
    sourceFile: string,
    content: string,
  ): Edge[] {
    const parsed = parseWikilinks(content);
    this.getOrCreateCache(notebookId).set(sourceFile, parsed);
    if (parsed.length === 0) return [];

    const allFiles = Object.keys(this.metadataService.getAllFiles(notebookId));
    const edges: Edge[] = [];
    const seen = new Set<string>();

    for (const link of parsed) {
      const resolved = resolveWikilinkTarget(link.target, allFiles);
      if (!resolved) continue;
      if (resolved === sourceFile) continue; // skip self-links
      if (seen.has(resolved)) continue; // one edge per (source, target)
      seen.add(resolved);

      edges.push({
        source: sourceFile,
        target: resolved,
        type: 'explicit',
        noun: link.target,
        displayText: link.displayText ?? undefined,
        count: 100,
      });
    }

    return edges;
  }

  /**
   * Edges from every note whose wikilinks now resolve to `targetFile`.
   *
   * A wikilink written before its target existed resolves to nothing and is
   * dropped. When the target is later created, this re-resolves the cached
   * link text so the edge appears without waiting for the source to change.
   */
  computeInboundEdges(notebookId: string, targetFile: string): Edge[] {
    const cache = this.parsedCache.get(notebookId);
    if (!cache) return [];

    const allFiles = Object.keys(this.metadataService.getAllFiles(notebookId));
    const edges: Edge[] = [];

    for (const [sourceFile, parsed] of cache) {
      if (sourceFile === targetFile) continue;

      for (const link of parsed) {
        if (resolveWikilinkTarget(link.target, allFiles) !== targetFile) continue;
        edges.push({
          source: sourceFile,
          target: targetFile,
          type: 'explicit',
          noun: link.target,
          displayText: link.displayText ?? undefined,
          count: 100,
        });
        break; // one edge per (source, target)
      }
    }

    return edges;
  }

  private getOrCreateCache(notebookId: string): Map<string, ParsedWikilink[]> {
    let cache = this.parsedCache.get(notebookId);
    if (!cache) {
      cache = new Map();
      this.parsedCache.set(notebookId, cache);
    }
    return cache;
  }
}
