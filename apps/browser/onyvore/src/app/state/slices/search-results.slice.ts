import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface SearchResult {
  relativePath: string;
  title: string;
  score: number;
}

interface SearchResultsState {
  query: string;
  results: SearchResult[];
  loading: boolean;
  visible: boolean;
}

const initialState: SearchResultsState = {
  query: '',
  results: [],
  loading: false,
  visible: false,
};

export const searchResultsSlice = createSlice({
  name: 'searchResults',
  initialState,
  reducers: {
    setQuery(state, action: PayloadAction<string>) {
      state.query = action.payload;
    },
    setResults(state, action: PayloadAction<SearchResult[]>) {
      state.results = action.payload;
      state.loading = false;
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    show(state) {
      state.visible = true;
    },
    hide(state) {
      state.visible = false;
      state.query = '';
      state.results = [];
    },
  },
});

export const searchResultsActions = searchResultsSlice.actions;
