import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useRpc, useRpcResponse } from '../hooks/use-rpc-request.hook';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';
import type { RootState } from '../state/types/root-state.type';
import { notebooksActions } from '../state/slices/notebooks.slice';
import { NotebookTree } from './NotebookTree';
import { UnlinkedNotes } from './UnlinkedNotes';

interface NotebookSidebarProps {
  notebookId: string | null;
}

export function NotebookSidebar({ notebookId }: NotebookSidebarProps) {
  const dispatch = useDispatch();
  const { sendRequest } = useRpc();
  const [requestId, setRequestId] = useState<string | null>(null);
  const notebooks = useSelector((state: RootState) => state.notebooks.notebooks);
  const loading = useSelector((state: RootState) => state.notebooks.loading);
  const response = useRpcResponse(requestId);

  useEffect(() => {
    const id = sendRequest({
      method: onyvoreRpcMethods.NOTEBOOK_GET_NOTEBOOKS,
    });
    setRequestId(id);
  }, []);

  useEffect(() => {
    if (loading) {
      const id = sendRequest({
        method: onyvoreRpcMethods.NOTEBOOK_GET_NOTEBOOKS,
      });
      setRequestId(id);
    }
  }, [loading]);

  useEffect(() => {
    if (response?.result) {
      const data = response.result as { notebooks: any[] };
      dispatch(notebooksActions.setNotebooks(data.notebooks ?? []));
    }
  }, [response, dispatch]);

  if (notebooks.length === 0) {
    return (
      <div className="ony-empty">
        <div className="ony-empty__title">No notebooks found</div>
        <div className="ony-empty__description">
          Click the <strong>+</strong> button above to initialize a notebook
          from a folder containing Markdown files.
        </div>
      </div>
    );
  }

  const notebook = notebookId
    ? notebooks.find((n) => n.id === notebookId)
    : notebooks[0];

  if (!notebook) {
    return (
      <div className="ony-empty">
        <div className="ony-empty__title">Notebook not found</div>
        <div className="ony-empty__description">
          Select a notebook from the dropdown above.
        </div>
      </div>
    );
  }

  return (
    <>
      <NotebookTree notebook={notebook} />
      <UnlinkedNotes notebookId={notebook.id} />
    </>
  );
}
