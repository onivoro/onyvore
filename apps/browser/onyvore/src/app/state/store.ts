import { configureStore } from '@reduxjs/toolkit';
import { buildReducers, SliceConfig } from '@onivoro/browser-redux';
import { jsonRpcRequestEntitySlice } from './slices/jsonrpc-request-entity.slice';
import { jsonRpcResponseEntitySlice } from './slices/jsonrpc-response-entity.slice';
import { notebooksSlice } from './slices/notebooks.slice';
import { activeNotebookSlice } from './slices/active-notebook.slice';
import { linksSlice } from './slices/links.slice';
import { searchResultsSlice } from './slices/search-results.slice';
import { messageBusMiddleware } from './middleware/message-bus.middleware';

export const sliceRegistry: SliceConfig[] = [
  { slice: jsonRpcRequestEntitySlice },
  { slice: jsonRpcResponseEntitySlice },
  { slice: notebooksSlice },
  { slice: activeNotebookSlice },
  { slice: linksSlice },
  { slice: searchResultsSlice },
];

export const store = configureStore({
  reducer: buildReducers(sliceRegistry),
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(messageBusMiddleware),
});
