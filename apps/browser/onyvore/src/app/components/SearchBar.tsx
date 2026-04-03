import { useState, useCallback, useRef, type ReactNode } from 'react';
import { useRpc, useRpcResponse } from '../hooks/use-rpc-request.hook';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';
import { SearchIcon, FileIcon } from './Icons';
import { TreeItem } from './TreeItem';

function highlightSnippet(snippet: string, query: string): ReactNode[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [snippet];
  const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = snippet.split(pattern);
  return parts.map((part, i) =>
    terms.some(t => part.toLowerCase() === t)
      ? <mark key={i} className="ony-searchbar__highlight">{part}</mark>
      : part
  );
}

interface SearchResult {
  relativePath: string;
  title: string;
  score: number;
  snippets: string[];
}

interface SearchBarProps {
  notebookId: string | null;
}

export function SearchBar({ notebookId }: SearchBarProps) {
  const { sendRequest } = useRpc();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const response = useRpcResponse(requestId);

  if (response?.result && requestId) {
    const data = response.result as { results: SearchResult[] };
    setResults(data.results);
    setRequestId(null);
  }

  const handleSearch = useCallback(
    (searchQuery: string) => {
      setQuery(searchQuery);
      if (!notebookId || searchQuery.trim().length === 0) {
        setResults([]);
        return;
      }
      const id = sendRequest({
        method: onyvoreRpcMethods.NOTEBOOK_SEARCH,
        params: { notebookId, query: searchQuery },
      });
      setRequestId(id);
    },
    [notebookId, sendRequest],
  );

  const handleResultClick = (relativePath: string) => {
    sendRequest({
      method: onyvoreRpcMethods.OPEN_FILE,
      params: { notebookId, relativePath },
    });
    setQuery('');
    setResults([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setQuery('');
      setResults([]);
      inputRef.current?.blur();
    }
  };

  return (
    <>
      <div className="ony-searchbar">
        <span className="ony-searchbar__icon">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          className="ony-searchbar__input"
          type="text"
          placeholder={notebookId ? 'Search notes...' : 'No notebook selected'}
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!notebookId}
        />
      </div>
      {results.length > 0 && (
        <div className="ony-searchbar__results">
          {results.map((result) => (
            <div key={result.relativePath} className="ony-searchbar__result-group">
              <ul className="ony-tree">
                <TreeItem
                  label={result.title}
                  sublabel={result.relativePath}
                  icon={<FileIcon />}
                  badge={result.snippets.length}
                  onClick={() => handleResultClick(result.relativePath)}
                />
              </ul>
              {result.snippets.map((snippet, i) => (
                <div
                  key={i}
                  className="ony-searchbar__snippet"
                  onClick={() => handleResultClick(result.relativePath)}
                >
                  {highlightSnippet(snippet, query)}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {query.length > 0 && results.length === 0 && (
        <div className="ony-searchbar__empty">No results found</div>
      )}
    </>
  );
}
