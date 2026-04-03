import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useRpc, useRpcResponse } from '../hooks/use-rpc-request.hook';
import { onyvoreRpcMethods, type LinksForNote } from '@onivoro/isomorphic-onyvore';
import type { RootState } from '../state/types/root-state.type';
import { OutboundLinks } from './OutboundLinks';
import { InboundLinks } from './InboundLinks';
import { CollapsibleSection } from './CollapsibleSection';

export function LinksPanel() {
  const { sendRequest } = useRpc();
  const [requestId, setRequestId] = useState<string | null>(null);
  const [links, setLinks] = useState<LinksForNote | null>(null);
  const response = useRpcResponse(requestId);

  const notebookId = useSelector(
    (state: RootState) => state.activeNotebook.notebookId,
  );
  const activeNotePath = useSelector(
    (state: RootState) => state.activeNotebook.activeNotePath,
  );
  const indexVersion = useSelector(
    (state: RootState) => state.notebooks.indexVersion,
  );

  useEffect(() => {
    if (!notebookId || !activeNotePath) {
      setLinks(null);
      return;
    }

    const id = sendRequest({
      method: onyvoreRpcMethods.NOTEBOOK_GET_LINKS,
      params: { notebookId, relativePath: activeNotePath },
    });
    setRequestId(id);
  }, [notebookId, activeNotePath, indexVersion]);

  useEffect(() => {
    if (response?.result) {
      setLinks(response.result as LinksForNote);
    }
  }, [response]);

  if (!notebookId || !activeNotePath) {
    return (
      <div className="ony-empty__hint">Open a note to see its links.</div>
    );
  }

  if (!links) {
    return (
      <div className="ony-empty__hint">Loading links...</div>
    );
  }

  return (
    <>
      <CollapsibleSection title="Outbound Links" count={links.outbound.length}>
        <OutboundLinks links={links.outbound} notebookId={notebookId} />
      </CollapsibleSection>

      <CollapsibleSection title="Backlinks" count={links.inbound.length}>
        <InboundLinks links={links.inbound} notebookId={notebookId} />
      </CollapsibleSection>
    </>
  );
}
