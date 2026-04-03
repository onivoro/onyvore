import { createEntitySlice } from '@onivoro/browser-redux';
import { JsonRpcResponse } from '@onivoro/isomorphic-jsonrpc';

export const jsonRpcResponseEntitySlice = createEntitySlice<
  Omit<JsonRpcResponse, 'id'> & { id: string }
>('jsonRpcResponseEntitySlice');
