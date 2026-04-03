export type FileEventType = 'create' | 'change' | 'delete';

export interface FileEvent {
  type: FileEventType;
  relativePath: string;
  notebookId: string;
}

export interface FileEventBatch {
  notebookId: string;
  events: FileEvent[];
}
