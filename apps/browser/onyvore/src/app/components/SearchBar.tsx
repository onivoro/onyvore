import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useRpc, useRpcResponse } from '../hooks/use-rpc-request.hook';
import {
  onyvoreRpcMethods,
  parseSearchQuery,
  describeQuery,
  wordPrefixPattern,
  type ParsedQuery,
  type NotebookSearchGroup,
  type NotebookSearchHit,
} from '@onivoro/isomorphic-onyvore';
import { searchResultsActions } from '../state/slices/search-results.slice';
import type { RootState } from '../state/types/root-state.type';
import { SearchIcon, FileIcon, LinkIcon, QuoteIcon } from './Icons';
import { TreeItem } from './TreeItem';
import { SearchHelp } from './SearchHelp';

const DEBOUNCE_MS = 150;

/** Words the query will highlight — the same set the server matched on. */
function highlightTerms(query: ParsedQuery): string[] {
  return [
    ...query.terms,
    ...query.title,
    ...query.path,
    ...query.phrases.flatMap((phrase) => phrase.split(/\s+/).filter(Boolean)),
  ];
}

/**
 * Highlight matches inside a snippet.
 *
 * Uses the shared word-prefix rule rather than a substring scan, so a highlight
 * can never land somewhere the search engine did not match — `run` used to
 * light up the middle of "brunch".
 */
function highlightSnippet(snippet: string, terms: string[]): ReactNode[] {
  const pattern = wordPrefixPattern(terms);
  if (!pattern) return [snippet];

  const parts: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(snippet)) !== null) {
    if (match.index > last) parts.push(snippet.slice(last, match.index));
    parts.push(
      <mark key={match.index} className="ony-searchbar__highlight">
        {match[0]}
      </mark>,
    );
    last = match.index + match[0].length;
    if (match[0].length === 0) pattern.lastIndex++;
  }

  if (last < snippet.length) parts.push(snippet.slice(last));
  return parts;
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

/** A short label saying why a note surfaced, when it was not the body text. */
function matchLabel(hit: NotebookSearchHit): string | null {
  if (hit.approximate) return 'approximate match';
  if (hit.snippets.length > 0) return null;
  if (hit.matchedIn.includes('title')) return 'matched in title';
  if (hit.matchedIn.includes('path')) return 'matched in path';
  return null;
}

interface SearchBarProps {
  notebookId: string | null;
}

export function SearchBar({ notebookId }: SearchBarProps) {
  const { sendRequest } = useRpc();
  const dispatch = useDispatch();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<NotebookSearchGroup[]>([]);
  const [widened, setWidened] = useState(false);
  const [selected, setSelected] = useState(0);
  const [allNotebooks, setAllNotebooks] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const response = useRpcResponse(requestId);

  const notebooks = useSelector((state: RootState) => state.notebooks.notebooks);
  const hits = flatten(groups);

  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const terms = useMemo(() => highlightTerms(parsed), [parsed]);
  const description = useMemo(() => describeQuery(parsed), [parsed]);

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
      | { hits: NotebookSearchHit[]; widened: boolean }
      | { groups: NotebookSearchGroup[]; widened: boolean };

    if ('groups' in data) {
      setGroups(data.groups ?? []);
    } else {
      setGroups(
        data.hits?.length && notebookId
          ? [{ notebookId, notebookName: '', results: data.hits, topScore: 0 }]
          : [],
      );
    }
    setWidened(Boolean(data.widened));
    setSelected(0);
    setRequestId(null);
  }, [response]);

  const clear = useCallback(() => {
    setQuery('');
    setGroups([]);
    setWidened(false);
    setSelected(0);
  }, []);

  const runSearch = useCallback(
    (searchQuery: string, searchAll: boolean) => {
      setSelected(0);
      if (searchQuery.trim().length === 0 || (!searchAll && !notebookId)) {
        setGroups([]);
        setWidened(false);
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

  // Coalesce keystrokes: one search per pause, not one per character.
  const scheduleSearch = useCallback(
    (searchQuery: string, searchAll: boolean) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(
        () => runSearch(searchQuery, searchAll),
        DEBOUNCE_MS,
      );
    },
    [runSearch],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleSearch = useCallback(
    (searchQuery: string) => {
      setQuery(searchQuery);
      scheduleSearch(searchQuery, allNotebooks);
    },
    [scheduleSearch, allNotebooks],
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
        <button
          type="button"
          className={`ony-searchbar__scope${showHelp ? ' ony-searchbar__scope--on' : ''}`}
          title="Search syntax"
          aria-label="Search syntax"
          aria-pressed={showHelp}
          onClick={() => setShowHelp((open) => !open)}
        >
          ?
        </button>
      </div>

      {showHelp && <SearchHelp />}

      {/* Reading the query back is both documentation and confirmation that
          what was typed is what will run. */}
      {description && !showHelp && (
        <div className="ony-searchbar__parsed">{description}</div>
      )}

      {widened && (
        <div className="ony-searchbar__notice">
          No note matched every word — showing notes matching any of them.
        </div>
      )}

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
                const label = matchLabel(result);
                const icon = result.matchedIn.includes('content') ? (
                  <FileIcon />
                ) : result.matchedIn.includes('title') ? (
                  <QuoteIcon />
                ) : (
                  <LinkIcon />
                );

                return (
                  <div
                    key={`${group.notebookId}:${result.relativePath}`}
                    className="ony-searchbar__result-group"
                  >
                    <ul className="ony-tree">
                      <TreeItem
                        label={result.title}
                        sublabel={result.relativePath}
                        icon={icon}
                        badge={
                          result.snippets.length > 0 ? result.snippets.length : undefined
                        }
                        selected={index === selected}
                        onClick={open}
                      />
                    </ul>
                    {label && <div className="ony-searchbar__match-label">{label}</div>}
                    {result.snippets.map((snippet, i) => (
                      <div key={i} className="ony-searchbar__snippet" onClick={open}>
                        {highlightSnippet(snippet, terms)}
                      </div>
                    ))}
                    {result.snippets.length === 0 && result.preview && (
                      <div
                        className="ony-searchbar__snippet ony-searchbar__snippet--preview"
                        onClick={open}
                      >
                        {result.preview}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {query.trim().length > 0 && hits.length === 0 && !requestId && (
        <div className="ony-searchbar__empty">No results found</div>
      )}
    </>
  );
}
