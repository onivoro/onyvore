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

  const hasExplicit = links.explicitOutbound.length > 0 || links.explicitInbound.length > 0;
  const hasImplicit = links.implicitOutbound.length > 0 || links.implicitInbound.length > 0;

  if (!hasExplicit && !hasImplicit) {
    return (
      <div className="ony-empty__hint">No links found for this note.</div>
    );
  }

  return (
    <>
      {hasExplicit && (
        <>
          <CollapsibleSection title="Outbound Links" count={links.explicitOutbound.length}>
            <OutboundLinks links={links.explicitOutbound} notebookId={notebookId} emptyMessage="No outbound links" />
          </CollapsibleSection>

          <CollapsibleSection title="Backlinks" count={links.explicitInbound.length}>
            <InboundLinks links={links.explicitInbound} notebookId={notebookId} emptyMessage="No backlinks" />
          </CollapsibleSection>
        </>
      )}

      {hasImplicit && (
        <>
          <CollapsibleSection title="Related Notes" count={links.implicitOutbound.length} defaultOpen={!hasExplicit}>
            <OutboundLinks links={links.implicitOutbound} notebookId={notebookId} emptyMessage="No related notes" />
          </CollapsibleSection>

          <CollapsibleSection title="Related Backlinks" count={links.implicitInbound.length} defaultOpen={false}>
            <InboundLinks links={links.implicitInbound} notebookId={notebookId} emptyMessage="No related backlinks" />
          </CollapsibleSection>
        </>
      )}
    </>
  );
}
