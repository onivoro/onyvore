export interface NoteMetadata {
  relativePath: string;
  mtimeMs: number;
  /**
   * Content hash, used to recognize a rename.
   *
   * Optional because notebooks indexed before hashing existed have none; a note
   * without one simply never pairs, so it falls back to delete + create.
   */
  hash?: string;
}

export interface NotebookMetadata {
  files: Record<string, NoteMetadata>;
}
