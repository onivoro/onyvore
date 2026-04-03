import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { jsonRpcRequestEntitySlice } from '../state/slices/jsonrpc-request-entity.slice';
import { jsonRpcResponseEntitySlice } from '../state/slices/jsonrpc-response-entity.slice';
import { JsonRpcRequest } from '@onivoro/isomorphic-jsonrpc';
import { v4 } from 'uuid';

export function useRpc() {
  const dispatch = useDispatch();

  const sendRequest = useCallback(
    <TParams = any>(
      _: Pick<JsonRpcRequest, 'method'> & { params?: TParams },
    ) => {
      const id = v4();
      const { method, params = {} } = _;
      dispatch(
        jsonRpcRequestEntitySlice.actions.setOne({
          id,
          jsonrpc: '2.0',
          method,
          params,
        }),
      );
      return id;
    },
    [dispatch],
  );

  return { sendRequest };
}

export function useRpcResponse(requestId: string | null) {
  return useSelector((state: any) => {
    if (!requestId) return undefined;
    const entities =
      jsonRpcResponseEntitySlice.selectors.entities(state);
    return entities[requestId];
  });
}
