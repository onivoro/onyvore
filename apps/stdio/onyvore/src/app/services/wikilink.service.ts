import { Injectable } from '@nestjs/common';
import type { Edge } from '@onivoro/isomorphic-onyvore';
import { MetadataService } from './metadata.service';
import * as path from 'path';

interface ParsedWikilink {
  target: string;
  displayText: string | null;
}

@Injectable()
export class WikilinkService {
  constructor(private readonly metadataService: MetadataService) {}

  /**
   * Extract wikilinks from content and resolve them to explicit edges.
   * Returns directional edges: source -> resolved target (outbound only).
   */
  extractAndResolve(
    notebookId: string,
    sourceFile: string,
    content: string,
  ): Edge[] {
    const parsed = this.parseWikilinks(content);
    if (parsed.length === 0) return [];

    const allFiles = Object.keys(this.metadataService.getAllFiles(notebookId));
    const edges: Edge[] = [];
    const seen = new Set<string>();

    for (const link of parsed) {
      const resolved = this.resolveTarget(link.target, allFiles);
      if (!resolved) continue;
      if (resolved === sourceFile) continue; // skip self-links
      if (seen.has(resolved)) continue; // deduplicate
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
   * Parse [[wikilink]] and [[wikilink|display text]] syntax from markdown.
   * Skips wikilinks inside fenced code blocks and inline code.
   */
  parseWikilinks(content: string): ParsedWikilink[] {
    // Strip fenced code blocks
    const withoutFenced = content.replace(/```[\s\S]*?```/g, '');
    // Strip inline code
    const withoutCode = withoutFenced.replace(/`[^`]*`/g, '');

    const results: ParsedWikilink[] = [];
    const regex = /\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(withoutCode)) !== null) {
      const inner = match[1].trim();
      if (!inner) continue;

      const pipeIndex = inner.indexOf('|');
      if (pipeIndex === -1) {
        results.push({ target: inner, displayText: null });
      } else {
        const target = inner.substring(0, pipeIndex).trim();
        const displayText = inner.substring(pipeIndex + 1).trim();
        if (target) {
          results.push({ target, displayText: displayText || null });
        }
      }
    }

    return results;
  }

  /**
   * Resolve a wikilink target to a file path.
   *
   * Resolution rules (Obsidian-compatible):
   * 1. Strip .md extension from target if present
   * 2. If target contains '/', try exact relative path match
   * 3. Otherwise, case-insensitive basename match
   * 4. If multiple matches, prefer shortest path
   */
  resolveTarget(target: string, allFiles: string[]): string | null {
    // Normalize: strip .md if present
    const normalized = target.endsWith('.md')
      ? target.slice(0, -3)
      : target;

    if (!normalized) return null;

    // Path-based match (target contains /)
    if (normalized.includes('/')) {
      const withExt = normalized + '.md';
      // Try exact match (case-insensitive)
      const exactMatch = allFiles.find(
        (f) => f.toLowerCase() === withExt.toLowerCase(),
      );
      return exactMatch ?? null;
    }

    // Basename match (case-insensitive)
    const lowerTarget = normalized.toLowerCase();
    const matches = allFiles.filter((f) => {
      const basename = path.basename(f, '.md').toLowerCase();
      return basename === lowerTarget;
    });

    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];

    // Multiple matches: prefer shortest path (most specific / closest to root)
    matches.sort((a, b) => a.length - b.length);
    return matches[0];
  }
}
