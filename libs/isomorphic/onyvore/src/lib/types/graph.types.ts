import type { EdgeType } from './edge.types';

export interface GraphNode {
  relativePath: string;
  title: string;
  /** Non-`similar` edges touching this note; drives node size. */
  degree: number;
  /** True when the note has no `explicit` or `mention` edges. */
  orphan: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  count: number;
}

export interface NotebookGraph {
  notebookId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Nodes omitted because the graph exceeded the requested cap. */
  truncated: number;
}
