# app-stdio-onyvore

NestJS stdio server implementing all of Onyvore's backend logic. Runs as a child process spawned by the VS Code extension host, communicating via stdio JSON-RPC. This is where the PRD's functional requirements are implemented — NLP extraction, full-text search, link graph computation, persistence, and startup reconciliation.

## Runtime

- Spawned by the extension host as a Node.js child process
- No direct VS Code API access — all VS Code interactions are proxied through the extension host
- Communicates exclusively via stdin/stdout JSON-RPC (provided by `@onivoro/server-stdio`)
- All dependencies are webpack-bundled into a single `dist/main.js` (no `node_modules` at runtime)

## Entry Point

`src/main.ts` calls `bootstrapStdioApp(AppStdioOnyvoreModule)` which initializes NestJS and starts listening on stdin.

## Module Structure

`AppStdioOnyvoreModule` registers `StdioTransportModule.forRoot()` and all domain services. The `StdioTransportModule` auto-discovers methods decorated with `@StdioHandler()`.

## Services

### OnyvoreMessageHandlerService

The JSON-RPC API surface. Each method is a `@StdioHandler('method.name')`. This is the router — it receives requests, delegates to domain services, and returns results.

**Request handlers (11 methods):**

| Method | Source | Purpose |
|---|---|---|
| `notebook.register` | Extension host | Register a discovered notebook (path, name) |
| `notebook.unregister` | Extension host | Remove a notebook from memory |
| `notebook.initialize` | Extension host | First-time full scan — async, returns immediately, sends progress notifications |
| `notebook.reconcile` | Extension host | Startup reconciliation — loads persisted state, diffs against filesystem |
| `notebook.fileEvent` | Extension host | Batched file watcher events (create/change/delete). Processes each event, persists, notifies `indexUpdated` |
| `notebook.ignoreChanged` | Extension host | `.onyvoreignore` was modified — reload rules and reconcile |
| `notebook.search` | Browser webview | Full-text search with graph-boosted ranking |
| `notebook.getLinks` | Browser webview | All five link buckets for a specific note |
| `notebook.getNotebooks` | Browser webview | List all registered notebooks with their file trees |
| `notebook.getOrphans` | Browser webview | Notes with no `explicit` or `mention` edges (similarity is excluded) |
| `notebook.rebuild` | Extension host | Delete artifacts, clear memory, re-initialize from scratch |

### NlpService

Wraps the `compromise` NLP library. Implements the extraction pipeline from PRD Section 4.4:

1. **Parse**: `nlp(content).nouns().toSingular().out('array')` extracts and lemmatizes raw noun phrases
2. **Decompose**: Multi-word phrases are kept whole AND split into individual words (no intermediate sub-spans)
3. **Stop nouns filter**: Candidates matching `STOP_NOUNS` are removed (individual words are filtered independently from their parent phrase)
4. **Min length**: Single-character tokens are excluded

Returns a `Map<string, number>` of normalized phrase → occurrence count, which is stored in `TermStoreService` and read by both `TfidfService` and `MentionService`.

### TermStoreService

Single owner of per-document term vectors (`notebookId → relativePath → Map<term, count>`). Sharing one store rather than giving each consumer its own copy is what keeps memory bounded at the 10k-note target.

### IndexingService

The shared indexing pipeline, used by file events, ignore changes, initialization, and reconciliation. Two phases, and the order matters:

1. `registerDocument` — adds the note to the search index, term store, title index, link graph, and metadata.
2. `computeEdges` — derives `similar`, `mention`, and `explicit` edges. Requires every document in the batch to be registered first, because TF-IDF needs corpus-wide document frequency and mention matching needs every title present.

`computeEdges` takes `refreshInbound`, set when a note is newly created: existing notes may already mention its title, and wikilinks that previously failed to resolve may now find it.

### MentionService

Owns the title index and produces `mention` edges.

- `titleIndexes`: `Map<notebookId, Map<titleVariant, Set<relativePath>>>` — each note registers its basename plus, in subdirectories, a path-qualified variant (`work overview` for `work/overview.md`).
- `fileTitles`: `Map<notebookId, Map<relativePath, string[]>>` — so unregistering a file removes exactly the variants it added, leaving basename siblings intact.

`computeOutboundEdges` matches a note's terms against titles; `computeInboundEdges` runs the match in reverse over cached terms so a newly created note picks up mentions that already existed. Self-links are excluded, and phrases matching the same target aggregate into one edge with summed counts.

### TfidfService

Produces `similar` edges by cosine similarity over TF-IDF vectors. Holds `df` and `docCount`, borrowing term vectors from `TermStoreService`.

- **Cached vectors**: a `version` counter bumps on every corpus mutation; vectors are rebuilt only when the cache is behind. Without this, one edit re-vectorizes the whole notebook on every save.
- **Per-note cap**: `maxSimilarPerNote` (default 10) bounds the graph. A pair survives if either endpoint ranks it in its own top matches.
- Terms with `idf === 0` (present in every note) are dropped as non-discriminative.

### WikilinkService

Parses and resolves `[[target]]` / `[[target|display]]`, skipping fenced and inline code. Resolution is Obsidian-compatible: `.md` ignored, `/` means path match, otherwise case-insensitive basename with shortest-path tiebreak. Parsed link text is cached per file so `computeInboundEdges` can attach edges when a previously missing target is created.

### IgnoreService

Loads and evaluates `.onyvoreignore` for the server, so the rules apply to filesystem scans as well as live events. The extension host keeps its own copy to suppress events early, but this one is authoritative.

### LinkGraphService

Stores every edge type in one graph, with indexes for fast lookup:

- `edges`: `Map<"type::source::target", Edge>` — the type is part of the key, so `explicit`, `mention`, and `similar` edges can coexist between the same pair of notes
- `outboundIndex`: `Map<sourcePath, Set<edgeKey>>`
- `inboundIndex`: `Map<targetPath, Set<edgeKey>>`
- `files`: `Set<relativePath>` — every known note, so one with no edges can be reported as an orphan

**Type-aware replacement**, because the edge types have different ownership:

| Method | Used for | Removes |
|---|---|---|
| `replaceOutboundEdgesForFile` | `explicit`, `mention` | Only outbound edges of that type |
| `replaceInboundEdgesForFile` | `explicit`, `mention` on create | Only inbound edges of that type |
| `replaceSymmetricEdgesForFile` | `similar` | Both directions |
| `replaceAllEdgesOfType` | Full rebuilds | Every edge of that type |

`getOrphans` ignores `similar` edges: cosine similarity connects nearly every note to something, so counting it would leave "Unlinked Notes" permanently empty. `loadEdges` skips any edge with an unrecognized `type` rather than coercing it to a default.

### SearchIndexService

Wraps Orama (pure-TypeScript in-memory search engine). Each notebook gets its own index with schema `{ relativePath, title, content }`.

**Graph-boosted ranking**: After Orama returns text-relevance results, scores are adjusted: `finalScore = oramaScore * (1 + log2(1 + inboundLinkCount))`. This gives well-connected notes higher ranking at equivalent text relevance.

Maintains a `relativePath → Orama document id` map so removal is exact. Resolving the document by searching for its path would match every note sharing a basename token and can delete the wrong note; the map makes removal deterministic and O(1). `addDocument` replaces any existing entry for the path, so repeated creates cannot accumulate duplicates.

Serializes to `index.bin` as `{ version, index, docIds }` via Orama's `save()`/`load()`. An unrecognized version throws, so the caller rebuilds rather than serving an index that disagrees with `metadata.json`.

### MetadataService

Manages per-notebook `NotebookMetadata` (file → last-seen modification time). Used by `ReconciliationService` to detect what changed while the extension was offline.

### PersistenceService

Writes four derived artifacts to `{notebookRoot}/.onyvore/`:

- `index.bin` — `{ version, index, docIds }`
- `links.json` — `{ version, edges: Edge[] }`
- `metadata.json` — `{ version, files: Record<relativePath, { relativePath, mtimeMs }> }`
- `tfidf.json` — `{ version, tf, df }`

`notebook.json` also lives there but is *not* derived: it marks the directory as a notebook and survives `Rebuild`.

All writes are atomic (write to `.tmp`, then `rename()`). Triggered after each debounced batch and during initialization checkpoints (every 100 files).

`loadAll` returns false unless all four load at the current version. Because they are written independently, a crash can leave them disagreeing about what is indexed — so the caller rebuilds rather than trusting partial state.

### ReconciliationService

Two modes:

- **Initialize**: Full filesystem scan for a new notebook. Registers every file, then computes `similar` and `mention` edges in single whole-corpus passes — cheaper and more accurate than per-file computation against a partial corpus — then resolves wikilinks against the complete file list. Checkpoints every 100 files.
- **Reconcile**: Diffs persisted metadata against the current filesystem (new/modified/deleted) and processes only the deltas. Deletes run first so the corpus is correct before any edge is derived; then all changed files are registered, and only then are their edges computed.

Both modes skip `.onyvore/` directories, nested notebook boundaries (subdirectories with their own `.onyvore/`), and paths excluded by `.onyvoreignore`.

## Key Dependencies

| Package | Purpose |
|---|---|
| `compromise` | NLP noun-phrase extraction (English only) |
| `@orama/orama` | Pure-TypeScript full-text search engine |
| `@onivoro/server-stdio` | NestJS stdio transport, `@StdioHandler` decorator |
| `@onivoro/isomorphic-jsonrpc` | `MESSAGE_BUS` token, `MessageBus` interface |
| `@onivoro/isomorphic-onyvore` | Shared types, constants, stop nouns |
