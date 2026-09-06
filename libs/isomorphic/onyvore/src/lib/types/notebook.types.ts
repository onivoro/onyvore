export interface NotebookInfo {
  id: string;
  rootPath: string;
  name: string;
  fileCount: number;
  status: 'initializing' | 'reconciling' | 'ready';
  progress?: number;
}

export interface NotebookFileTree {
  notebookId: string;
  files: NotebookFile[];
}

export interface NotebookFile {
  relativePath: string;
  basename: string;
}

export interface NotebookSearchHit {
  relativePath: string;
  title: string;
  score: number;
  snippets: string[];
}

/** A group of results from one notebook, for workspace-wide search. */
export interface NotebookSearchGroup {
  notebookId: string;
  notebookName: string;
  results: NotebookSearchHit[];
}
