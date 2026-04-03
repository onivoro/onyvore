import { useState, useRef, useEffect } from 'react';
import { ChevronDownIcon } from './Icons';

interface NotebookOption {
  id: string;
  name: string;
}

interface NotebookSelectorProps {
  notebooks: NotebookOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function NotebookSelector({
  notebooks,
  selectedId,
  onSelect,
}: NotebookSelectorProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = notebooks.find((n) => n.id === selectedId);

  const filtered = filter
    ? notebooks.filter((n) =>
        n.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : notebooks;

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setFilter('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleSelect = (id: string) => {
    onSelect(id);
    setOpen(false);
    setFilter('');
  };

  if (notebooks.length === 0) return null;

  return (
    <div className="ony-selector" ref={containerRef}>
      <button
        className="ony-selector__trigger"
        onClick={() => setOpen(!open)}
        title="Switch notebook"
      >
        <span className="ony-selector__label">
          {selected?.name ?? 'Select notebook'}
        </span>
        <span className={`ony-selector__arrow${open ? ' ony-selector__arrow--open' : ''}`}>
          <ChevronDownIcon />
        </span>
      </button>

      {open && (
        <div className="ony-selector__dropdown">
          {notebooks.length > 3 && (
            <div className="ony-selector__filter">
              <input
                ref={inputRef}
                className="ony-selector__input"
                type="text"
                placeholder="Filter notebooks..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setOpen(false);
                    setFilter('');
                  }
                  if (e.key === 'Enter' && filtered.length === 1) {
                    handleSelect(filtered[0].id);
                  }
                }}
              />
            </div>
          )}
          <ul className="ony-selector__list">
            {filtered.map((n) => (
              <li
                key={n.id}
                className={`ony-selector__option${n.id === selectedId ? ' ony-selector__option--active' : ''}`}
                onClick={() => handleSelect(n.id)}
              >
                {n.name}
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="ony-selector__empty">No matches</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
