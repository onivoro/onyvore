export interface NoteMetadata {
  relativePath: string;
  mtimeMs: number;
}

export interface NotebookMetadata {
  files: Record<string, NoteMetadata>;
}
