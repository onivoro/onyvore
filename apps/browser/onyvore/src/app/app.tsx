import { useState, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useRpc, useRpcResponse } from './hooks/use-rpc-request.hook';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';
import type { RootState } from './state/types/root-state.type';
import { NotebookSidebar } from './components/NotebookSidebar';
import { LinksPanel } from './components/LinksPanel';
import { SearchBar } from './components/SearchBar';
import { NotebookSelector } from './components/NotebookSelector';
import { PlusIcon, RebuildIcon } from './components/Icons';

export default function App() {
  const { sendRequest } = useRpc();
  const [pickRequestId, setPickRequestId] = useState<string | null>(null);
  const pickResponse = useRpcResponse(pickRequestId);

  const activeNotebookId = useSelector(
    (state: RootState) => state.activeNotebook.notebookId,
  );
  const notebooks = useSelector(
    (state: RootState) => state.notebooks.notebooks,
  );

  const [viewingId, setViewingId] = useState<string | null>(null);
  const [pendingInit, setPendingInit] = useState(false);
  const prevNotebookCount = useRef(notebooks.length);

  // Default to active notebook, or the only notebook if there's just one
  const currentNotebookId =
    viewingId ?? activeNotebookId ?? (notebooks.length === 1 ? notebooks[0].id : null);

  // When pick directory returns, initialize the notebook
  useEffect(() => {
    if (pickResponse?.result) {
      const { directoryPath } = pickResponse.result as {
        directoryPath: string;
      };
      if (directoryPath) {
        sendRequest({
          method: onyvoreRpcMethods.NOTEBOOK_INITIALIZE,
          params: { directoryPath },
        });
        setPendingInit(true);
      }
      setPickRequestId(null);
    }
  }, [pickResponse, sendRequest]);

  // Auto-select newly initialized notebook when it appears in the list
  useEffect(() => {
    if (pendingInit && notebooks.length > prevNotebookCount.current) {
      const newNotebook = notebooks.find(
        (n) => !prevNotebookCount.current || n.id !== viewingId,
      );
      if (newNotebook) {
        setViewingId(newNotebook.id);
      }
      setPendingInit(false);
    }
    prevNotebookCount.current = notebooks.length;
  }, [notebooks, pendingInit]);

  const handleAddNotebook = () => {
    const id = sendRequest({
      method: onyvoreRpcMethods.PICK_DIRECTORY,
    });
    setPickRequestId(id);
  };

  const handleRebuild = () => {
    if (!currentNotebookId) return;
    sendRequest({
      method: onyvoreRpcMethods.NOTEBOOK_REBUILD,
      params: { notebookId: currentNotebookId },
    });
  };

  return (
    <div className="ony-app">
      <div className="ony-toolbar">
        <span className="ony-toolbar__title">ONYVORE</span>
        <button
          className="ony-toolbar__btn"
          title="Initialize new notebook"
          onClick={handleAddNotebook}
        >
          <PlusIcon />
        </button>
        <button
          className="ony-toolbar__btn"
          title="Rebuild index"
          onClick={handleRebuild}
          disabled={!currentNotebookId}
        >
          <RebuildIcon />
        </button>
      </div>

      {notebooks.length > 1 && (
        <div style={{ padding: '4px 8px', flexShrink: 0 }}>
          <NotebookSelector
            notebooks={notebooks.map((n: { id: string; name: string }) => ({
              id: n.id,
              name: n.name,
            }))}
            selectedId={currentNotebookId}
            onSelect={setViewingId}
          />
        </div>
      )}

      <SearchBar notebookId={currentNotebookId} />

      <div className="ony-app__main">
        <NotebookSidebar notebookId={currentNotebookId} />
      </div>

      <div className="ony-app__links">
        <LinksPanel />
      </div>
    </div>
  );
}
