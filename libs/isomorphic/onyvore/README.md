# lib-isomorphic-onyvore

Shared by all three Onyvore tiers: the extension host, the stdio server, and the browser webview.

This started as types and constants only. It now also holds a small amount of **pure logic** — the rules that more than one process has to agree on. Nothing here touches the filesystem, the search index, or the `vscode` API.

## Import path

```typescript
import { onyvoreRpcMethods, parseSearchQuery, resolveWikilinkTarget } from '@onivoro/isomorphic-onyvore';
import type { Edge, NotebookSearchHit, LinksForNote } from '@onivoro/isomorphic-onyvore';
```

The mapping is defined in `tsconfig.base.json` and resolves to `src/index.ts`.

## Why logic lives here

Each of these moved in because two tiers were about to implement the same rule separately and drift apart.

| Module | Exports | Why it is shared |
|---|---|---|
| `wikilinks/wikilink-parser` | `parseWikilinks`, `resolveWikilinkTarget`, `wikilinkCompletionFor`, `noteBasename` | The server builds link edges from `[[foo]]`; the host powers ctrl-click, completion, hover, and diagnostics from the same syntax. Two resolvers would let the editor open a different note than the graph linked to. |
| `search/search-text` | `wordPrefixPattern`, `hasWordPrefix`, `hasAnyWordPrefix`, `hasPhrase`, `matchPositions`, `tokenize` | The server locates snippet matches; the webview highlights them. When they disagreed, searching `run` highlighted the middle of "brunch" — a match the engine never made. |
| `search/parse-search-query` | `parseSearchQuery`, `describeQuery`, `isEmptyQuery`, `isFilterOnlyQuery` | The server executes a query; the webview reads it back to the user as confirmation. |
| `rename/detect-renames` | `detectRenames` | Pure pairing logic over content hashes, used by both the live file-event path and startup reconciliation. |

`parseWikilinks` reports byte offsets alongside each link, which is what lets the editor build ranges. Code spans are blanked with equal-length whitespace rather than removed, so every offset stays valid.

## Constants

| Export | Purpose |
|---|---|
| `onyvoreCommands` | Command palette IDs. Must match `contributes.commands` in the extension manifest and the `@CommandHandler()` arguments. |
| `onyvoreRpcMethods` | JSON-RPC method names for server requests, server notifications, and webview→host calls. Used by `@StdioHandler`, `@WebviewHandler`, `messageBus.sendRequest()`, and the Redux middleware. |
| `STOP_NOUNS` | 58 ultra-generic and PKM-common English nouns dropped during NLP extraction, so notes do not all link through words like "time" or "file". Not user-configurable. |

## Types

| File | Exports | Notes |
|---|---|---|
| `edge.types` | `Edge`, `EdgeType` | `EdgeType` is `'explicit' \| 'mention' \| 'similar'`. `count` means occurrences for `mention` and `similarity × 100` for `similar` — the same field, deliberately different units per type. |
| `links-panel.types` | `LinkEntry`, `LinksForNote` | Five buckets: explicit in/out, mention in/out, and `similar`, which is undirected because those edges are symmetric. |
| `notebook.types` | `NotebookInfo`, `NotebookFile`, `NotebookFileTree`, `NotebookSearchHit`, `NotebookSearchResults`, `NotebookSearchGroup`, `SearchMatchField` | A search hit reports `matchedIn` so the UI can say *why* a note surfaced, and carries a `preview` for hits matched by name rather than body text. |
| `graph.types` | `GraphNode`, `GraphEdge`, `NotebookGraph` | Node `degree` counts non-`similar` edges only. `truncated` reports how many notes were dropped when a large notebook exceeded the render cap. |
| `metadata.types` | `NoteMetadata`, `NotebookMetadata` | `hash` is optional: notebooks indexed before rename detection existed simply never pair. |
| `file-event.types` | `FileEventType`, `FileEvent`, `FileEventBatch` | Watcher payloads sent host → server. |

## Alignment invariants

A change here reaches all three tiers.

- **Adding an RPC method** — add to `onyvoreRpcMethods`, implement the `@StdioHandler` (or `@WebviewHandler`), and add the caller.
- **Adding a command** — add to `onyvoreCommands`, add the `@CommandHandler`, and add the `contributes.commands` entry in `apps/vscode/onyvore/package.json`.
- **Changing a persisted type** — `Edge`, `NoteMetadata`, and the search index shape are all written to `.onyvore/`. Bump `ARTIFACT_VERSION` in `PersistenceService` (or `INDEX_FORMAT_VERSION` in `SearchIndexService`) so existing notebooks rebuild instead of loading a shape this build cannot read.

## Tests

`npx nx test lib-isomorphic-onyvore`. Every module here has a spec beside it; the pure functions are the cheapest place in the codebase to test behavior, and both tiers depend on them being right.
