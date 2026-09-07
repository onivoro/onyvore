import { onyvoreRpcMethods, type LinkEntry } from '@onivoro/isomorphic-onyvore';
import { useRpc } from '../hooks/use-rpc-request.hook';
import { TreeItem } from './TreeItem';
import { LinkIcon, QuoteIcon, RelatedIcon } from './Icons';

interface LinkListProps {
  links: LinkEntry[];
  notebookId: string;
  emptyMessage?: string;
}

const ICONS = {
  explicit: <LinkIcon />,
  mention: <QuoteIcon />,
  similar: <RelatedIcon />,
};

/**
 * Renders one bucket of the links panel. `notePath` is already the *other*
 * note — the target for outbound links, the source for inbound — so the same
 * list works in both directions.
 */
export function LinkList({ links, notebookId, emptyMessage = 'None' }: LinkListProps) {
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
          icon={ICONS[link.type]}
          // A wikilink has no count worth showing; mentions and similarity do.
          badge={link.type === 'explicit' ? undefined : link.count}
          onClick={() => handleClick(link.notePath)}
        />
      ))}
    </ul>
  );
}
