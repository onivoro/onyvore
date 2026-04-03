import { Middleware, isAction } from '@reduxjs/toolkit';
import { createWebviewMessageBus, WebviewMessageBus } from '@onivoro/browser-jsonrpc';
import { JsonRpcRequest } from '@onivoro/isomorphic-jsonrpc';
import { jsonRpcRequestEntitySlice } from '../slices/jsonrpc-request-entity.slice';
import { jsonRpcResponseEntitySlice } from '../slices/jsonrpc-response-entity.slice';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';
import { notebooksActions } from '../slices/notebooks.slice';
import { activeNotebookActions } from '../slices/active-notebook.slice';
import { searchResultsActions } from '../slices/search-results.slice';

let messageBusInstance: WebviewMessageBus | null = null;

function getMessageBus(): WebviewMessageBus | null {
  if (messageBusInstance) return messageBusInstance;
  try {
    messageBusInstance = createWebviewMessageBus();
    return messageBusInstance;
  } catch {
    console.warn('[MessageBusMiddleware] VSCode API not available');
    return null;
  }
}

export const messageBusMiddleware: Middleware = (storeApi) => {
  // Set up notification listener once the middleware is initialized
  setTimeout(() => {
    const messageBus = getMessageBus();
    if (!messageBus) return;

    const fetchNotebooks = () => {
      messageBus
        .sendRequest(onyvoreRpcMethods.NOTEBOOK_GET_NOTEBOOKS, {})
        .then((result) => {
          const data = result as { notebooks: any[] };
          storeApi.dispatch(notebooksActions.setNotebooks(data.notebooks ?? []));
        })
        .catch((err: Error) => {
          console.error('[MessageBus] Failed to fetch notebooks:', err);
        });
    };

    messageBus.onNotification(onyvoreRpcMethods.NOTEBOOK_READY, fetchNotebooks);
    messageBus.onNotification(onyvoreRpcMethods.NOTEBOOK_INDEX_UPDATED, fetchNotebooks);

    messageBus.onNotification(onyvoreRpcMethods.NOTEBOOK_INIT_PROGRESS, (params: any) => {
      storeApi.dispatch(
        notebooksActions.updateNotebookStatus({
          notebookId: params.notebookId,
          status: 'initializing',
          progress: params.progress,
        }),
      );
    });

    messageBus.onNotification(onyvoreRpcMethods.NOTEBOOK_RECONCILE_PROGRESS, (params: any) => {
      storeApi.dispatch(
        notebooksActions.updateNotebookStatus({
          notebookId: params.notebookId,
          status: 'reconciling',
          progress: params.progress,
        }),
      );
    });

    messageBus.onNotification(onyvoreRpcMethods.ACTIVE_NOTEBOOK_CHANGED, (params: any) => {
      storeApi.dispatch(
        activeNotebookActions.setActiveNotebook({
          notebookId: params.notebookId,
          activeNotePath: params.activeNotePath,
        }),
      );
    });

    messageBus.onNotification(onyvoreRpcMethods.SEARCH_SHOW, () => {
      storeApi.dispatch(searchResultsActions.show());
    });
  }, 0);

  return (next) => (action) => {
    const result = next(action);
    if (!isAction(action)) return result;

    const setOneActionType = jsonRpcRequestEntitySlice.actions.setOne.type;
    if (action.type !== setOneActionType) return result;

    const request = (action as ReturnType<typeof jsonRpcRequestEntitySlice.actions.setOne>)
      .payload as JsonRpcRequest & { id: string };

    const messageBus = getMessageBus();
    if (!messageBus) return result;

    messageBus
      .sendRequest(request.method, request.params)
      .then((responseResult) => {
        storeApi.dispatch(
          jsonRpcResponseEntitySlice.actions.setOne({
            id: request.id,
            jsonrpc: '2.0',
            result: responseResult,
          }),
        );
      })
      .catch((error: Error) => {
        storeApi.dispatch(
          jsonRpcResponseEntitySlice.actions.setOne({
            id: request.id,
            jsonrpc: '2.0',
            error: { code: -32603, message: error.message || 'Internal error' },
          }),
        );
      });

    return result;
  };
};

export function disposeMessageBus(): void {
  if (messageBusInstance) {
    messageBusInstance.dispose();
    messageBusInstance = null;
  }
}
