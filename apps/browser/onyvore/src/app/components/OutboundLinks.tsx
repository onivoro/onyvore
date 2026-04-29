import { onyvoreRpcMethods, type LinkEntry } from '@onivoro/isomorphic-onyvore';
import { useRpc } from '../hooks/use-rpc-request.hook';
import { TreeItem } from './TreeItem';
import { FileIcon, LinkIcon } from './Icons';

interface OutboundLinksProps {
  links: LinkEntry[];
  notebookId: string;
  emptyMessage?: string;
}

export function OutboundLinks({ links, notebookId, emptyMessage = 'None' }: OutboundLinksProps) {
  const { sendRequest } = useRpc();

  const handleClick = (relativePath: string) => {
    sendRequest({
      method: onyvoreRpcMethods.OPEN_FILE,
      params: { notebookId, relativePath },
    });
  };

  if (links.length === 0) {
    return <div className="ony-empty__hint">{emptyMessage}</div>;
  }

  return (
    <ul className="ony-tree">
      {links.map((link) => (
        <TreeItem
          key={link.notePath}
          label={link.displayText ?? link.noteTitle}
          sublabel={link.notePath}
          icon={link.type === 'explicit' ? <LinkIcon /> : <FileIcon />}
          badge={link.type === 'implicit' ? link.count : undefined}
          onClick={() => handleClick(link.notePath)}
        />
      ))}
    </ul>
  );
}
