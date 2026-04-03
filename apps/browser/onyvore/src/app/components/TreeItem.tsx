import type { ReactNode } from 'react';

interface TreeItemProps {
  label: string;
  sublabel?: string;
  icon?: ReactNode;
  badge?: string | number;
  onClick: () => void;
}

export function TreeItem({ label, sublabel, icon, badge, onClick }: TreeItemProps) {
  return (
    <li
      className="ony-tree__item"
      tabIndex={0}
      role="button"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick();
      }}
    >
      {icon && <span className="ony-tree__icon">{icon}</span>}
      <span className="ony-tree__text">
        <span className="ony-tree__label">{label}</span>
        {sublabel && <span className="ony-tree__sublabel">{sublabel}</span>}
      </span>
      {badge !== undefined && (
        <span className="ony-tree__badge">{badge}</span>
      )}
    </li>
  );
}
