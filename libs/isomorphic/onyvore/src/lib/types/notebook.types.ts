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

/** Which part of a note the query matched. */
export type SearchMatchField = 'content' | 'title' | 'path';

export interface NotebookSearchHit {
  relativePath: string;
  title: string;
  score: number;
  /** Text excerpts around content matches. Empty for a title-only hit. */
  snippets: string[];
  /** Where the query matched, so the UI can say why this surfaced. */
  matchedIn: SearchMatchField[];
  /**
   * The note's opening line, shown when there are no content snippets — a hit
   * matched by name still needs something to look at.
   */
  preview?: string;
  /** Matched only through typo tolerance, not an exact prefix. */
  approximate?: boolean;
}

export interface NotebookSearchResults {
  hits: NotebookSearchHit[];
  /**
   * True when an all-terms search found nothing and was retried as any-term,
   * so the UI can say the search was widened rather than silently changing.
   */
  widened: boolean;
}

/** A group of results from one notebook, for workspace-wide search. */
export interface NotebookSearchGroup {
  notebookId: string;
  notebookName: string;
  results: NotebookSearchHit[];
  /** Best score in this group, normalized to 0–1 within the group. */
  topScore: number;
}
