import { Injectable } from '@nestjs/common';
import { NlpService, ExtractionResult } from './nlp.service';
import type { Edge, LinksForNote, LinkEntry } from '@onivoro/isomorphic-onyvore';
import * as path from 'path';

interface LinkGraph {
  edges: Map<string, Edge>;
  outboundIndex: Map<string, Set<string>>;
  inboundIndex: Map<string, Set<string>>;
  phraseCache: Map<string, Map<string, number>>;
  titleIndex: Map<string, Set<string>>;
}

@Injectable()
export class LinkGraphService {
  private graphs = new Map<string, LinkGraph>();

  constructor(private readonly nlpService: NlpService) {}

  getOrCreateGraph(notebookId: string): LinkGraph {
    let graph = this.graphs.get(notebookId);
    if (!graph) {
      graph = {
        edges: new Map(),
        outboundIndex: new Map(),
        inboundIndex: new Map(),
        phraseCache: new Map(),
        titleIndex: new Map(),
      };
      this.graphs.set(notebookId, graph);
    }
    return graph;
  }

  removeGraph(notebookId: string): void {
    this.graphs.delete(notebookId);
  }

  processCreate(notebookId: string, relativePath: string, content: string): void {
    const graph = this.getOrCreateGraph(notebookId);

    // Register all title variants (basename + path-qualified)
    for (const title of this.titlesFromPath(relativePath)) {
      if (!graph.titleIndex.has(title)) {
        graph.titleIndex.set(title, new Set());
      }
      graph.titleIndex.get(title)!.add(relativePath);
    }

    // Extract noun phrases and cache them
    const extraction = this.nlpService.extractNounPhrases(content);
    graph.phraseCache.set(relativePath, extraction.phrases);

    // Build outbound edges: this file's phrases matched against all titles
    const outboundEdges = this.matchPhrasesAgainstTitles(
      relativePath,
      extraction.phrases,
      graph.titleIndex,
    );
    for (const edge of outboundEdges) {
      this.addEdge(graph, edge);
    }

    // Reverse match: scan all other files' cached phrases for matches against this file's titles
    const titles = this.titlesFromPath(relativePath);
    for (const [otherPath, otherPhrases] of graph.phraseCache) {
      if (otherPath === relativePath) continue;

      // Check all title variants (basename, parent/basename)
      let bestNoun: string | null = null;
      let totalCount = 0;
      let bestCount = 0;
      for (const t of titles) {
        const count = otherPhrases.get(t);
        if (count !== undefined) {
          totalCount += count;
          if (count > bestCount) {
            bestCount = count;
            bestNoun = t;
          }
        }
      }
      if (!bestNoun) continue;

      const key = `${otherPath}::${relativePath}`;
      const existing = graph.edges.get(key);
      if (existing) {
        existing.count += totalCount;
        if (bestCount > (otherPhrases.get(existing.noun) ?? 0)) {
          existing.noun = bestNoun;
        }
      } else {
        this.addEdge(graph, {
          source: otherPath,
          target: relativePath,
          noun: bestNoun,
          count: totalCount,
        });
      }
    }
  }

  processChange(notebookId: string, relativePath: string, content: string): void {
    const graph = this.getOrCreateGraph(notebookId);

    // Remove all outbound edges from this file
    this.removeOutboundEdges(graph, relativePath);

    // Re-extract noun phrases and update cache
    const extraction = this.nlpService.extractNounPhrases(content);
    graph.phraseCache.set(relativePath, extraction.phrases);

    // Rebuild outbound edges
    const outboundEdges = this.matchPhrasesAgainstTitles(
      relativePath,
      extraction.phrases,
      graph.titleIndex,
    );
    for (const edge of outboundEdges) {
      this.addEdge(graph, edge);
    }
  }

  processDelete(notebookId: string, relativePath: string): void {
    const graph = this.getOrCreateGraph(notebookId);

    // Remove all outbound edges from this file
    this.removeOutboundEdges(graph, relativePath);

    // Remove all inbound edges pointing to this file
    this.removeInboundEdges(graph, relativePath);

    // Remove from phrase cache and title index (all title variants)
    graph.phraseCache.delete(relativePath);
    for (const title of this.titlesFromPath(relativePath)) {
      const pathsForTitle = graph.titleIndex.get(title);
      if (pathsForTitle) {
        pathsForTitle.delete(relativePath);
        if (pathsForTitle.size === 0) {
          graph.titleIndex.delete(title);
        }
      }
    }
  }

  getLinksForNote(notebookId: string, relativePath: string): LinksForNote {
    const graph = this.graphs.get(notebookId);
    if (!graph) {
      return { notePath: relativePath, outbound: [], inbound: [] };
    }

    const outbound: LinkEntry[] = [];
    const outKeys = graph.outboundIndex.get(relativePath);
    if (outKeys) {
      for (const key of outKeys) {
        const edge = graph.edges.get(key);
        if (edge) {
          outbound.push({
            notePath: edge.target,
            noteTitle: this.titleFromPath(edge.target),
            noun: edge.noun,
            count: edge.count,
          });
        }
      }
    }
    outbound.sort((a, b) => b.count - a.count);

    const inbound: LinkEntry[] = [];
    const inKeys = graph.inboundIndex.get(relativePath);
    if (inKeys) {
      for (const key of inKeys) {
        const edge = graph.edges.get(key);
        if (edge) {
          inbound.push({
            notePath: edge.source,
            noteTitle: this.titleFromPath(edge.source),
            noun: edge.noun,
            count: edge.count,
          });
        }
      }
    }
    inbound.sort((a, b) => b.count - a.count);

    return { notePath: relativePath, outbound, inbound };
  }

  getOrphans(notebookId: string): string[] {
    const graph = this.graphs.get(notebookId);
    if (!graph) return [];

    const orphans: string[] = [];
    for (const [filePath] of graph.phraseCache) {
      const outKeys = graph.outboundIndex.get(filePath);
      const inKeys = graph.inboundIndex.get(filePath);
      const hasOutbound = outKeys && outKeys.size > 0;
      const hasInbound = inKeys && inKeys.size > 0;
      if (!hasOutbound && !hasInbound) {
        orphans.push(filePath);
      }
    }
    return orphans;
  }

  getEdgesForPersistence(notebookId: string): Edge[] {
    const graph = this.graphs.get(notebookId);
    if (!graph) return [];
    return Array.from(graph.edges.values());
  }

  loadEdges(notebookId: string, edges: Edge[]): void {
    const graph = this.getOrCreateGraph(notebookId);
    for (const edge of edges) {
      this.addEdge(graph, edge);
    }
  }

  loadPhraseCache(notebookId: string, filePath: string, phrases: Map<string, number>): void {
    const graph = this.getOrCreateGraph(notebookId);
    graph.phraseCache.set(filePath, phrases);
  }

  registerTitle(notebookId: string, relativePath: string): void {
    const graph = this.getOrCreateGraph(notebookId);
    for (const title of this.titlesFromPath(relativePath)) {
      if (!graph.titleIndex.has(title)) {
        graph.titleIndex.set(title, new Set());
      }
      graph.titleIndex.get(title)!.add(relativePath);
    }
  }

  getInboundCount(notebookId: string, relativePath: string): number {
    const graph = this.graphs.get(notebookId);
    if (!graph) return 0;
    const inKeys = graph.inboundIndex.get(relativePath);
    if (!inKeys) return 0;
    let total = 0;
    for (const key of inKeys) {
      const edge = graph.edges.get(key);
      if (edge) total += edge.count;
    }
    return total;
  }

  private matchPhrasesAgainstTitles(
    sourcePath: string,
    phrases: Map<string, number>,
    titleIndex: Map<string, Set<string>>,
  ): Edge[] {
    const sourceBasename = this.titleFromPath(sourcePath);
    const edgeMap = new Map<string, Edge>();

    for (const [phrase, count] of phrases) {
      const matchingPaths = titleIndex.get(phrase);
      if (!matchingPaths) continue;

      for (const targetPath of matchingPaths) {
        // Self-link exclusion
        if (targetPath === sourcePath) continue;

        const key = `${sourcePath}::${targetPath}`;
        const existing = edgeMap.get(key);
        if (existing) {
          existing.count += count;
          if (count > (phrases.get(existing.noun) ?? 0)) {
            existing.noun = phrase;
          }
        } else {
          edgeMap.set(key, {
            source: sourcePath,
            target: targetPath,
            noun: phrase,
            count,
          });
        }
      }
    }

    return Array.from(edgeMap.values());
  }

  private addEdge(graph: LinkGraph, edge: Edge): void {
    const key = `${edge.source}::${edge.target}`;
    graph.edges.set(key, edge);

    if (!graph.outboundIndex.has(edge.source)) {
      graph.outboundIndex.set(edge.source, new Set());
    }
    graph.outboundIndex.get(edge.source)!.add(key);

    if (!graph.inboundIndex.has(edge.target)) {
      graph.inboundIndex.set(edge.target, new Set());
    }
    graph.inboundIndex.get(edge.target)!.add(key);
  }

  private removeOutboundEdges(graph: LinkGraph, sourcePath: string): void {
    const outKeys = graph.outboundIndex.get(sourcePath);
    if (!outKeys) return;

    for (const key of outKeys) {
      const edge = graph.edges.get(key);
      if (edge) {
        const inKeys = graph.inboundIndex.get(edge.target);
        if (inKeys) {
          inKeys.delete(key);
          if (inKeys.size === 0) graph.inboundIndex.delete(edge.target);
        }
      }
      graph.edges.delete(key);
    }
    graph.outboundIndex.delete(sourcePath);
  }

  private removeInboundEdges(graph: LinkGraph, targetPath: string): void {
    const inKeys = graph.inboundIndex.get(targetPath);
    if (!inKeys) return;

    for (const key of inKeys) {
      const edge = graph.edges.get(key);
      if (edge) {
        const outKeys = graph.outboundIndex.get(edge.source);
        if (outKeys) {
          outKeys.delete(key);
          if (outKeys.size === 0) graph.outboundIndex.delete(edge.source);
        }
      }
      graph.edges.delete(key);
    }
    graph.inboundIndex.delete(targetPath);
  }

  titleFromPath(relativePath: string): string {
    return path.basename(relativePath, '.md').toLowerCase();
  }

  /**
   * Returns all title variants for a file path, used for titleIndex registration and matching.
   * For "something/overview.md" returns ["overview", "something overview"].
   * For root-level "overview.md" returns ["overview"].
   */
  private titlesFromPath(relativePath: string): string[] {
    const basename = path.basename(relativePath, '.md').toLowerCase();
    const dir = path.dirname(relativePath);
    const titles = [basename];
    if (dir && dir !== '.') {
      const parentDir = path.basename(dir).toLowerCase();
      titles.push(`${parentDir} ${basename}`);
    }
    return titles;
  }
}
