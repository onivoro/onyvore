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
| `notebook.ignoreChanged` | Extension host | `.onyvoreignore` was modified — re-evaluate file inclusion/exclusion |
| `notebook.search` | Browser webview | Full-text search with graph-boosted ranking |
| `notebook.getLinks` | Browser webview | Outbound + inbound links for a specific note |
| `notebook.getNotebooks` | Browser webview | List all registered notebooks with their file trees |
| `notebook.getOrphans` | Browser webview | Notes with zero inbound and outbound links |
| `notebook.rebuild` | Extension host | Delete artifacts, clear memory, re-initialize from scratch |

### NlpService

Wraps the `compromise` NLP library. Implements the extraction pipeline from PRD Section 4.4:

1. **Parse**: `nlp(content).nouns().out('array')` extracts raw noun phrases
2. **Decompose**: Multi-word phrases are kept whole AND split into individual words (no intermediate sub-spans)
3. **Stop nouns filter**: Candidates matching `STOP_NOUNS` are removed (individual words are filtered independently from their parent phrase)
4. **Min length**: Single-character tokens are excluded

Returns a `Map<string, number>` of normalized phrase → occurrence count.

### LinkGraphService

Manages per-notebook in-memory link graphs with four indexes:

- `edges`: `Map<"source::target", Edge>` — all edges keyed by composite key
- `outboundIndex`: `Map<sourcePath, Set<edgeKey>>` — fast outbound lookup
- `inboundIndex`: `Map<targetPath, Set<edgeKey>>` — fast inbound/backlink lookup
- `phraseCache`: `Map<filePath, Map<phrase, count>>` — cached NLP results per file
- `titleIndex`: `Map<lowercaseTitle, Set<relativePath>>` — reverse lookup from title to file paths

**Operations:**

- **Create**: Extract phrases → register title → match against all titles (outbound) → reverse-match all cached phrases against new title (inbound)
- **Change**: Remove outbound edges → re-extract → rebuild outbound edges
- **Delete**: Remove outbound + inbound edges → remove from caches

Matching is case-insensitive against note titles (basename without `.md`). Self-links are excluded. Multiple noun phrases matching the same target are aggregated into a single edge with summed counts.

### SearchIndexService

Wraps Orama (pure-TypeScript in-memory search engine). Each notebook gets its own index with schema `{ relativePath, title, content }`.

**Graph-boosted ranking**: After Orama returns text-relevance results, scores are adjusted: `finalScore = oramaScore * (1 + log2(1 + inboundLinkCount))`. This gives well-connected notes higher ranking at equivalent text relevance.

Supports serialization to/from `index.bin` via Orama's `save()`/`load()`.

### MetadataService

Manages per-notebook `NotebookMetadata` (file → last-seen modification time). Used by `ReconciliationService` to detect what changed while the extension was offline.

### PersistenceService

Writes three artifacts to `{notebookRoot}/.onyvore/`:

- `index.bin` — serialized Orama search index
- `links.json` — `{ edges: Edge[] }`
- `metadata.json` — `{ files: Record<relativePath, { mtimeMs }> }`

All writes are atomic (write to `.tmp`, then `rename()`). Triggered after each debounced batch and during initialization checkpoints (every 100 files).

### ReconciliationService

Two modes:

- **Initialize**: Full filesystem scan for a new notebook. Processes all `.md` files, sends progress notifications, checkpoints every 100 files.
- **Reconcile**: Loads persisted metadata, diffs against current filesystem (new/modified/deleted), processes deltas. Deletes are processed first, then creates and modifications.

Both modes skip `.onyvore/` directories and nested notebook boundaries (subdirectories containing their own `.onyvore/`).

## Key Dependencies

| Package | Purpose |
|---|---|
| `compromise` | NLP noun-phrase extraction (English only) |
| `@orama/orama` | Pure-TypeScript full-text search engine |
| `@onivoro/server-stdio` | NestJS stdio transport, `@StdioHandler` decorator |
| `@onivoro/isomorphic-jsonrpc` | `MESSAGE_BUS` token, `MessageBus` interface |
| `@onivoro/isomorphic-onyvore` | Shared types, constants, stop nouns |
