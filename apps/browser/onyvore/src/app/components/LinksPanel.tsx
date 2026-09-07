import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useRpc, useRpcResponse } from '../hooks/use-rpc-request.hook';
import { onyvoreRpcMethods, type LinksForNote } from '@onivoro/isomorphic-onyvore';
import type { RootState } from '../state/types/root-state.type';
import { LinkList } from './LinkList';
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
    return <div className="ony-empty__hint">Open a note to see its links.</div>;
  }

  if (!links) {
    return <div className="ony-empty__hint">Loading links...</div>;
  }

  const hasWikilinks =
    links.explicitOutbound.length > 0 || links.explicitInbound.length > 0;
  const hasMentions =
    links.mentionOutbound.length > 0 || links.mentionInbound.length > 0;
  const hasSimilar = links.similar.length > 0;

  if (!hasWikilinks && !hasMentions && !hasSimilar) {
    return <div className="ony-empty__hint">No links found for this note.</div>;
  }

  return (
    <>
      {hasWikilinks && (
        <>
          <CollapsibleSection title="Links" count={links.explicitOutbound.length}>
            <LinkList
              links={links.explicitOutbound}
              notebookId={notebookId}
              emptyMessage="No links from this note"
            />
          </CollapsibleSection>

          <CollapsibleSection title="Backlinks" count={links.explicitInbound.length}>
            <LinkList
              links={links.explicitInbound}
              notebookId={notebookId}
              emptyMessage="No links to this note"
            />
          </CollapsibleSection>
        </>
      )}

      {hasMentions && (
        <>
          <CollapsibleSection
            title="Mentions"
            count={links.mentionOutbound.length}
            defaultOpen={!hasWikilinks}
          >
            <LinkList
              links={links.mentionOutbound}
              notebookId={notebookId}
              emptyMessage="This note mentions no others"
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="Mentioned By"
            count={links.mentionInbound.length}
            defaultOpen={!hasWikilinks}
          >
            <LinkList
              links={links.mentionInbound}
              notebookId={notebookId}
              emptyMessage="No notes mention this one"
            />
          </CollapsibleSection>
        </>
      )}

      {hasSimilar && (
        <CollapsibleSection
          title="Related Notes"
          count={links.similar.length}
          defaultOpen={!hasWikilinks && !hasMentions}
        >
          <LinkList
            links={links.similar}
            notebookId={notebookId}
            emptyMessage="No related notes"
          />
        </CollapsibleSection>
      )}
    </>
  );
}
