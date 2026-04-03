import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { NotebookInfo, NotebookFile } from '@onivoro/isomorphic-onyvore';

interface NotebookWithFiles extends NotebookInfo {
  files: NotebookFile[];
}

interface NotebooksState {
  notebooks: NotebookWithFiles[];
  loading: boolean;
  indexVersion: number;
}

const initialState: NotebooksState = {
  notebooks: [],
  loading: false,
  indexVersion: 0,
};

export const notebooksSlice = createSlice({
  name: 'notebooks',
  initialState,
  reducers: {
    setNotebooks(state, action: PayloadAction<NotebookWithFiles[]>) {
      state.notebooks = action.payload;
      state.loading = false;
      state.indexVersion += 1;
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    updateNotebookStatus(
      state,
      action: PayloadAction<{
        notebookId: string;
        status: NotebookInfo['status'];
        progress?: number;
      }>,
    ) {
      const notebook = state.notebooks.find(
        (n) => n.id === action.payload.notebookId,
      );
      if (notebook) {
        notebook.status = action.payload.status;
        notebook.progress = action.payload.progress;
      }
    },
  },
});

export const notebooksActions = notebooksSlice.actions;
