import { useEffect, useState } from 'react';
import { useRpc, useRpcResponse } from '../hooks/use-rpc-request.hook';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';
import { CollapsibleSection } from './CollapsibleSection';
import { TreeItem } from './TreeItem';
import { LinkOffIcon } from './Icons';

interface UnlinkedNotesProps {
  notebookId: string;
}

export function UnlinkedNotes({ notebookId }: UnlinkedNotesProps) {
  const { sendRequest } = useRpc();
  const [requestId, setRequestId] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<string[]>([]);
  const response = useRpcResponse(requestId);

  useEffect(() => {
    const id = sendRequest({
      method: onyvoreRpcMethods.NOTEBOOK_GET_ORPHANS,
      params: { notebookId },
    });
    setRequestId(id);
  }, [notebookId]);

  useEffect(() => {
    if (response?.result) {
      setOrphans((response.result as { orphans: string[] }).orphans);
    }
  }, [response]);

  const handleFileClick = (relativePath: string) => {
    sendRequest({
      method: onyvoreRpcMethods.OPEN_FILE,
      params: { notebookId, relativePath },
    });
  };

  if (orphans.length === 0) return null;

  return (
    <CollapsibleSection
      title="Unlinked Notes"
      count={orphans.length}
      defaultOpen={false}
    >
      <ul className="ony-tree">
        {orphans.map((relPath) => {
          const basename =
            relPath.replace(/\.md$/, '').split('/').pop() ?? relPath;
          return (
            <TreeItem
              key={relPath}
              label={basename}
              sublabel={relPath.includes('/') ? relPath : undefined}
              icon={<LinkOffIcon />}
              onClick={() => handleFileClick(relPath)}
            />
          );
        })}
      </ul>
    </CollapsibleSection>
  );
}
