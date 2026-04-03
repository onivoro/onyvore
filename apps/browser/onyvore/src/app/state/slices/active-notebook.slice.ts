import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface ActiveNotebookState {
  notebookId: string | null;
  activeNotePath: string | null;
}

const initialState: ActiveNotebookState = {
  notebookId: null,
  activeNotePath: null,
};

export const activeNotebookSlice = createSlice({
  name: 'activeNotebook',
  initialState,
  reducers: {
    setActiveNotebook(
      state,
      action: PayloadAction<{ notebookId: string | null; activeNotePath: string | null }>,
    ) {
      state.notebookId = action.payload.notebookId;
      state.activeNotePath = action.payload.activeNotePath;
    },
  },
});

export const activeNotebookActions = activeNotebookSlice.actions;
