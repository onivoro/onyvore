import type { ReactNode } from 'react';

interface TreeItemProps {
  label: string;
  sublabel?: string;
  icon?: ReactNode;
  badge?: string | number;
  /** Highlighted by keyboard navigation. */
  selected?: boolean;
  onClick: () => void;
}

export function TreeItem({
  label,
  sublabel,
  icon,
  badge,
  selected,
  onClick,
}: TreeItemProps) {
  return (
    <li
      className={`ony-tree__item${selected ? ' ony-tree__item--selected' : ''}`}
      tabIndex={0}
      role="button"
      data-selected={selected ? 'true' : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
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
