import { onyvoreRpcMethods, type LinkEntry } from '@onivoro/isomorphic-onyvore';
import { useRpc } from '../hooks/use-rpc-request.hook';
import { TreeItem } from './TreeItem';
import { FileIcon } from './Icons';

interface InboundLinksProps {
  links: LinkEntry[];
  notebookId: string;
}

export function InboundLinks({ links, notebookId }: InboundLinksProps) {
  const { sendRequest } = useRpc();

  const handleClick = (relativePath: string) => {
    sendRequest({
      method: onyvoreRpcMethods.OPEN_FILE,
      params: { notebookId, relativePath },
    });
  };

  if (links.length === 0) {
    return <div className="ony-empty__hint">No backlinks</div>;
  }

  return (
    <ul className="ony-tree">
      {links.map((link) => (
        <TreeItem
          key={link.notePath}
          label={link.noteTitle}
          sublabel={link.notePath}
          icon={<FileIcon />}
          badge={link.count}
          onClick={() => handleClick(link.notePath)}
        />
      ))}
    </ul>
  );
}
