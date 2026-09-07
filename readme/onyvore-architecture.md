# Onyvore Technical Architecture

**Companion to:** `onyvore-prd.md`
**Purpose:** Implementation-level decisions for building Onyvore. The PRD defines *what* and *why*; this document defines *how*.

---

## 1. Project Structure

Onyvore follows the `@onivoro/server-vscode` three-tier architecture. Four Nx projects compose the extension:

| Project | Location | Runtime | Build | Purpose |
|---|---|---|---|---|
| `app-vscode-onyvore` | `apps/vscode/onyvore/` | Extension Host | Webpack | Orchestrator: spawns stdio server, serves webview, registers commands, manages file watchers, tracks active notebook |
| `app-stdio-onyvore` | `apps/stdio/onyvore/` | Node.js (child process) | Webpack | Backend: NLP extraction, Orama indexing, link graph computation, `.onyvore/` persistence, startup reconciliation |
| `app-browser-onyvore` | `apps/browser/onyvore/` | Browser (webview) | Vite | React UI: Notebook Sidebar (single notebook view), Notebook Selector (dropdown with typeahead), omnipresent Search Bar (with snippet previews), Links Panel, Orphan Detection |
| `lib-isomorphic-onyvore` | `libs/isomorphic/onyvore/` | Any | Vite | Shared types, command constants, JSON-RPC method names |

### 1.1 Dependency Graph

```
app-vscode-onyvore
├── dependsOn: app-stdio-onyvore:build
├── dependsOn: app-browser-onyvore:build
└── imports: lib-isomorphic-onyvore

app-stdio-onyvore
└── imports: lib-isomorphic-onyvore

app-browser-onyvore
└── imports: lib-isomorphic-onyvore
```

### 1.2 Directory Layouts

**Extension Host** (`apps/vscode/onyvore/`) — orchestration and everything that touches the `vscode` API.
```
├── package.json                            # VS Code manifest: commands, views, settings
├── resources/icon.svg                      # Activity bar icon (must exist at extension root)
└── src/
    ├── main.ts                             # createExtensionFromModule()
    └── app/
        ├── onyvore-extension.module.ts     # @VscodeExtensionModule + @Module
        ├── classes/
        │   ├── onyvore-webview-provider.class.ts
        │   └── onyvore-secondary-webview-provider.class.ts   # Links and Graph views
        └── services/
            ├── onyvore-command-handler.service.ts
            ├── onyvore-webview-handler.service.ts
            ├── onyvore-server-notification-handler.service.ts
            ├── onyvore-settings.service.ts                   # onyvore.* settings
            ├── notebook-discovery.service.ts
            ├── notebook-files.service.ts                     # cached file lists
            ├── active-notebook.service.ts
            ├── file-watcher.service.ts
            ├── secondary-views.service.ts                    # registers extra webviews
            ├── wikilink-features.service.ts                  # completion, links, hover
            └── wikilink-diagnostics.service.ts               # unresolved links + fixes
```

**Stdio Server** (`apps/stdio/onyvore/`) — all indexing, linking, and search. Every service here has a `.spec.ts` beside it unless noted.
```
└── src/
    ├── main.ts                             # bootstrapStdioApp()
    └── app/
        ├── app-stdio-onyvore.module.ts
        ├── app-stdio-onyvore-config.class.ts    # settings pushed from the host
        └── services/
            ├── onyvore-message-handler.service.ts    # the JSON-RPC surface
            ├── indexing.service.ts                   # the shared two-phase pipeline
            ├── reconciliation.service.ts             # init, reconcile, rename detection
            ├── ignore.service.ts                     # .onyvoreignore (no spec)
            ├── nlp.service.ts                        # compromise wrapper
            ├── term-store.service.ts                 # shared term vectors (no spec)
            ├── search-index.service.ts               # Orama: retrieval
            ├── search.service.ts                     # query semantics
            ├── mention.service.ts                    # title matching
            ├── tfidf.service.ts                      # similarity
            ├── wikilink.service.ts                   # [[links]]
            ├── link-graph.service.ts                 # all three edge types
            ├── metadata.service.ts                   # mtimes + content hashes (no spec)
            └── persistence.service.ts                # versioned artifacts (no spec)
```

**Browser Webview** (`apps/browser/onyvore/`) — one bundle serving three views, selected by an injected `window.__ONYVORE_VIEW__`.
```
└── src/
    ├── main.tsx                            # imports @vscode/codicons CSS + onyvore.css
    └── app/
        ├── app.tsx                         # picks sidebar / links / graph by view flag
        ├── onyvore.css                     # all styles, VS Code theme vars only
        ├── components/
        │   ├── NotebookSidebar.tsx         # file tree for the viewed notebook
        │   ├── NotebookSelector.tsx        # dropdown with typeahead
        │   ├── NotebookTree.tsx
        │   ├── UnlinkedNotes.tsx           # orphans
        │   ├── LinksPanel.tsx              # five link buckets for the active note
        │   ├── LinkList.tsx                # one bucket; serves both directions
        │   ├── GraphPanel.tsx              # canvas force-directed graph
        │   ├── SearchBar.tsx               # search, scope toggle, keyboard nav
        │   ├── SearchHelp.tsx              # the operator reference
        │   ├── CollapsibleSection.tsx
        │   ├── TreeItem.tsx
        │   ├── Icons.tsx
        │   └── ErrorBoundary.tsx
        ├── hooks/use-rpc-request.hook.ts
        └── state/
            ├── store.ts
            ├── middleware/message-bus.middleware.ts
            ├── slices/                     # jsonrpc request/response, notebooks,
            │                               # activeNotebook, links, searchResults
            └── types/root-state.type.ts
```

**Shared Library** (`libs/isomorphic/onyvore/`) — types, constants, and the pure logic both processes must agree on. Each module has a `.spec.ts` beside it.
```
└── src/
    ├── index.ts                            # barrel export
    └── lib/
        ├── constants/                      # commands, RPC methods, stop nouns
        ├── types/                          # notebook, edge, metadata,
        │                                   # links-panel, file-event, graph
        ├── wikilinks/wikilink-parser.ts    # parse + resolve [[links]]
        ├── search/parse-search-query.ts    # query syntax
        ├── search/search-text.ts           # the word-prefix matching rule
        └── rename/detect-renames.ts        # pair a delete with a create
```

**Why logic lives in the shared library.** It started as types and constants only. Three pieces of behavior have since moved in, each because the extension host and the stdio server were about to implement the same rule twice and drift:

| Module | Both sides need it because |
|---|---|
| `wikilink-parser` | The server builds link edges; the host powers ctrl-click, completion, and diagnostics. Separate resolvers would let the editor open a different note than the graph linked. |
| `search-text` | The server finds snippet positions; the webview highlights them. When they disagreed, searching `run` highlighted the middle of "brunch". |
| `parse-search-query` | The server executes a query; the webview explains it back to the user. |
| `detect-renames` | Used only by the server today, but it is pure pairing logic with no I/O, and it belongs with the artifact types it reads. |

The rule: pure functions that define a *shared meaning* belong here. Anything that touches the filesystem, the index, or the `vscode` API does not.

---

## 2. Communication Architecture

Three processes, two transports. The extension host is the only one that talks to both.

```
┌──────────────────────────────────────────────────────────────────┐
│ Extension Host  (apps/vscode/onyvore)                            │
│                                                                  │
│  @CommandHandler       @WebviewHandler        Editor providers    │
│  • initializeNotebook  • openFile             • completion        │
│  • discoverNotebooks   • pickDirectory        • document links    │
│  • searchNotebook      • getActiveNotebook    • hover             │
│  • rebuildNotebook     • setViewedNotebook    • diagnostics       │
│                        • getConfiguration     • quick fixes       │
│                                                                  │
│  @ServerNotificationHandler   NotebookDiscovery   FileWatcher     │
│  • initProgress               NotebookFiles       • per notebook  │
│  • reconcileProgress          ActiveNotebook      • debounced     │
│  • notebookReady              Settings            SecondaryViews  │
│  • indexUpdated                                                  │
└───────────┬──────────────────────────────┬───────────────────────┘
            │ stdio JSON-RPC               │ postMessage
            ▼                              ▼
┌───────────────────────────┐  ┌───────────────────────────────────┐
│ Stdio Server              │  │ React Webview                     │
│ (apps/stdio/onyvore)      │  │ (apps/browser/onyvore)            │
│                           │  │                                   │
│ MessageHandler  ← the API │  │ App — picks view by injected flag │
│ Indexing        ← pipeline│  │                                   │
│ Reconciliation            │  │ sidebar: Selector, SearchBar,     │
│ Nlp · TermStore           │  │          NotebookTree,            │
│ SearchIndex · Search      │  │          UnlinkedNotes            │
│ Mention · Tfidf · Wikilink│  │ links:   LinksPanel → LinkList ×5 │
│ LinkGraph                 │  │ graph:   GraphPanel (canvas)      │
│ Metadata · Persistence    │  │                                   │
│ Ignore                    │  │ Redux + MessageBus middleware     │
└───────────────────────────┘  └───────────────────────────────────┘
```

The framework wires exactly one webview. The Links and Graph views are
registered by `SecondaryViewsService`, which reuses the exported
`defaultWebviewMessageHandler` for requests and forwards the three
notifications those panels need — the framework's broadcast reaches only the
primary provider.

### 2.1 Message Flow

**File change → index update → UI refresh:**
1. `FileWatcherService` (extension host) detects `.md` file event
2. Debounces 300ms, then sends `notebook.fileEvent` request to stdio server
3. Stdio server pairs any rename, registers the whole batch, then derives edges once per file, and persists
4. Stdio server sends `notebook.indexUpdated` notification back to extension
5. Extension broadcasts notification to webview
6. Webview Redux store updates, React components re-render

**User searches:**
1. User types in the omnipresent `SearchBar`; keystrokes are debounced
2. Webview dispatches `notebook.search` (or `notebook.searchAll`) via `useRpc()`
3. `SearchService` parses the query, retrieves through the strictness ladder, applies filters (phrases, exclusions, folder, graph predicates), and ranks with the graph boost
4. Every hit returns with `matchedIn` and either snippets or a lead preview
5. `SearchBar` renders results inline, highlighting with the same word-prefix rule the server matched on

**User clicks link in Links Panel:**
1. Webview dispatches `openFile` to extension via `@WebviewHandler`
2. Extension host calls `vscode.window.showTextDocument()` to open the target note
3. Active notebook may change → `active-notebook.slice` updates → Links Panel re-renders for the new note

---

## 3. Tier Responsibilities

### 3.1 Extension Host (`app-vscode-onyvore`)

The extension host is the orchestrator. It owns VS Code API access and delegates all computation to the stdio server.

**Services:**

| Service | Responsibility |
|---|---|
| `OnyvoreCommandHandlerService` | `@CommandHandler` methods for all command palette commands (PRD Section 6.4) |
| `OnyvoreWebviewHandlerService` | `@WebviewHandler` methods for webview-initiated requests (`openFile`, `pickDirectory`, `getActiveNotebook`, `getConfiguration`) |
| `OnyvoreServerNotificationHandlerService` | `@ServerNotificationHandler` methods for progress updates, index-updated events |
| `NotebookDiscoveryService` | Scans workspace for `.onyvore/` directories. Runs on activation and on `Onyvore: Discover Notebooks`. Registers discovered notebooks with the stdio server |
| `ActiveNotebookService` | Listens to `vscode.window.onDidChangeActiveTextEditor`. Resolves which notebook owns the focused file. Updates the status bar indicator. Notifies the webview of active notebook changes |
| `FileWatcherService` | Creates one `vscode.FileSystemWatcher` per registered notebook. Applies `.onyvoreignore` exclusions. Watches `.onyvoreignore` for changes. Debounces events (300ms). Forwards batched events to the stdio server via JSON-RPC |
| `NotebookFilesService` | Caches each notebook's file list in the host, refreshed on `notebook.ready` / `notebook.indexUpdated`. The editor features need it synchronously and often, so round-tripping to the server per keystroke is not viable |
| `OnyvoreSettingsService` | Reads `onyvore.*` settings, pushes the graph-shaping ones to the server on activation and on change, and exposes the host-only ones |
| `WikilinkFeaturesService` | Registers completion, document-link, and hover providers for `[[wikilinks]]` |
| `WikilinkDiagnosticsService` | Reports unresolved wikilinks and provides the create-note / repoint quick fixes |
| `LinksViewService` | Registers the Links panel as a second webview view and forwards the notifications it needs |

**Key design decision:** The extension host does NOT run compromise, Orama, or any link graph computation. It is a thin layer over VS Code APIs that routes events to the stdio server. This keeps the extension host responsive — NLP and indexing run in the child process without blocking the UI.

### 3.2 Stdio Server (`app-stdio-onyvore`)

The stdio server is where the PRD's functional requirements are implemented. It runs as a NestJS child process spawned by the extension host, communicating via stdio JSON-RPC.

**Services:**

| Service | Responsibility |
|---|---|
| `OnyvoreMessageHandlerService` | `@StdioHandler` methods — the JSON-RPC API surface. Routes requests to domain services |
| `IndexingService` | The shared indexing pipeline, including `renameDocument`, which re-keys a moved note instead of reprocessing it. Two phases: `registerDocument` populates every index, `computeEdges` derives links from the populated corpus. Used by file events, ignore changes, initialization, and reconciliation alike |
| `NlpService` | Wraps compromise. Extracts and lemmatizes noun terms. Runs the extraction pipeline (PRD Section 4.4): parse → decompose → stop nouns → min length |
| `TermStoreService` | Single owner of per-document term vectors, shared by `TfidfService` and `MentionService` so terms are stored once per notebook rather than once per consumer |
| `SearchIndexService` | Wraps Orama. Manages per-notebook indexes and a `relativePath → document id` map so removal is exact. Owns retrieval — the strictness ladder and where each hit matched. Serializes/deserializes `index.bin` |
| `SearchService` | Query semantics: parse, retrieve, filter, rank. Owns the operators, including the graph-reading ones (`links:`, `related:`, `is:orphan`) |
| `MentionService` | Owns the title index (basename + path-qualified variants) and computes `mention` edges by matching extracted phrases against note titles, in both directions |
| `TfidfService` | Owns document-frequency state and computes `similar` edges by cosine similarity, with cached vectors and a per-note cap |
| `WikilinkService` | Parses `[[wikilinks]]`, resolves them Obsidian-compatibly, and caches link text so edges appear when a missing target is later created |
| `LinkGraphService` | Stores all edges with outbound/inbound indexes. Type-aware replacement (symmetric vs. directional), orphan detection that ignores `similar`, and `links.json` serialization |
| `IgnoreService` | Loads and evaluates `.onyvoreignore` for the server, covering filesystem scans as well as live events |
| `MetadataService` | Manages per-notebook `metadata.json`. Tracks last-seen modification times for reconciliation |
| `PersistenceService` | Versioned atomic writes of `index.bin`, `links.json`, `metadata.json`, `tfidf.json`. Reports whether the full artifact set loaded, so callers can rebuild instead of trusting partial state |
| `ReconciliationService` | Full initialization and startup reconciliation. Scans the filesystem, diffs against metadata, drives the two-phase pipeline, sends progress notifications |

**StdioHandler methods (JSON-RPC API):**

| Method | Direction | Purpose |
|---|---|---|
| `notebook.register` | ext → server | Register a discovered notebook (path, initial state) |
| `notebook.unregister` | ext → server | Remove a notebook (e.g., `.onyvore/` deleted) |
| `notebook.fileEvent` | ext → server | Batched file watcher events (create/change/delete array) |
| `notebook.ignoreChanged` | ext → server | `.onyvoreignore` was modified — reload rules and reconcile |
| `notebook.search` | webview → server | Search within one notebook, returning hits plus whether the search widened |
| `notebook.searchAll` | webview → server | Search every notebook, grouped by notebook |
| `notebook.getGraph` | webview → server | Nodes and edges for the graph view |
| `notebook.getLinks` | webview → server | Get all five link buckets for a specific note |
| `notebook.getNotebooks` | webview → server | List all registered notebooks with their file trees |
| `notebook.getOrphans` | webview → server | Get unlinked notes for a notebook |
| `notebook.rebuild` | ext → server | Delete derived artifacts and re-index from scratch |
| `notebook.reconcile` | ext → server | Trigger startup reconciliation for a notebook |
| `notebook.initialize` | ext → server | First-time initialization (full scan) for a new notebook |
| `server.configure` | ext → server | Push user settings; recomputes similarity edges when they change |
| `openFile` | webview → ext | Open a note in the editor (`@WebviewHandler`) |
| `pickDirectory` | webview → ext | Show native directory picker dialog (`@WebviewHandler`) |
| `getActiveNotebook` | webview → ext | Get current active notebook context (`@WebviewHandler`) |
| `setViewedNotebook` | webview → ext | Report which notebook the sidebar is showing, so palette commands target it (`@WebviewHandler`) |
| `getConfiguration` | webview → ext | Read VS Code configuration (`@WebviewHandler`) |
| `getWorkspaceFolders` | webview → ext | List workspace folders (`@WebviewHandler`) |

**Notifications (server → extension → webview):**

| Method | Purpose |
|---|---|
| `notebook.initProgress` | Progress during initial computation (files processed / total) |
| `notebook.reconcileProgress` | Progress during startup reconciliation |
| `notebook.ready` | Notebook initialization or reconciliation complete |
| `notebook.indexUpdated` | Index/links changed — webview should refresh |
| `activeNotebook.changed` | Active notebook changed (editor focus moved to different notebook) |
| `search.show` | Focus the search bar (triggered by command palette) |

### 3.3 Browser Webview (`app-browser-onyvore`)

One React bundle serves all three webview views. The extension host injects
`window.__ONYVORE_VIEW__`, and `App` renders the sidebar, the Links panel, or
the Graph accordingly. All data arrives via JSON-RPC through the Redux message
bus middleware.

**Components:**

| Component | Purpose | Data source |
|---|---|---|
| `App` | Shell. Picks which view to render; owns viewed-notebook state in the sidebar | `notebooks` + `activeNotebook` slices |
| `NotebookSelector` | Dropdown with typeahead for switching notebooks | Props from `App` |
| `SearchBar` | Search, scope toggle, syntax help, keyboard navigation | `notebook.search` / `notebook.searchAll` |
| `SearchHelp` | The operator reference, shown inline under the input | Static |
| `NotebookSidebar` | File tree for the viewed notebook | `notebook.getNotebooks` |
| `NotebookTree` | The tree itself | Props from `NotebookSidebar` |
| `UnlinkedNotes` | Orphans — no authored or mention links | `notebook.getOrphans` |
| `LinksPanel` | Five buckets for the active note | `notebook.getLinks` |
| `LinkList` | One bucket. `notePath` is already the *other* note, so it serves both directions | Props from `LinksPanel` |
| `GraphPanel` | Canvas force-directed link graph | `notebook.getGraph` |
| `CollapsibleSection` | Collapsible with inverted-color header, chevron, badge | Wraps the tree and link sections |
| `TreeItem` | Shared row: label, sublabel, icon, badge, selection state | Every tree-like list |
| `Icons` | Codicon font wrappers | `@vscode/codicons` |
| `ErrorBoundary` | Catches render errors | — |

**Redux slices:**

| Slice | Purpose |
|---|---|
| `notebooks` | Notebook list and file trees; `indexVersion` bumps on `notebook.indexUpdated` to trigger refetches |
| `activeNotebook` | Active notebook id and note path, from `activeNotebook.changed` |
| `links` | Links for the current note |
| `searchResults` | `visible` is set by `search.show` so the palette command focuses the input |
| `jsonrpcRequest` / `jsonrpcResponse` | Entity slices backing `useRpc()` — a request is dispatched, the middleware sends it, the response lands by id |

### 3.4 Shared Library (`lib-isomorphic-onyvore`)

Type-safe contracts shared across all three tiers, plus the pure functions both
processes must agree on (see §1.2 for why each one lives here).

**Constants:**

```typescript
// onyvore-commands.constant.ts
export const onyvoreCommands = {
  INITIALIZE_NOTEBOOK: 'onyvore.initializeNotebook',
  DISCOVER_NOTEBOOKS: 'onyvore.discoverNotebooks',
  SEARCH_NOTEBOOK: 'onyvore.searchNotebook',
  REBUILD_NOTEBOOK: 'onyvore.rebuildNotebook',
} as const;
```

```typescript
// onyvore-rpc-methods.constant.ts
export const onyvoreRpcMethods = {
  // Requests (ext ↔ server)
  NOTEBOOK_REGISTER: 'notebook.register',
  NOTEBOOK_UNREGISTER: 'notebook.unregister',
  NOTEBOOK_FILE_EVENT: 'notebook.fileEvent',
  NOTEBOOK_IGNORE_CHANGED: 'notebook.ignoreChanged',
  NOTEBOOK_SEARCH: 'notebook.search',
  NOTEBOOK_SEARCH_ALL: 'notebook.searchAll',
  NOTEBOOK_GET_LINKS: 'notebook.getLinks',
  NOTEBOOK_GET_GRAPH: 'notebook.getGraph',
  NOTEBOOK_GET_NOTEBOOKS: 'notebook.getNotebooks',
  NOTEBOOK_GET_ORPHANS: 'notebook.getOrphans',
  NOTEBOOK_REBUILD: 'notebook.rebuild',
  NOTEBOOK_RECONCILE: 'notebook.reconcile',
  NOTEBOOK_INITIALIZE: 'notebook.initialize',
  SERVER_CONFIGURE: 'server.configure',
  // Notifications (server → ext → webview)
  NOTEBOOK_INIT_PROGRESS: 'notebook.initProgress',
  NOTEBOOK_RECONCILE_PROGRESS: 'notebook.reconcileProgress',
  NOTEBOOK_READY: 'notebook.ready',
  NOTEBOOK_INDEX_UPDATED: 'notebook.indexUpdated',
  ACTIVE_NOTEBOOK_CHANGED: 'activeNotebook.changed',
  SEARCH_SHOW: 'search.show',
  // Webview → extension host (@WebviewHandler)
  OPEN_FILE: 'openFile',
  PICK_DIRECTORY: 'pickDirectory',
  GET_ACTIVE_NOTEBOOK: 'getActiveNotebook',
  SET_VIEWED_NOTEBOOK: 'setViewedNotebook',
  GET_CONFIGURATION: 'getConfiguration',
  GET_WORKSPACE_FOLDERS: 'getWorkspaceFolders',
} as const;
```

```typescript
// stop-nouns.constant.ts
export const STOP_NOUNS: ReadonlySet<string> = new Set([
  // Ultra-generic nouns
  'time', 'way', 'thing', 'part', 'people', 'day', 'year', 'example',
  'case', 'place', 'point', 'fact', 'hand', 'end', 'line', 'number',
  'group', 'area', 'world', 'work', 'state', 'system', 'program',
  'question', 'problem', 'issue', 'use', 'kind', 'sort', 'type',
  'form', 'set', 'list', 'level', 'side', 'head', 'home', 'office',
  'room', 'result', 'change', 'order', 'idea',
  // Domain-common (PKM noise)
  'note', 'file', 'page', 'document', 'section', 'item', 'entry',
  'record', 'version', 'name', 'title', 'link', 'tag', 'folder', 'draft',
]);
```

**Types:**

```typescript
// notebook.types.ts
export interface NotebookInfo {
  id: string;               // unique ID (absolute path of notebook root)
  rootPath: string;          // absolute path to the directory containing .onyvore/
  name: string;              // directory basename
  fileCount: number;
  status: 'initializing' | 'reconciling' | 'ready';
  progress?: number;         // 0-100 during init/reconcile
}

export interface NotebookFileTree {
  notebookId: string;
  files: NotebookFile[];
}

export interface NotebookFile {
  relativePath: string;      // relative to notebook root
  basename: string;          // filename without .md (= note title)
}
```

```typescript
// edge.types.ts
export type EdgeType = 'explicit' | 'mention' | 'similar';

export interface Edge {
  source: string;            // relative path of source note
  target: string;            // relative path of target note
  type: EdgeType;            // how the edge was derived
  noun: string;              // matched phrase, or top shared term for `similar`
  displayText?: string;      // [[target|display text]], `explicit` only
  count: number;             // occurrences (`mention`) or similarity*100 (`similar`)
}
```

```typescript
// metadata.types.ts
export interface NoteMetadata {
  relativePath: string;
  mtimeMs: number;           // last-seen modification time (ms since epoch)
}

export interface NotebookMetadata {
  files: Record<string, NoteMetadata>;  // keyed by relative path
}
```

```typescript
// links-panel.types.ts
export interface LinkEntry {
  notePath: string;          // relative path of the other note
  noteTitle: string;         // basename (for display)
  type: EdgeType;
  noun: string;              // matched phrase or top shared term
  displayText?: string;
  count: number;
}

export interface LinksForNote {
  notePath: string;
  explicitOutbound: LinkEntry[];  // sorted by title
  explicitInbound: LinkEntry[];   // sorted by title
  mentionOutbound: LinkEntry[];   // ranked by count desc
  mentionInbound: LinkEntry[];    // ranked by count desc
  similar: LinkEntry[];           // ranked by score desc; symmetric, so undirected
}
```

```typescript
// file-event.types.ts
export type FileEventType = 'create' | 'change' | 'delete';

export interface FileEvent {
  type: FileEventType;
  relativePath: string;
  notebookId: string;
}

export interface FileEventBatch {
  notebookId: string;
  events: FileEvent[];
}
```

---

**Shared logic:**

| Export | Contract it defines |
|---|---|
| `parseWikilinks`, `resolveWikilinkTarget`, `wikilinkCompletionFor` | Where `[[foo]]` points. Used by the server's link graph and the host's completion, navigation, hover, and diagnostics |
| `wordPrefixPattern`, `hasWordPrefix`, `hasPhrase`, `matchPositions` | What counts as a text match — word prefix, never mid-word. Used by the server's snippets and the webview's highlighter |
| `parseSearchQuery`, `describeQuery`, `isFilterOnlyQuery` | What a query means. Used by the server to execute and the webview to explain |
| `detectRenames` | When a delete plus a create is one moved note |

---

## 4. Key Implementation Details

### 4.1 Term Extraction (`NlpService`, `TermStoreService`)

`NlpService.extractTerms` turns note content into a `Map<term, count>`:

```typescript
const doc = nlp(content);
const rawPhrases: string[] = doc.nouns().toSingular().out('array');
```

For each phrase: lowercase, trim, strip punctuation, drop anything of length ≤ 1. The full phrase is kept unless it is a stop noun, and multi-word phrases are additionally decomposed into their individual words, each filtered independently against `STOP_NOUNS`. `toSingular()` lemmatizes, so "clusters" and "cluster" are one term.

The resulting map is stored in `TermStoreService`, which owns per-document term vectors for the whole server. Both `TfidfService` and `MentionService` read the same maps — at the 10k-note target, storing them once per notebook rather than once per consumer is the difference between hundreds of megabytes and tens.

### 4.2 Link Graph (`LinkGraphService` and the three edge producers)

Three services each produce one edge type, and `LinkGraphService` stores all of them together.

```typescript
type EdgeType = 'explicit' | 'mention' | 'similar';

interface LinkGraph {
  /** All edges, keyed by "type::source::target" — the type is part of the key
   *  so all three can coexist between the same pair of notes. */
  edges: Map<string, Edge>;
  outboundIndex: Map<string, Set<string>>;
  inboundIndex: Map<string, Set<string>>;
  /** Every known file, so a note with no edges can be reported as an orphan. */
  files: Set<string>;
}
```

**`WikilinkService` → `explicit`.** Parses `[[target]]` and `[[target|display]]` after stripping fenced and inline code, then resolves each target against the notebook's file list: `.md` suffix ignored, `/` means path match, otherwise case-insensitive basename with shortest-path tiebreak. Parsed link text is cached per source file, which is what makes `computeInboundEdges` possible — when a previously missing target is created, the cached text is re-resolved and the edge appears without the source note changing.

**`MentionService` → `mention`.** Maintains a title index mapping each lowercase title variant to the notes carrying it:

```typescript
titleIndexes: Map<notebookId, Map<titleVariant, Set<relativePath>>>
fileTitles:   Map<notebookId, Map<relativePath, string[]>>
```

`overview.md` registers `overview`; `work/overview.md` registers both `overview` and `work overview`. The second map exists so `unregisterFile` can remove exactly the variants a file added, without disturbing another note that shares a basename.

`computeOutboundEdges` walks the source's terms, looks each up in the title index, skips self-matches, and aggregates per target: counts sum, and `noun` records the single strongest phrase. `computeInboundEdges` runs the same match in reverse over cached terms, which is how a newly created note picks up mentions that already existed.

**`TfidfService` → `similar`.** Holds document frequency and derives vectors on demand:

```typescript
interface TfidfCorpus {
  tf: NotebookTerms;   // borrowed from TermStoreService
  df: Map<string, number>;
  docCount: number;
  version: number;     // bumped on every df/docCount mutation
  cache: Map<string, CachedVector>;
  cacheVersion: number;
}
```

`version` is the invalidation mechanism. Every TF-IDF vector depends on corpus-wide document frequency, so any edit invalidates all of them; the cache is rebuilt when `cacheVersion !== version` and reused otherwise. Without it, `computeEdgesForDocument` re-vectorizes the entire notebook on every save.

Terms with `idf === 0` — present in every document — are dropped as non-discriminative, which is why a document whose only terms are universal produces no edges at all.

Both entry points apply `maxSimilarPerNote`. In `computeAllEdges`, candidates are collected per note and a pair survives if *either* endpoint ranks it in its own top matches, so the cap never strips a note's single strongest relationship.

**Type-aware replacement.** `LinkGraphService` exposes three replacement modes because the edge types have different ownership semantics:

| Method | Used for | Removes |
|---|---|---|
| `replaceOutboundEdgesForFile` | `explicit`, `mention` | Only outbound edges of that type — the source owns its links |
| `replaceInboundEdgesForFile` | `explicit`, `mention` on create | Only inbound edges of that type |
| `replaceSymmetricEdgesForFile` | `similar` | Both directions — the file is equally source and target |
| `replaceAllEdgesOfType` | Full rebuilds | Every edge of that type in the notebook |

**Orphan detection** walks `files` and reports any note with no non-`similar` edge in either direction. Excluding `similar` is deliberate: cosine similarity connects nearly every note to something, so counting it would leave "Unlinked Notes" permanently empty.

**Persistence.** `loadEdges` skips any edge whose `type` is not one of the three known values, rather than coercing unknown edges to a default — combined with the format version on `links.json`, a stale artifact rebuilds instead of silently loading as the wrong type.

### 4.3 Editor Features (`WikilinkFeaturesService`, `WikilinkDiagnosticsService`)

Both resolve links through `parseWikilinks` / `resolveWikilinkTarget` in the isomorphic library — the same functions `WikilinkService` uses to build the graph. That sharing is the point: if the two processes resolved separately, ctrl-clicking `[[foo]]` could open a different note than the one the graph drew an edge to.

`parseWikilinks` reports byte offsets alongside each target, which is what makes editor ranges possible. Fenced and inline code are blanked with equal-length whitespace rather than removed, so every subsequent offset stays valid.

Completion detects an open `[[` by scanning back along the cursor's line for an unclosed pair, and inserts `wikilinkCompletionFor(file, allFiles)` — the bare basename, or the path-qualified form when the basename is ambiguous. That helper and the resolver are tested together for round-tripping, so a suggestion always resolves back to the note that produced it.

Diagnostics refresh on document open, change, and configuration change, and also on `notebook.indexUpdated` — a note created elsewhere can resolve links that were broken a moment ago.

### 4.4 Search (`SearchService`, `SearchIndexService`)

Retrieval and meaning are separated: `SearchIndexService` owns the Orama index and answers "which documents match these words"; `SearchService` owns what a query *means*, so the operators reading the link graph sit beside the ones reading text.

**Indexed fields** are `title` (×4), `pathText` (×2), and `content` (×1). `relativePath` is deliberately outside the schema — Orama preserves non-schema fields on the stored document, so the path still returns with every hit without every note sharing the token `md`, which used to make searching "md" match the whole notebook.

**The retrieval ladder** widens recall only as far as it must, each rung running only if the one above found nothing:

```typescript
1. run({ threshold: 0 })   // every term, exact — typing more narrows
2. run({})                 // any term, exact — reported as `widened`
3. run({ tolerance: 1 })   // typo tolerance, terms >= 4 chars only
```

Applying tolerance on every pass is what made `md` match "my" and defeated the all-terms threshold: a fuzzy match always qualified, so nothing ever narrowed.

**Matching is by word prefix**, defined once in `lib-isomorphic-onyvore` and shared with the webview's highlighter. When the two disagreed, searching `run` highlighted the middle of "brunch" — a match the engine never made.

**Every hit is kept.** Whether a result is useful and what to display for it are different questions; conflating them discarded a note matched by its own filename for having no content snippet. Each hit reports `matchedIn` so the UI can explain why it surfaced, and falls back to a lead preview when there is no snippet.

**Filter-only queries** (`is:orphan`, `links:x`, `in:folder/`) have nothing to rank, so they bypass the index, enumerate the notebook, and order by path.

**Cross-notebook groups** are ordered by where the best hit matched rather than by score. BM25 depends on each index's own corpus statistics, so raw scores are not comparable between notebooks and ordering by them made group order an artifact of notebook size.

**The index itself:**

```typescript
const SCHEMA = {
  title: 'string',      // path-qualified: "work overview" for work/overview.md
  pathText: 'string',   // directory segments + basename, extension stripped
  content: 'string',
} as const;

const FIELD_BOOST = { title: 4, pathText: 2, content: 1 };
```

`relativePath` is absent on purpose. Orama preserves non-schema fields on the
stored document, so the path returns with every hit without becoming a
searchable token — when it was indexed, every note contained `md` and searching
that matched the whole notebook.

**Snippets** are ~120-character windows around each match, merged when they
overlap, with positions from the shared word-prefix rule.

**The response** carries more than text now, because a hit needs to explain
itself:

```typescript
interface NotebookSearchHit {
  relativePath: string;
  title: string;
  score: number;
  snippets: string[];              // empty for a title-only match
  matchedIn: SearchMatchField[];   // 'content' | 'title' | 'path'
  preview?: string;                // lead excerpt when there are no snippets
  approximate?: boolean;           // reached through typo tolerance
}
```

### 4.5 Persistence (`PersistenceService`)

**Two version constants, deliberately independent.** `ARTIFACT_VERSION` (currently 2) covers the JSON artifacts written by `PersistenceService`; `INDEX_FORMAT_VERSION` (currently 3) covers the serialized Orama envelope, which changed when `relativePath` left the schema. They move separately so a change to one does not force a rebuild driven by the other — though in practice `loadAll` requires all four artifacts to load, so any single mismatch rebuilds the notebook anyway.



**Triggers:**
- After each debounced batch of incremental updates completes
- On extension deactivation
- Periodically during initial computation (every 100 files)

**Files written atomically** (write to temp file, then rename) to prevent corruption from mid-write crashes:

```typescript
async function persistArtifact(filePath: string, data: Buffer | string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, filePath);
}
```

**`links.json` format:**
```json
{
  "version": 2,
  "edges": [
    { "source": "recipes/sourdough.md", "target": "flour.md", "type": "mention", "noun": "flour", "count": 3 },
    { "source": "recipes/sourdough.md", "target": "starter.md", "type": "explicit", "noun": "starter", "count": 100 },
    { "source": "recipes/sourdough.md", "target": "bread.md", "type": "similar", "noun": "dough", "count": 42 },
    { "source": "bread.md", "target": "recipes/sourdough.md", "type": "similar", "noun": "dough", "count": 42 }
  ]
}
```

**`metadata.json` format:**
```json
{
  "version": 2,
  "files": {
    "recipes/sourdough.md": {
      "relativePath": "recipes/sourdough.md",
      "mtimeMs": 1711584000000,
      "hash": "9c1185a5c5e9fc54612808977ee8f548b2258d31"
    },
    "flour.md": {
      "relativePath": "flour.md",
      "mtimeMs": 1711580400000,
      "hash": "3f786850e387550fdab836ed7e6dc881de23001b"
    }
  }
}
```

`hash` is what makes rename detection possible; it is optional, so notebooks indexed before it existed still load and simply never pair.

### 4.6 File Watcher (`FileWatcherService`)

Runs in the extension host. One `vscode.FileSystemWatcher` per registered notebook.

```typescript
// Glob pattern per notebook: watch .md files recursively
const pattern = new vscode.RelativePattern(notebookRoot, '**/*.md');
const watcher = vscode.workspace.createFileSystemWatcher(pattern);
```

**Exclusions applied in the event handler** (not the glob — VS Code's glob doesn't support negation patterns from `.onyvoreignore`):
1. Check if the file path is inside a nested notebook (subdirectory with `.onyvore/`)
2. Check if the file path matches any `.onyvoreignore` pattern
3. If either, discard the event

**Debounce implementation:**
```typescript
// Per-notebook event buffer
const pending = new Map<string, FileEvent>();  // path → latest event
let timer: NodeJS.Timeout | null = null;

function onFileEvent(event: FileEvent) {
  if (isExcluded(event.relativePath)) return;

  // For the same file, a later event supersedes an earlier one
  // Exception: delete followed by create = both kept (rename)
  pending.set(event.relativePath, event);

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const batch: FileEvent[] = Array.from(pending.values());
    pending.clear();
    messageBus.sendRequest('notebook.fileEvent', { notebookId, events: batch });
  }, 300);
}
```

**`.onyvoreignore` watching:**
The extension host watches `{notebookRoot}/.onyvoreignore` with a separate `FileSystemWatcher`. On change it refreshes its local copy — so live events stop flowing for newly-ignored paths — and sends `notebook.ignoreChanged` carrying only the notebook id.

The server owns the authoritative filter (`IgnoreService`) and responds by reloading the rules and re-running reconciliation. It does not need a path diff from the host: newly-ignored files simply stop appearing in the filesystem scan and are treated as deletions, while newly-admitted files look newly created. The host's copy is an optimization; the server's is correctness.

### 4.7 Startup Reconciliation (`ReconciliationService`)

Runs in the stdio server when `notebook.reconcile` is received.

Before diffing, the handler verifies the persisted artifact set. `PersistenceService.loadAll` returns false if any of the four files is missing, unreadable, or from a different format version — because they are written independently, a crash can leave `metadata.json` claiming files that `index.bin` does not contain. In that case the notebook is cleared and fully rebuilt rather than reconciled against state that is already inconsistent.

```typescript
async function reconcile(notebookId: string): Promise<void> {
  await this.ignoreService.load(notebookId);   // scans honor .onyvoreignore
  const metadata = await this.metadataService.load(notebookId);
  const currentFiles = await this.scanFilesystem(notebookId);  // all .md files

  const knownPaths = new Set(Object.keys(metadata.files));
  const currentPaths = new Set(currentFiles.map(f => f.relativePath));

  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const file of currentFiles) {
    if (!knownPaths.has(file.relativePath)) {
      created.push(file.relativePath);
    } else if (file.mtimeMs > metadata.files[file.relativePath].mtimeMs) {
      modified.push(file.relativePath);
    }
  }

  for (const knownPath of knownPaths) {
    if (!currentPaths.has(knownPath)) {
      deleted.push(knownPath);
    }
  }

  const total = created.length + modified.length + deleted.length;
  let processed = 0;

  // Process deletes first (clean up stale data)
  for (const path of deleted) {
    await this.processDelete(notebookId, path);
    this.sendProgress(notebookId, ++processed, total);
  }

  // Register every changed document before deriving links from any of them:
  // TF-IDF needs corpus-wide document frequency and mention matching needs
  // every title present, so a one-pass loop would compute wrong edges.
  for (const path of [...created, ...modified]) {
    const content = await this.readFile(notebookId, path);
    contentCache.set(path, content);
    await this.indexingService.registerDocument(notebookId, path, content, mtime);
  }

  for (const path of [...created, ...modified]) {
    this.indexingService.computeEdges(notebookId, path, contentCache.get(path), {
      // A new note may already be mentioned, or be the target of a wikilink
      // that could not resolve until now.
      refreshInbound: created.includes(path),
    });
    this.sendProgress(notebookId, ++processed, total);
  }

  await this.persistenceService.persistAll(notebookId);
  this.messageBus.sendNotification('notebook.ready', { notebookId });
}
```

---

## 5. VS Code Extension Manifest

The full manifest is `apps/vscode/onyvore/package.json`. What matters
architecturally:

| Contribution | Content |
|---|---|
| `commands` | The four in `onyvoreCommands`. The strings must match that constant and the `@CommandHandler` arguments. |
| `viewsContainers.activitybar` | One container, `onyvore`. |
| `views.onyvore` | Three webviews: `onyvore.webview` (sidebar), `onyvore.links`, `onyvore.graph`. |
| `viewsWelcome` | The empty state for `onyvore.webview`, with a button running `onyvore.initializeNotebook`. |
| `configuration` | The five `onyvore.*` settings (PRD §5.3). |
| `activationEvents` | `onStartupFinished` — notebooks must be discovered without the user acting first. |

**Three webview views, one bundle.** The extension framework wires a single webview provider, so `SecondaryViewsService` registers the Links and Graph views itself: requests reuse the exported `defaultWebviewMessageHandler`, and the three notifications the panel needs are forwarded explicitly because the framework's broadcast only reaches the primary provider. Each provider injects `window.__ONYVORE_VIEW__`, which is how one React build serves all three views.

**Alignment checklist:**
- `contributes.commands[*].command` ↔ `onyvoreCommands` constants ↔ `@CommandHandler()` decorators
- `contributes.views.onyvore[0].id` ↔ `OnyvoreWebviewProvider.viewType` ↔ `@VscodeExtensionModule.webviewViewType`
- `main` → webpack output entry point

---

## 6. Nx Configuration

Project configuration lives in each `project.json`; this section records only the
decisions that are not obvious from reading them.

### 6.1 Path mapping

`tsconfig.base.json` maps `@onivoro/isomorphic-onyvore` to
`libs/isomorphic/onyvore/src/index.ts`. All three tiers import through that
alias — never by relative path across a project boundary.

### 6.2 Build decisions

| Decision | Why |
|---|---|
| `app-vscode-onyvore:build` `dependsOn` the stdio and browser builds | The extension bundles both as assets, so building the host alone would ship stale ones. `npx nx build app-vscode-onyvore` is the only build command anyone needs. |
| Stdio server and extension host use Webpack; webview and library use Vite | The two Node targets need `vscode` marked external and CommonJS output; the browser targets want ES modules and asset inlining. |
| The stdio server is bundled to a single `main.js` | It is spawned as a child process from inside a VSIX, where `node_modules` is not present. Everything it needs must be in the bundle. |
| `generatePackageJson: false` on the host | The extension manifest is hand-written and copied as an asset; a generated one would lose `contributes`. |
| The `package` target rewrites `main` in the copied manifest | Source says `./dist/main.js` for local development; inside the VSIX the file sits at the root, so it becomes `./main.js`. |

### 6.3 Test targets

`app-stdio-onyvore` and `lib-isomorphic-onyvore` have Jest targets; run both with
`npx nx run-many -t test`. The extension host and webview have none — see the
roadmap in PRD §9.1.

---

## 7. Dependencies

Versions live in the root `package.json`. What matters here is the shape of the
dependency set, and what is deliberately absent from it.

| Layer | Packages | Note |
|---|---|---|
| Framework | `@onivoro/server-vscode`, `@onivoro/server-stdio`, `@onivoro/isomorphic-jsonrpc`, `@onivoro/browser-jsonrpc`, `@onivoro/browser-redux` | The three-tier architecture and its JSON-RPC transport |
| Domain | `compromise`, `@orama/orama`, `ignore` | NLP extraction and lemmatization; the search index; `.onyvoreignore` with gitignore semantics |
| UI | `react`, `react-dom`, `@reduxjs/toolkit`, `react-redux`, `@vscode/codicons`, `uuid` | No component library |
| DI and build | `@nestjs/*`, `reflect-metadata`, Webpack (Node targets), Vite (browser targets), `@vscode/vsce` | |

**Written rather than imported:** TF-IDF similarity, the force-directed graph
layout, and the search query parser. Each is small enough that a dependency
would cost more than it saves, and the graph renderer additionally runs under a
webview CSP that blocks external scripts. The zero-binary constraint (PRD §3)
rules out native modules regardless — no SQLite, no compiled search engine.

### 7.1 Styling and the webview CSP

All styles are in `onyvore.css`, driven entirely by VS Code theme variables, so
the UI follows the user's theme without a palette of its own. Derived colors
(borders, hover, scrollbars) use `color-mix(in srgb, ...)`; section headers
invert the foreground and background roles.

Two related workarounds make the icon font load inside a webview:

* Vite's `assetsInlineLimit: 200000` inlines the codicon `.ttf` as a base64
  data URI, sidestepping webview path resolution for font URLs.
* The webview providers add `data:` to the CSP `font-src` directive
  (`html.replace('font-src ', 'font-src data: ')`) so that inlined font is
  allowed to load.

### 7.2 Root scripts

```bash
npm run onyvore:vsix      # nx run app-vscode-onyvore:package
npm run onyvore:install   # code --install-extension .../onyvore.vsix
```

`package` chains the three builds, rewrites `main` in the copied manifest for
the flat VSIX layout, and runs `vsce package`. Output:
`apps/vscode/onyvore/onyvore.vsix`.
