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
