import { Injectable } from '@nestjs/common';
import type {
  Edge,
  EdgeType,
  LinksForNote,
  LinkEntry,
  NotebookGraph,
  GraphNode,
  GraphEdge,
} from '@onivoro/isomorphic-onyvore';
import * as path from 'path';

const VALID_EDGE_TYPES: ReadonlySet<string> = new Set<EdgeType>([
  'explicit',
  'mention',
  'similar',
]);

interface LinkGraph {
  edges: Map<string, Edge>;
  outboundIndex: Map<string, Set<string>>;
  inboundIndex: Map<string, Set<string>>;
  /** All files known to the graph (for orphan detection) */
  files: Set<string>;
}

@Injectable()
export class LinkGraphService {
  private graphs = new Map<string, LinkGraph>();

  getOrCreateGraph(notebookId: string): LinkGraph {
    let graph = this.graphs.get(notebookId);
    if (!graph) {
      graph = {
        edges: new Map(),
        outboundIndex: new Map(),
        inboundIndex: new Map(),
        files: new Set(),
      };
      this.graphs.set(notebookId, graph);
    }
    return graph;
  }

  removeGraph(notebookId: string): void {
    this.graphs.delete(notebookId);
  }

  /** Register a file as existing in the graph (for orphan detection). */
  registerFile(notebookId: string, filePath: string): void {
    const graph = this.getOrCreateGraph(notebookId);
    graph.files.add(filePath);
  }

  /** Unregister a file from the graph. */
  unregisterFile(notebookId: string, filePath: string): void {
    const graph = this.graphs.get(notebookId);
    if (graph) {
      graph.files.delete(filePath);
    }
  }

  /**
   * Replace every edge of `type` touching this file, in both directions.
   * For symmetric edge types (`similar`), where the file is equally the source
   * and the target of the same relationship.
   */
  replaceSymmetricEdgesForFile(
    notebookId: string,
    filePath: string,
    type: EdgeType,
    edges: Edge[],
  ): void {
    const graph = this.getOrCreateGraph(notebookId);
    this.removeOutboundEdgesByType(graph, filePath, type);
    this.removeInboundEdgesByType(graph, filePath, type);
    for (const edge of edges) {
      this.addEdge(graph, edge);
    }
  }

  /**
   * Replace only the outbound edges of `type` from this file. For directional
   * edge types (`explicit`, `mention`), where the source note owns the link.
   */
  replaceOutboundEdgesForFile(
    notebookId: string,
    filePath: string,
    type: EdgeType,
    edges: Edge[],
  ): void {
    const graph = this.getOrCreateGraph(notebookId);
    this.removeOutboundEdgesByType(graph, filePath, type);
    for (const edge of edges) {
      this.addEdge(graph, edge);
    }
  }

  /**
   * Replace only the inbound edges of `type` pointing at this file. Used when a
   * note is created and existing notes may already mention its title.
   */
  replaceInboundEdgesForFile(
    notebookId: string,
    filePath: string,
    type: EdgeType,
    edges: Edge[],
  ): void {
    const graph = this.getOrCreateGraph(notebookId);
    this.removeInboundEdgesByType(graph, filePath, type);
    for (const edge of edges) {
      this.addEdge(graph, edge);
    }
  }

  /** Replace every edge of `type` in the graph. Used during full rebuilds. */
  replaceAllEdgesOfType(notebookId: string, type: EdgeType, edges: Edge[]): void {
    const graph = this.getOrCreateGraph(notebookId);
    this.removeAllEdgesByType(graph, type);
    for (const edge of edges) {
      this.addEdge(graph, edge);
    }
  }

  /**
   * Remove all edges involving a file (every type). Called on file delete.
   */
  removeAllEdgesForFile(notebookId: string, filePath: string): void {
    const graph = this.graphs.get(notebookId);
    if (!graph) return;
    this.removeOutboundEdges(graph, filePath);
    this.removeInboundEdges(graph, filePath);
  }

  getLinksForNote(notebookId: string, relativePath: string): LinksForNote {
    const empty: LinksForNote = {
      notePath: relativePath,
      explicitOutbound: [],
      explicitInbound: [],
      mentionOutbound: [],
      mentionInbound: [],
      similar: [],
    };

    const graph = this.graphs.get(notebookId);
    if (!graph) return empty;

    const result: LinksForNote = { ...empty };

    const outKeys = graph.outboundIndex.get(relativePath);
    if (outKeys) {
      for (const key of outKeys) {
        const edge = graph.edges.get(key);
        if (!edge) continue;
        const entry = this.toEntry(edge, edge.target);
        if (edge.type === 'explicit') result.explicitOutbound.push(entry);
        else if (edge.type === 'mention') result.mentionOutbound.push(entry);
        else result.similar.push(entry);
      }
    }

    const inKeys = graph.inboundIndex.get(relativePath);
    if (inKeys) {
      for (const key of inKeys) {
        const edge = graph.edges.get(key);
        if (!edge) continue;
        // `similar` edges are stored in both directions; the outbound pass
        // already reported this relationship.
        if (edge.type === 'similar') continue;
        const entry = this.toEntry(edge, edge.source);
        if (edge.type === 'explicit') result.explicitInbound.push(entry);
        else result.mentionInbound.push(entry);
      }
    }

    result.explicitOutbound.sort((a, b) => a.noteTitle.localeCompare(b.noteTitle));
    result.explicitInbound.sort((a, b) => a.noteTitle.localeCompare(b.noteTitle));
    result.mentionOutbound.sort((a, b) => b.count - a.count);
    result.mentionInbound.sort((a, b) => b.count - a.count);
    result.similar.sort((a, b) => b.count - a.count);

    return result;
  }

  private toEntry(edge: Edge, notePath: string): LinkEntry {
    return {
      notePath,
      noteTitle: this.titleFromPath(notePath),
      type: edge.type,
      noun: edge.noun,
      displayText: edge.displayText,
      count: edge.count,
    };
  }

  /**
   * Notes with no authored and no mention edges in either direction.
   *
   * `similar` edges are deliberately excluded: cosine similarity connects
   * almost every note to something, so counting it would make this list
   * permanently empty and hide exactly the notes it exists to surface.
   */
  getOrphans(notebookId: string): string[] {
    const graph = this.graphs.get(notebookId);
    if (!graph) return [];

    const orphans: string[] = [];
    for (const filePath of graph.files) {
      if (!this.hasLinkingEdges(graph, filePath)) {
        orphans.push(filePath);
      }
    }
    return orphans;
  }

  private hasLinkingEdges(graph: LinkGraph, filePath: string): boolean {
    for (const index of [graph.outboundIndex, graph.inboundIndex]) {
      const keys = index.get(filePath);
      if (!keys) continue;
      for (const key of keys) {
        const edge = graph.edges.get(key);
        if (edge && edge.type !== 'similar') return true;
      }
    }
    return false;
  }

  /**
   * The whole graph, for visualization.
   *
   * `similar` edges are stored in both directions; only one is emitted here so
   * the renderer draws a single undirected line. When the notebook exceeds
   * `maxNodes`, the best-connected notes are kept and the count of dropped
   * notes is reported rather than silently truncated.
   */
  getGraph(notebookId: string, maxNodes = 500): NotebookGraph {
    const graph = this.graphs.get(notebookId);
    if (!graph) {
      return { notebookId, nodes: [], edges: [], truncated: 0 };
    }

    const all: GraphNode[] = Array.from(graph.files).map((filePath) => ({
      relativePath: filePath,
      title: this.titleFromPath(filePath),
      degree: this.linkingDegree(graph, filePath),
      orphan: !this.hasLinkingEdges(graph, filePath),
    }));

    const kept =
      all.length <= maxNodes
        ? all
        : [...all].sort((a, b) => b.degree - a.degree).slice(0, maxNodes);

    const visible = new Set(kept.map((n) => n.relativePath));
    const edges: GraphEdge[] = [];
    const seenSimilar = new Set<string>();

    for (const edge of graph.edges.values()) {
      if (!visible.has(edge.source) || !visible.has(edge.target)) continue;

      if (edge.type === 'similar') {
        const key =
          edge.source < edge.target
            ? `${edge.source}\u0000${edge.target}`
            : `${edge.target}\u0000${edge.source}`;
        if (seenSimilar.has(key)) continue;
        seenSimilar.add(key);
      }

      edges.push({
        source: edge.source,
        target: edge.target,
        type: edge.type,
        count: edge.count,
      });
    }

    return {
      notebookId,
      nodes: kept,
      edges,
      truncated: all.length - kept.length,
    };
  }

  /** Count of non-`similar` edges touching a note, in either direction. */
  private linkingDegree(graph: LinkGraph, filePath: string): number {
    let degree = 0;
    for (const index of [graph.outboundIndex, graph.inboundIndex]) {
      for (const key of index.get(filePath) ?? []) {
        const edge = graph.edges.get(key);
        if (edge && edge.type !== 'similar') degree++;
      }
    }
    return degree;
  }

  getEdgesForPersistence(notebookId: string): Edge[] {
    const graph = this.graphs.get(notebookId);
    if (!graph) return [];
    return Array.from(graph.edges.values());
  }

  loadEdges(notebookId: string, edges: Edge[]): void {
    const graph = this.getOrCreateGraph(notebookId);
    for (const edge of edges) {
      if (!VALID_EDGE_TYPES.has(edge?.type)) continue;
      this.addEdge(graph, edge);
    }
  }

  /**
   * Returns the number of inbound edges (graph connectivity measure).
   * Used by SearchIndexService for graph-boosted ranking.
   */
  getInboundCount(notebookId: string, relativePath: string): number {
    const graph = this.graphs.get(notebookId);
    if (!graph) return 0;
    const inKeys = graph.inboundIndex.get(relativePath);
    return inKeys ? inKeys.size : 0;
  }

  titleFromPath(relativePath: string): string {
    return path.basename(relativePath, '.md').toLowerCase();
  }

  private edgeKey(edge: Edge): string {
    return `${edge.type}::${edge.source}::${edge.target}`;
  }

  private addEdge(graph: LinkGraph, edge: Edge): void {
    const key = this.edgeKey(edge);
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

  private removeOutboundEdgesByType(
    graph: LinkGraph,
    sourcePath: string,
    type: EdgeType,
  ): void {
    const outKeys = graph.outboundIndex.get(sourcePath);
    if (!outKeys) return;

    const toRemove: string[] = [];
    for (const key of outKeys) {
      const edge = graph.edges.get(key);
      if (edge && edge.type === type) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      const edge = graph.edges.get(key)!;
      outKeys.delete(key);
      const inKeys = graph.inboundIndex.get(edge.target);
      if (inKeys) {
        inKeys.delete(key);
        if (inKeys.size === 0) graph.inboundIndex.delete(edge.target);
      }
      graph.edges.delete(key);
    }

    if (outKeys.size === 0) graph.outboundIndex.delete(sourcePath);
  }

  private removeInboundEdgesByType(
    graph: LinkGraph,
    targetPath: string,
    type: EdgeType,
  ): void {
    const inKeys = graph.inboundIndex.get(targetPath);
    if (!inKeys) return;

    const toRemove: string[] = [];
    for (const key of inKeys) {
      const edge = graph.edges.get(key);
      if (edge && edge.type === type) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      const edge = graph.edges.get(key)!;
      inKeys.delete(key);
      const outKeys = graph.outboundIndex.get(edge.source);
      if (outKeys) {
        outKeys.delete(key);
        if (outKeys.size === 0) graph.outboundIndex.delete(edge.source);
      }
      graph.edges.delete(key);
    }

    if (inKeys.size === 0) graph.inboundIndex.delete(targetPath);
  }

  private removeAllEdgesByType(graph: LinkGraph, type: EdgeType): void {
    const toRemove: string[] = [];
    for (const [key, edge] of graph.edges) {
      if (edge.type === type) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      const edge = graph.edges.get(key)!;

      const outKeys = graph.outboundIndex.get(edge.source);
      if (outKeys) {
        outKeys.delete(key);
        if (outKeys.size === 0) graph.outboundIndex.delete(edge.source);
      }

      const inKeys = graph.inboundIndex.get(edge.target);
      if (inKeys) {
        inKeys.delete(key);
        if (inKeys.size === 0) graph.inboundIndex.delete(edge.target);
      }

      graph.edges.delete(key);
    }
  }
}
