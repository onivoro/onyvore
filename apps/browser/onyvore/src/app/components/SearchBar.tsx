import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useRpc, useRpcResponse } from '../hooks/use-rpc-request.hook';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';
import { searchResultsActions } from '../state/slices/search-results.slice';
import type { RootState } from '../state/types/root-state.type';
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
  const dispatch = useDispatch();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [requestId, setRequestId] = useState<string | null>(null);
  const response = useRpcResponse(requestId);

  // `Onyvore: Search Notebook` sets this so the command actually focuses the box.
  const showRequested = useSelector(
    (state: RootState) => state.searchResults.visible,
  );

  useEffect(() => {
    if (!showRequested) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    dispatch(searchResultsActions.hide());
  }, [showRequested, dispatch]);

  useEffect(() => {
    if (!response?.result) return;
    const data = response.result as { results: SearchResult[] };
    setResults(data.results ?? []);
    setSelected(0);
    setRequestId(null);
  }, [response]);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
    setSelected(0);
  }, []);

  const handleSearch = useCallback(
    (searchQuery: string) => {
      setQuery(searchQuery);
      setSelected(0);
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

  const openResult = useCallback(
    (relativePath: string) => {
      sendRequest({
        method: onyvoreRpcMethods.OPEN_FILE,
        params: { notebookId, relativePath },
      });
      clear();
    },
    [notebookId, sendRequest, clear],
  );

  // Keep the highlighted result in view while arrowing through a long list.
  useEffect(() => {
    resultsRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      clear();
      inputRef.current?.blur();
      return;
    }

    if (results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const result = results[selected];
      if (result) openResult(result.relativePath);
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
        <div className="ony-searchbar__results" ref={resultsRef}>
          {results.map((result, index) => (
            <div key={result.relativePath} className="ony-searchbar__result-group">
              <ul className="ony-tree">
                <TreeItem
                  label={result.title}
                  sublabel={result.relativePath}
                  icon={<FileIcon />}
                  badge={result.snippets.length}
                  selected={index === selected}
                  onClick={() => openResult(result.relativePath)}
                />
              </ul>
              {result.snippets.map((snippet, i) => (
                <div
                  key={i}
                  className="ony-searchbar__snippet"
                  onClick={() => openResult(result.relativePath)}
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
