import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { LinksForNote } from '@onivoro/isomorphic-onyvore';

interface LinksState {
  current: LinksForNote | null;
  loading: boolean;
}

const initialState: LinksState = {
  current: null,
  loading: false,
};

export const linksSlice = createSlice({
  name: 'links',
  initialState,
  reducers: {
    setLinks(state, action: PayloadAction<LinksForNote>) {
      state.current = action.payload;
      state.loading = false;
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    clearLinks(state) {
      state.current = null;
      state.loading = false;
    },
  },
});

export const linksActions = linksSlice.actions;
