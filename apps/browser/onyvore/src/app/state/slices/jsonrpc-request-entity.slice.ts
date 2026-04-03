import { createEntitySlice } from '@onivoro/browser-redux';
import { JsonRpcRequest } from '@onivoro/isomorphic-jsonrpc';

export const jsonRpcRequestEntitySlice = createEntitySlice<
  Omit<JsonRpcRequest, 'id'> & { id: string }
>('jsonRpcRequestEntitySlice');
