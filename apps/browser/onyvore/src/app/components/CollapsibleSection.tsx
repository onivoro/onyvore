import { useState, type ReactNode } from 'react';
import { ChevronIcon } from './Icons';

interface CollapsibleSectionProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  actions,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`ony-section${open ? '' : ' ony-section--collapsed'}`}>
      <div
        className="ony-section__header"
        tabIndex={0}
        role="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(!open);
          }
        }}
      >
        <span className="ony-section__chevron">
          <ChevronIcon />
        </span>
        <span className="ony-section__title">{title}</span>
        {count !== undefined && (
          <span className="ony-section__badge">{count}</span>
        )}
        {actions && (
          <span
            className="ony-section__actions"
            onClick={(e) => e.stopPropagation()}
          >
            {actions}
          </span>
        )}
      </div>
      <div className="ony-section__body">{children}</div>
    </div>
  );
}
