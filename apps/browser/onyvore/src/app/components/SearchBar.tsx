import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useRpc, useRpcResponse } from '../hooks/use-rpc-request.hook';
import {
  onyvoreRpcMethods,
  type NotebookSearchGroup,
  type NotebookSearchHit,
} from '@onivoro/isomorphic-onyvore';
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

/** One result plus the notebook it came from, so selection stays unambiguous. */
interface FlatHit {
  notebookId: string;
  hit: NotebookSearchHit;
}

function flatten(groups: NotebookSearchGroup[]): FlatHit[] {
  return groups.flatMap((group) =>
    group.results.map((hit) => ({ notebookId: group.notebookId, hit })),
  );
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
  const [groups, setGroups] = useState<NotebookSearchGroup[]>([]);
  const [selected, setSelected] = useState(0);
  const [allNotebooks, setAllNotebooks] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const response = useRpcResponse(requestId);

  const notebooks = useSelector((state: RootState) => state.notebooks.notebooks);
  const hits = flatten(groups);

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
    const data = response.result as
      | { results: NotebookSearchHit[] }
      | { groups: NotebookSearchGroup[] };

    if ('groups' in data) {
      setGroups(data.groups ?? []);
    } else {
      setGroups(
        data.results?.length && notebookId
          ? [{ notebookId, notebookName: '', results: data.results }]
          : [],
      );
    }
    setSelected(0);
    setRequestId(null);
  }, [response]);

  const clear = useCallback(() => {
    setQuery('');
    setGroups([]);
    setSelected(0);
  }, []);

  const runSearch = useCallback(
    (searchQuery: string, searchAll: boolean) => {
      setSelected(0);
      if (searchQuery.trim().length === 0 || (!searchAll && !notebookId)) {
        setGroups([]);
        return;
      }
      setRequestId(
        sendRequest(
          searchAll
            ? {
                method: onyvoreRpcMethods.NOTEBOOK_SEARCH_ALL,
                params: { query: searchQuery },
              }
            : {
                method: onyvoreRpcMethods.NOTEBOOK_SEARCH,
                params: { notebookId, query: searchQuery },
              },
        ),
      );
    },
    [notebookId, sendRequest],
  );

  const handleSearch = useCallback(
    (searchQuery: string) => {
      setQuery(searchQuery);
      runSearch(searchQuery, allNotebooks);
    },
    [runSearch, allNotebooks],
  );

  const toggleScope = useCallback(() => {
    const next = !allNotebooks;
    setAllNotebooks(next);
    runSearch(query, next);
  }, [allNotebooks, query, runSearch]);

  const openResult = useCallback(
    (targetNotebookId: string, relativePath: string) => {
      sendRequest({
        method: onyvoreRpcMethods.OPEN_FILE,
        params: { notebookId: targetNotebookId, relativePath },
      });
      clear();
    },
    [sendRequest, clear],
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

    if (hits.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = hits[selected];
      if (target) openResult(target.notebookId, target.hit.relativePath);
    }
  };

  // Index into the flattened list, so keyboard selection spans groups.
  let flatIndex = -1;

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
          disabled={!notebookId && !allNotebooks}
        />
        {notebooks.length > 1 && (
          <button
            type="button"
            className={`ony-searchbar__scope${allNotebooks ? ' ony-searchbar__scope--on' : ''}`}
            title={
              allNotebooks
                ? 'Searching all notebooks — click to search only this one'
                : 'Searching this notebook — click to search all'
            }
            aria-pressed={allNotebooks}
            onClick={toggleScope}
          >
            All
          </button>
        )}
      </div>
      {groups.length > 0 && (
        <div className="ony-searchbar__results" ref={resultsRef}>
          {groups.map((group) => (
            <div key={group.notebookId}>
              {allNotebooks && (
                <div className="ony-searchbar__group-header">
                  {group.notebookName}
                </div>
              )}
              {group.results.map((result) => {
                flatIndex++;
                const index = flatIndex;
                const open = () => openResult(group.notebookId, result.relativePath);
                return (
                  <div
                    key={`${group.notebookId}:${result.relativePath}`}
                    className="ony-searchbar__result-group"
                  >
                    <ul className="ony-tree">
                      <TreeItem
                        label={result.title}
                        sublabel={result.relativePath}
                        icon={<FileIcon />}
                        badge={result.snippets.length}
                        selected={index === selected}
                        onClick={open}
                      />
                    </ul>
                    {result.snippets.map((snippet, i) => (
                      <div key={i} className="ony-searchbar__snippet" onClick={open}>
                        {highlightSnippet(snippet, query)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {query.length > 0 && hits.length === 0 && (
        <div className="ony-searchbar__empty">No results found</div>
      )}
    </>
  );
}
