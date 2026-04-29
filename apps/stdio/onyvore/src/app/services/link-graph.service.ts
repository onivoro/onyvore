import { Injectable } from '@nestjs/common';
import type { Edge, EdgeType, LinksForNote, LinkEntry } from '@onivoro/isomorphic-onyvore';
import * as path from 'path';

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
   * Replace all implicit edges involving a given file (both outbound AND inbound)
   * with the provided edge set. Called after TfidfService.computeEdgesForDocument().
   */
  replaceImplicitEdgesForFile(notebookId: string, filePath: string, edges: Edge[]): void {
    const graph = this.getOrCreateGraph(notebookId);
    this.removeOutboundEdgesByType(graph, filePath, 'implicit');
    this.removeInboundEdgesByType(graph, filePath, 'implicit');
    for (const edge of edges) {
      this.addEdge(graph, edge);
    }
  }

  /**
   * Replace only explicit outbound edges from a file.
   * Called after WikilinkService.extractAndResolve().
   * Only removes outbound (directional: the source file owns its [[]] links).
   */
  replaceExplicitEdgesForFile(notebookId: string, filePath: string, edges: Edge[]): void {
    const graph = this.getOrCreateGraph(notebookId);
    this.removeOutboundEdgesByType(graph, filePath, 'explicit');
    for (const edge of edges) {
      this.addEdge(graph, edge);
    }
  }

  /**
   * Replace all implicit edges in the graph. Used during full initialization
   * after TfidfService.computeAllEdges().
   */
  replaceAllImplicitEdges(notebookId: string, edges: Edge[]): void {
    const graph = this.getOrCreateGraph(notebookId);
    this.removeAllEdgesByType(graph, 'implicit');
    for (const edge of edges) {
      this.addEdge(graph, edge);
    }
  }

  /**
   * Remove all edges involving a file (both types). Called on file delete.
   */
  removeAllEdgesForFile(notebookId: string, filePath: string): void {
    const graph = this.graphs.get(notebookId);
    if (!graph) return;
    this.removeOutboundEdges(graph, filePath);
    this.removeInboundEdges(graph, filePath);
  }

  getLinksForNote(notebookId: string, relativePath: string): LinksForNote {
    const graph = this.graphs.get(notebookId);
    if (!graph) {
      return {
        notePath: relativePath,
        explicitOutbound: [],
        explicitInbound: [],
        implicitOutbound: [],
        implicitInbound: [],
      };
    }

    const explicitOutbound: LinkEntry[] = [];
    const implicitOutbound: LinkEntry[] = [];
    const outKeys = graph.outboundIndex.get(relativePath);
    if (outKeys) {
      for (const key of outKeys) {
        const edge = graph.edges.get(key);
        if (!edge) continue;
        const entry: LinkEntry = {
          notePath: edge.target,
          noteTitle: this.titleFromPath(edge.target),
          type: edge.type,
          noun: edge.noun,
          displayText: edge.displayText,
          count: edge.count,
        };
        if (edge.type === 'explicit') {
          explicitOutbound.push(entry);
        } else {
          implicitOutbound.push(entry);
        }
      }
    }
    explicitOutbound.sort((a, b) => a.noteTitle.localeCompare(b.noteTitle));
    implicitOutbound.sort((a, b) => b.count - a.count);

    const explicitInbound: LinkEntry[] = [];
    const implicitInbound: LinkEntry[] = [];
    const inKeys = graph.inboundIndex.get(relativePath);
    if (inKeys) {
      for (const key of inKeys) {
        const edge = graph.edges.get(key);
        if (!edge) continue;
        const entry: LinkEntry = {
          notePath: edge.source,
          noteTitle: this.titleFromPath(edge.source),
          type: edge.type,
          noun: edge.noun,
          displayText: edge.displayText,
          count: edge.count,
        };
        if (edge.type === 'explicit') {
          explicitInbound.push(entry);
        } else {
          implicitInbound.push(entry);
        }
      }
    }
    explicitInbound.sort((a, b) => a.noteTitle.localeCompare(b.noteTitle));
    implicitInbound.sort((a, b) => b.count - a.count);

    return {
      notePath: relativePath,
      explicitOutbound,
      explicitInbound,
      implicitOutbound,
      implicitInbound,
    };
  }

  getOrphans(notebookId: string): string[] {
    const graph = this.graphs.get(notebookId);
    if (!graph) return [];

    const orphans: string[] = [];
    for (const filePath of graph.files) {
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
      // Backward compat: edges persisted before the type field default to implicit
      if (!edge.type) {
        (edge as any).type = 'implicit';
      }
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
    const type = edge.type || 'implicit';
    return `${type}::${edge.source}::${edge.target}`;
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
