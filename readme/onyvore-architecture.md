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

**Extension Host** (`apps/vscode/onyvore/`)
```
├── project.json
├── package.json                          # VS Code extension manifest
├── .vscodeignore
├── resources/
│   └── icon.svg                          # Activity bar icon (must exist at extension root for dev mode)
├── webpack.config.js
├── tsconfig.json                         # extends tsconfig.server.json
├── tsconfig.app.json                     # types: ["node", "vscode"]
├── tsconfig.spec.json
└── src/
    ├── main.ts                           # createExtensionFromModule()
    ├── assets/
    │   └── icon.svg
    └── app/
        ├── onyvore-extension.module.ts   # @VscodeExtensionModule + @Module
        ├── classes/
        │   └── onyvore-webview-provider.class.ts
        └── services/
            ├── onyvore-command-handler.service.ts
            ├── onyvore-webview-handler.service.ts
            ├── onyvore-server-notification-handler.service.ts
            ├── notebook-discovery.service.ts
            ├── active-notebook.service.ts
            └── file-watcher.service.ts
```

**Stdio Server** (`apps/stdio/onyvore/`)
```
├── project.json
├── webpack.config.js
├── tsconfig.json                         # extends tsconfig.server.json
├── tsconfig.app.json
├── tsconfig.spec.json
└── src/
    ├── main.ts                           # bootstrapStdioApp()
    └── app/
        ├── app-stdio-onyvore.module.ts
        ├── app-stdio-onyvore-config.class.ts
        └── services/
            ├── onyvore-message-handler.service.ts
            ├── nlp.service.ts
            ├── search-index.service.ts
            ├── link-graph.service.ts
            ├── metadata.service.ts
            ├── persistence.service.ts
            └── reconciliation.service.ts
```

**Browser Webview** (`apps/browser/onyvore/`)
```
├── project.json
├── index.html
├── vite.config.ts
├── tsconfig.json                         # extends tsconfig.web.json
├── tsconfig.app.json
└── src/
    ├── main.tsx                           # imports @vscode/codicons CSS + onyvore.css
    └── app/
        ├── app.tsx                        # Shell: toolbar, NotebookSelector, SearchBar, NotebookSidebar, LinksPanel
        ├── onyvore.css                    # All styles — VS Code theme vars only (--vscode-editor-foreground/background)
        ├── components/
        │   ├── NotebookSidebar.tsx        # Fetches notebooks, renders single viewed notebook
        │   ├── NotebookSelector.tsx       # Dropdown with typeahead for switching notebooks
        │   ├── NotebookTree.tsx           # File tree for a single notebook (uses TreeItem)
        │   ├── UnlinkedNotes.tsx          # Orphan detection (uses TreeItem)
        │   ├── LinksPanel.tsx             # Outbound + Inbound links for active note
        │   ├── OutboundLinks.tsx          # Outbound link list (uses TreeItem)
        │   ├── InboundLinks.tsx           # Inbound link list (uses TreeItem)
        │   ├── SearchBar.tsx              # Omnipresent search with snippet previews (uses TreeItem)
        │   ├── CollapsibleSection.tsx     # Reusable collapsible section with inverted-color header
        │   ├── TreeItem.tsx               # Shared tree item: label, sublabel, icon, badge, responsive
        │   ├── Icons.tsx                  # VS Code codicon wrappers (SearchIcon, FileIcon, etc.)
        │   └── ErrorBoundary.tsx          # React error boundary
        ├── hooks/
        │   └── use-rpc-request.hook.ts
        └── state/
            ├── store.ts
            ├── middleware/
            │   └── message-bus.middleware.ts
            ├── slices/
            │   ├── jsonrpc-request-entity.slice.ts
            │   ├── jsonrpc-response-entity.slice.ts
            │   ├── notebooks.slice.ts
            │   ├── active-notebook.slice.ts
            │   ├── links.slice.ts
            │   └── search-results.slice.ts
            └── types/
                └── root-state.type.ts
```

**Shared Library** (`libs/isomorphic/onyvore/`)
```
├── project.json
├── tsconfig.json                         # extends tsconfig.isomorphic.json
├── tsconfig.lib.json
├── tsconfig.spec.json
└── src/
    ├── index.ts                          # barrel export
    └── lib/
        ├── constants/
        │   ├── onyvore-commands.constant.ts
        │   ├── onyvore-rpc-methods.constant.ts
        │   └── stop-nouns.constant.ts
        └── types/
            ├── notebook.types.ts
            ├── edge.types.ts
            ├── metadata.types.ts
            ├── links-panel.types.ts
            └── file-event.types.ts
```

---

## 2. Communication Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  VS Code Extension Host (apps/vscode/onyvore)                    │
│                                                                  │
│  ┌────────────────────┐  ┌────────────────────────────────────┐  │
│  │ CommandHandlers     │  │ WebviewHandlers                    │  │
│  │ • initializeNotebook│  │ • getNotebooks                    │  │
│  │ • discoverNotebooks │  │ • getLinksForNote                 │  │
│  │ • searchNotebook    │  │ • getSearchResults                │  │
│  │ • rebuildNotebook   │  │ • openFile (→ vscode.open)        │  │
│  └────────────────────┘  │ • getActiveNotebook                │  │
│                          │ • pickDirectory (→ vscode.showOpen) │  │
│  ┌────────────────────┐  └────────────────────────────────────┘  │
│  │ ServerNotification  │                                         │
│  │ Handlers            │  ┌────────────────────────────────────┐  │
│  │ • initProgress      │  │ FileWatcherService                 │  │
│  │ • reconcileProgress │  │ • FileSystemWatcher per notebook   │  │
│  │ • notebookReady     │  │ • 300ms debounce                  │  │
│  │ • indexUpdated       │  │ • forwards events to stdio server │  │
│  └────────────────────┘  └────────────────────────────────────┘  │
│           ▲                          ▲                            │
└───────────┼──────────────────────────┼────────────────────────────┘
            │ stdio JSON-RPC           │ postMessage
            ▼                          ▼
┌──────────────────────────┐  ┌─────────────────────────────────────┐
│ Stdio Server             │  │ React Webview                       │
│ (apps/stdio/onyvore)     │  │ (apps/browser/onyvore)              │
│                          │  │                                     │
│ NlpService               │  │ App (shell + viewed notebook state) │
│ SearchIndexService       │  │ ├── NotebookSelector (dropdown)     │
│ LinkGraphService         │  │ ├── SearchBar (omnipresent)         │
│ MetadataService          │  │ ├── NotebookSidebar (single notebook│
│ PersistenceService       │  │ │   ├── NotebookTree (TreeItem)     │
│ ReconciliationService    │  │ │   └── UnlinkedNotes (TreeItem)    │
│                          │  │ └── LinksPanel                      │
│ @StdioHandler methods    │  │     ├── OutboundLinks (TreeItem)    │
│ Progress notifications   │  │     └── InboundLinks (TreeItem)     │
│                          │  │                                     │
│                          │  │ Redux + MessageBus middleware       │
└──────────────────────────┘  └─────────────────────────────────────┘
```

### 2.1 Message Flow

**File change → index update → UI refresh:**
1. `FileWatcherService` (extension host) detects `.md` file event
2. Debounces 300ms, then sends `notebook.fileEvent` request to stdio server
3. Stdio server processes event (NLP, index, link graph, persist)
4. Stdio server sends `notebook.indexUpdated` notification back to extension
5. Extension broadcasts notification to webview
6. Webview Redux store updates, React components re-render

**User searches:**
1. User types in the omnipresent `SearchBar` (always visible in sidebar)
2. Webview dispatches `notebook.search` request via `useRpc()` hook
3. Stdio server runs Orama query with graph boost, extracts all matching text snippets, filters out zero-match results, returns ranked results with snippets
4. `SearchBar` renders results inline using `TreeItem` for file name/path, with all snippets shown below each result and search terms highlighted

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

The React UI rendered in VS Code's sidebar. All data comes from the stdio server via JSON-RPC through the Redux message bus middleware.

**Components:**

| Component | Purpose | Data Source |
|---|---|---|
| `App` | Shell — manages viewed notebook state, toolbar, layout | Redux `notebooks` + `activeNotebook` slices |
| `NotebookSelector` | Dropdown with typeahead for switching notebooks | Receives notebooks list as props from App |
| `SearchBar` | Omnipresent search with inline snippet results | `notebook.search` via `useRpc()` — returns ranked results with all matching snippets |
| `NotebookSidebar` | Fetches all notebooks, renders single viewed notebook | `notebook.getNotebooks` — receives `notebookId` prop |
| `NotebookTree` | File tree for one notebook (uses TreeItem) | Notebook data from NotebookSidebar |
| `UnlinkedNotes` | Orphan detection (uses TreeItem) | `notebook.getOrphans` — notes with zero links |
| `LinksPanel` | Outbound + Inbound links for active note | `notebook.getLinks` — follows active notebook from Redux |
| `OutboundLinks` | Outbound link list (uses TreeItem) | Subset of LinksPanel data |
| `InboundLinks` | Inbound link list (uses TreeItem) | Subset of LinksPanel data |
| `CollapsibleSection` | Reusable collapsible with inverted-color header, chevron, badge, actions | Wraps NotebookTree, UnlinkedNotes, OutboundLinks, InboundLinks |
| `TreeItem` | Shared tree row: label, sublabel (responsive), icon, badge | Used by all tree-like lists |
| `Icons` | VS Code codicon font wrappers | `@vscode/codicons` CSS classes |
| `ErrorBoundary` | React error boundary | Catches render errors |

**Redux Slices:**

| Slice | Purpose |
|---|---|
| `notebooks.slice` | Notebook list and file trees. Updated on `notebook.indexUpdated` notifications |
| `active-notebook.slice` | Active notebook ID and active note path. Updated by `@WebviewHandler` broadcast |
| `links.slice` | Current note's outbound and inbound links. Refreshed on active note change and `notebook.indexUpdated` |
| `search-results.slice` | Search results for the active query |

### 3.4 Shared Library (`lib-isomorphic-onyvore`)

Type-safe contracts shared across all three tiers.

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
  NOTEBOOK_GET_LINKS: 'notebook.getLinks',
  NOTEBOOK_GET_NOTEBOOKS: 'notebook.getNotebooks',
  NOTEBOOK_GET_ORPHANS: 'notebook.getOrphans',
  NOTEBOOK_REBUILD: 'notebook.rebuild',
  NOTEBOOK_RECONCILE: 'notebook.reconcile',
  NOTEBOOK_INITIALIZE: 'notebook.initialize',
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

### 4.2b Editor Features (`WikilinkFeaturesService`, `WikilinkDiagnosticsService`)

Both resolve links through `parseWikilinks` / `resolveWikilinkTarget` in the isomorphic library — the same functions `WikilinkService` uses to build the graph. That sharing is the point: if the two processes resolved separately, ctrl-clicking `[[foo]]` could open a different note than the one the graph drew an edge to.

`parseWikilinks` reports byte offsets alongside each target, which is what makes editor ranges possible. Fenced and inline code are blanked with equal-length whitespace rather than removed, so every subsequent offset stays valid.

Completion detects an open `[[` by scanning back along the cursor's line for an unclosed pair, and inserts `wikilinkCompletionFor(file, allFiles)` — the bare basename, or the path-qualified form when the basename is ambiguous. That helper and the resolver are tested together for round-tripping, so a suggestion always resolves back to the note that produced it.

Diagnostics refresh on document open, change, and configuration change, and also on `notebook.indexUpdated` — a note created elsewhere can resolve links that were broken a moment ago.

### 4.3 Search (`SearchService`, `SearchIndexService`)

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

### 4.3b Search Index internals (`SearchIndexService`)

```typescript
import { create, insert, remove, search, save, load } from '@orama/orama';

// Schema per notebook
const schema = {
  relativePath: 'string',
  title: 'string',       // path-qualified: "parentDir basename" for subdirectory files, "basename" for root files
  content: 'string',     // full markdown content
} as const;

// Search queries match against title, relativePath, and content
// This allows "work overview" to preferentially surface work/overview.md
```

**Graph-boosted ranking:** After Orama returns text-relevance results, each result's score is adjusted by its inbound link count from the `LinkGraphService`:

```
finalScore = oramaScore * (1 + log2(1 + inboundLinkCount))
```

This gives diminishing returns to additional links while ensuring well-connected notes outrank isolated ones at equivalent text relevance.

**Snippet extraction:** For each search result, `extractSnippets()` finds all occurrences of every search term in the document content, creates ~120-character windows around each match (with 40 characters of leading context), and merges overlapping windows. Results with zero content matches are filtered out before returning. The search response type is:

```typescript
Array<{ relativePath: string; title: string; score: number; snippets: string[] }>
```

### 4.4 Persistence (`PersistenceService`)

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

### 4.5 File Watcher (`FileWatcherService`)

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

### 4.6 Startup Reconciliation (`ReconciliationService`)

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

Key sections of `apps/vscode/onyvore/package.json`:

```json
{
  "name": "onyvore",
  "displayName": "Onyvore",
  "description": "Local-first personal knowledge management for VS Code",
  "version": "1.2.0",
  "publisher": "onivoro",
  "engines": { "vscode": "^1.74.0" },
  "categories": ["Notebooks"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/main.js",
  "repository": {
    "type": "git",
    "url": "https://github.com/onivoro/onyvore.git"
  },
  "contributes": {
    "commands": [
      { "command": "onyvore.initializeNotebook", "title": "Onyvore: Initialize Notebook" },
      { "command": "onyvore.discoverNotebooks", "title": "Onyvore: Discover Notebooks" },
      { "command": "onyvore.searchNotebook", "title": "Onyvore: Search Notebook" },
      { "command": "onyvore.rebuildNotebook", "title": "Onyvore: Rebuild Notebook" }
    ],
    "viewsContainers": {
      "activitybar": [
        { "id": "onyvore", "title": "Onyvore", "icon": "resources/icon.svg" }
      ]
    },
    "views": {
      "onyvore": [
        { "type": "webview", "id": "onyvore.webview", "name": "Onyvore", "icon": "resources/icon.svg" },
        { "type": "webview", "id": "onyvore.links", "name": "Links", "icon": "resources/icon.svg" }
      ]
    },
    "viewsWelcome": [ /* empty-state CTA for onyvore.webview */ ],
    "configuration": { /* onyvore.* settings — see PRD 5.3 */ }
  }
}
```

**Three webview views, one bundle.** The extension framework wires a single webview provider, so `SecondaryViewsService` registers the Links and Graph views itself: requests reuse the exported `defaultWebviewMessageHandler`, and the three notifications the panel needs are forwarded explicitly because the framework's broadcast only reaches the primary provider. Each provider injects `window.__ONYVORE_VIEW__`, which is how one React build serves all three views.

**Alignment checklist:**
- `contributes.commands[*].command` ↔ `onyvoreCommands` constants ↔ `@CommandHandler()` decorators
- `contributes.views.onyvore[0].id` ↔ `OnyvoreWebviewProvider.viewType` ↔ `@VscodeExtensionModule.webviewViewType`
- `main` → webpack output entry point

---

## 6. Nx Configuration

### 6.1 `tsconfig.base.json` Path Mapping

Add to the existing `paths` object:

```json
"@onivoro/isomorphic-onyvore": ["libs/isomorphic/onyvore/src/index.ts"]
```

### 6.2 Project Configurations

**`apps/vscode/onyvore/project.json`:**
```json
{
  "name": "app-vscode-onyvore",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "apps/vscode/onyvore/src",
  "projectType": "application",
  "targets": {
    "build": {
      "executor": "@nx/webpack:webpack",
      "dependsOn": ["app-stdio-onyvore:build", "app-browser-onyvore:build"],
      "outputs": ["{options.outputPath}"],
      "defaultConfiguration": "production",
      "options": {
        "target": "node",
        "compiler": "tsc",
        "outputPath": "apps/vscode/onyvore/dist",
        "main": "apps/vscode/onyvore/src/main.ts",
        "tsConfig": "apps/vscode/onyvore/tsconfig.app.json",
        "generatePackageJson": false,
        "assets": [
          { "input": "apps/vscode/onyvore", "glob": "package.json", "output": "." },
          { "input": "apps/vscode/onyvore", "glob": "README.md", "output": "." },
          { "input": "apps/vscode/onyvore", "glob": ".vscodeignore", "output": "." },
          { "input": "apps/vscode/onyvore/src/assets", "glob": "**/*", "output": "./resources" },
          { "input": "apps/stdio/onyvore/dist", "glob": "main.js", "output": "./server" },
          { "input": "apps/stdio/onyvore/dist", "glob": "main.js.map", "output": "./server" },
          { "input": "dist/apps/browser/onyvore", "glob": "**/*", "output": "./webview" }
        ],
        "isolatedConfig": true,
        "sourceMap": true,
        "webpackConfig": "apps/vscode/onyvore/webpack.config.js"
      },
      "configurations": {
        "development": {},
        "production": {}
      }
    },
    "package": {
      "executor": "nx:run-commands",
      "dependsOn": ["build"],
      "options": {
        "command": "cd apps/vscode/onyvore/dist && node -e \"const p=require('./package.json');p.main='./main.js';require('fs').writeFileSync('./package.json',JSON.stringify(p,null,2))\" && vsce package --no-dependencies --skip-license -o ../onyvore.vsix --baseContentUrl https://github.com/onivoro/onyvore --baseImagesUrl https://github.com/onivoro/onyvore"
      }
    }
  },
  "tags": []
}
```

**`apps/stdio/onyvore/project.json`:**
```json
{
  "name": "app-stdio-onyvore",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "apps/stdio/onyvore/src",
  "projectType": "application",
  "targets": {
    "build": {
      "executor": "@nx/webpack:webpack",
      "outputs": ["{options.outputPath}"],
      "defaultConfiguration": "production",
      "options": {
        "target": "node",
        "compiler": "tsc",
        "outputPath": "apps/stdio/onyvore/dist",
        "main": "apps/stdio/onyvore/src/main.ts",
        "tsConfig": "apps/stdio/onyvore/tsconfig.app.json",
        "generatePackageJson": false,
        "isolatedConfig": true,
        "sourceMap": true,
        "webpackConfig": "apps/stdio/onyvore/webpack.config.js"
      },
      "configurations": {
        "development": {},
        "production": {}
      }
    }
  },
  "tags": []
}
```

**`apps/browser/onyvore/project.json`:**
```json
{
  "name": "app-browser-onyvore",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "apps/browser/onyvore/src",
  "projectType": "application",
  "targets": {},
  "tags": []
}
```

**`libs/isomorphic/onyvore/project.json`:**
```json
{
  "name": "lib-isomorphic-onyvore",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/isomorphic/onyvore/src",
  "projectType": "library",
  "targets": {
    "build": {
      "executor": "@nx/vite:build",
      "generatePackageJson": true,
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/isomorphic/onyvore"
      }
    }
  },
  "tags": []
}
```

---

## 7. Dependencies

### 7.1 Framework (`@onivoro/*`)

| Package | Used In |
|---|---|
| `@onivoro/server-vscode` | `app-vscode-onyvore` |
| `@onivoro/server-stdio` | `app-stdio-onyvore` |
| `@onivoro/isomorphic-jsonrpc` | all tiers |
| `@onivoro/browser-jsonrpc` | `app-browser-onyvore` |
| `@onivoro/browser-redux` | `app-browser-onyvore` |

### 7.2 Domain

| Package | Used In | Purpose |
|---|---|---|
| `compromise` | `app-stdio-onyvore` | NLP noun-phrase extraction |
| `@orama/orama` | `app-stdio-onyvore` | Full-text search index |

### 7.3 UI

| Package | Used In | Purpose |
|---|---|---|
| `react`, `react-dom` | `app-browser-onyvore` | UI framework |
| `@reduxjs/toolkit`, `react-redux` | `app-browser-onyvore` | State management |
| `@vscode/codicons` | `app-browser-onyvore` | VS Code icon font (codicon CSS classes) |
| `uuid` | `app-browser-onyvore` | JSON-RPC request IDs |

**Styling:** No component library. All styles are in `onyvore.css` using only two VS Code CSS custom properties: `--vscode-editor-foreground` and `--vscode-editor-background`. Derived colors (borders, hover states, scrollbars) use `color-mix(in srgb, ...)` for opacity variations. Section headers invert the two color roles. The codicon font is inlined as base64 via Vite's `assetsInlineLimit` to avoid webview path resolution issues, with `data:` added to the CSP `font-src` directive.

### 7.4 Webview Build & CSP

**Vite config** (`apps/browser/onyvore/vite.config.ts`): Sets `assetsInlineLimit: 200000` to inline the codicon `.ttf` font as a base64 data URI, avoiding VS Code webview path resolution issues with font URLs.

**CSP override** (`OnyvoreWebviewProvider.getHtmlForWebview`): Adds `data:` to the `font-src` CSP directive so the base64-inlined font loads: `html.replace('font-src ', 'font-src data: ')`.

### 7.5 Build

| Package | Used In | Purpose |
|---|---|---|
| `@nestjs/common`, `@nestjs/core` | `app-vscode-onyvore`, `app-stdio-onyvore` | DI framework |
| `reflect-metadata` | `app-vscode-onyvore` | NestJS decorator metadata |
| `@nx/webpack`, `webpack` | `app-vscode-onyvore`, `app-stdio-onyvore` | Bundling |
| `@nx/vite`, `vite`, `@vitejs/plugin-react` | `app-browser-onyvore`, `lib-isomorphic-onyvore` | Bundling |
| `@vscode/vsce` | devDependency (root) | VSIX packaging |

### 7.6 Root Package Scripts

```json
"onyvore:vsix": "npx nx run app-vscode-onyvore:package"   // Build + package VSIX
"onyvore:install": "code --install-extension apps/vscode/onyvore/onyvore.vsix"  // Install locally
```

The `package` target runs `build` (which chains stdio + browser + vscode builds), patches `package.json` main entry for the flat dist layout, and runs `vsce package`. Output: `apps/vscode/onyvore/onyvore.vsix`.
