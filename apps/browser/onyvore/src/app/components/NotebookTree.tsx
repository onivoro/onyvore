import { onyvoreRpcMethods, type NotebookInfo, type NotebookFile } from '@onivoro/isomorphic-onyvore';
import { useRpc } from '../hooks/use-rpc-request.hook';
import { CollapsibleSection } from './CollapsibleSection';
import { TreeItem } from './TreeItem';
import { FileIcon } from './Icons';

interface NotebookTreeProps {
  notebook: NotebookInfo & { files: NotebookFile[] };
}

export function NotebookTree({ notebook }: NotebookTreeProps) {
  const { sendRequest } = useRpc();

  const handleFileClick = (relativePath: string) => {
    sendRequest({
      method: onyvoreRpcMethods.OPEN_FILE,
      params: { notebookId: notebook.id, relativePath },
    });
  };

  const statusLabel =
    notebook.status !== 'ready'
      ? ` (${notebook.status}${notebook.progress !== undefined ? ` ${notebook.progress}%` : ''})`
      : '';

  return (
    <CollapsibleSection
      title={`${notebook.name}${statusLabel}`}
      count={notebook.files.length}
    >
      {notebook.status !== 'ready' && notebook.progress !== undefined && (
        <div className="ony-progress">
          <div
            className="ony-progress__bar"
            style={{ width: `${notebook.progress}%` }}
          />
        </div>
      )}
      <ul className="ony-tree">
        {notebook.files.map((file) => (
          <TreeItem
            key={file.relativePath}
            label={file.basename}
            sublabel={file.relativePath.includes('/') ? file.relativePath : undefined}
            icon={<FileIcon />}
            onClick={() => handleFileClick(file.relativePath)}
          />
        ))}
      </ul>
    </CollapsibleSection>
  );
}
