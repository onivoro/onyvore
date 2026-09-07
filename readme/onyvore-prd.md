# Product Requirements Document: Onyvore

**Product Name:** Onyvore
**Version:** 1.0.0
**Status:** Final Specification
**Platform:** VS Code Extension (Node.js Runtime)
**Target:** Local-First Personal Knowledge Management

---

## 1. Executive Summary
**Onyvore** is a high-performance personal knowledge management (PKM) extension for VS Code. It bridges the gap between the structured reliability of **Joplin** and the networked intelligence of **Obsidian**. Onyvore organizes knowledge into **notebooks** — directories marked by a `.onyvore/` folder — each with its own isolated search index, link graph, and metadata. A single VS Code workspace can contain multiple independent notebooks. Onyvore never mutates user files; all metadata, links, and indexes are computed artifacts stored externally. Notebooks are designed to be open directories — any tool, script, or AI agent can create or modify markdown files, and Onyvore will seamlessly integrate them.

---

## 2. Definitions

### Workspace
The VS Code window. A workspace is the top-level directory (or multi-root configuration) open in VS Code. The workspace itself is not a notebook — it merely contains one or more notebooks. Onyvore discovers notebooks by scanning the workspace for `.onyvore/` directories.

### Notebook
A directory containing a `.onyvore/` directory. A notebook is the fundamental unit of organization in Onyvore. Each notebook is **fully isolated** — it has its own search index, link graph, metadata, and `.onyvoreignore` file. Notes in one notebook cannot link to or appear in search results from another notebook.

A notebook owns all `.md` files within its directory, recursively and at unlimited depth, **down to but not into** any nested notebook. A subdirectory containing its own `.onyvore/` acts as a boundary — the parent notebook stops claiming files at that point.

```
~/notes/                        ← workspace (not a notebook)
├── work/
│   ├── .onyvore/               ← notebook: owns meetings/, projects.md
│   ├── meetings/
│   │   └── standup.md
│   └── projects.md
├── personal/
│   ├── .onyvore/               ← notebook: owns recipes.md, journal.md
│   ├── recipes.md
│   └── journal.md
└── random-thought.md           ← unmanaged file
```

Nested notebooks are supported:

```
~/notes/                        ← notebook (has .onyvore/)
├── .onyvore/
├── overview.md                 ← owned by ~/notes/
├── general/
│   └── ideas.md                ← owned by ~/notes/
├── work/
│   ├── .onyvore/               ← nested notebook (boundary)
│   ├── projects.md             ← owned by ~/notes/work/
│   └── deep/
│       └── task.md             ← owned by ~/notes/work/
└── personal/
    ├── .onyvore/               ← nested notebook (boundary)
    └── journal.md              ← owned by ~/notes/personal/
```

The parent notebook's file watcher, search index, and link graph skip any subdirectory that contains `.onyvore/`. This is the same boundary pattern as `.git` — git will not recurse into a subdirectory that has its own `.git/` directory.

### Unmanaged Files
`.md` files that are not inside any notebook (i.e., not under any directory containing `.onyvore/`). These files are visible in the VS Code file explorer but invisible to Onyvore — not indexed, not linked. To manage them, the user either initializes a notebook at a parent directory or moves the files into an existing notebook.

---

## 3. Core Philosophy
* **Markdown-First:** All notes are standard `.md` files. No proprietary databases.
* **Zero Mutation:** Onyvore never modifies user files. All metadata, link graphs, and indexes are derived artifacts stored in `.onyvore/`. Files remain exactly as authored.
* **Notebook-Centric:** Each notebook is self-contained. Settings, indexes, and computed artifacts are stored locally within the notebook's `.onyvore/` directory.
* **Open Directory:** Any `.md` file in a notebook directory (recursively, unlimited depth) is part of that notebook, regardless of how it was created — by the extension, an AI agent, a script, or manual copy. Non-markdown files (images, PDFs, etc.) coexist in the notebook but only `.md` files are indexed, linked, and searched.
* **Zero-Binary:** No SQLite or native C++ dependencies. Built for universal distributability via Node.js.

---

## 4. Functional Requirements

### 4.1 Knowledge Organization
* **Notebook Sidebar:** A dedicated sidebar panel accessible via an activity bar icon (separate from VS Code's native Explorer). The sidebar shows **one notebook at a time** — the "viewed notebook." When multiple notebooks exist, a **dropdown selector with typeahead filtering** allows the user to switch between notebooks. A **plus (+) button** in the toolbar allows initializing a new notebook via a directory picker. Single-notebook workspaces auto-select that notebook; newly initialized notebooks are auto-selected in the dropdown. The sidebar coexists alongside the Explorer — it does not replace it.
* **Automatic Link Graph:** Connections between notes are computed automatically within each notebook — no manual linking syntax required. Links do not cross notebook boundaries. See Section 4.4 for the linking algorithm.
* **Links Panel:** A dedicated sidebar panel for the active note, showing three kinds of connection:
  * **Links / Backlinks (`explicit`):** `[[wikilinks]]` the author wrote, and the notes whose wikilinks point back here. Directional. Clicking an entry navigates to the other note.
  * **Mentions / Mentioned By (`mention`):** Notes whose titles this note mentions in prose, and notes that mention this one. Directional, ranked by occurrence count, and shown with that count (e.g. "hotsauce · 5"). This is the automatic linking that requires no syntax.
  * **Related Notes (`similar`):** Notes with similar overall content, by TF-IDF cosine similarity. Symmetric — there is no direction to report — and ranked by similarity, shown as a 0–100 score rather than a count of anything.
  Sections render only when they have entries. When no markdown file is focused (non-markdown file open, no file open, or file is unmanaged), the Links Panel displays: "Open a note to see its links."
* **Orphan Detection:** Notes with no `explicit` and no `mention` edges in either direction are surfaced as an "Unlinked Notes" section within the Notebook Sidebar, below the notebook's file tree. `similar` edges are deliberately excluded from this calculation: cosine similarity connects nearly every note to something, so counting it would leave the list permanently empty and hide exactly the notes it exists to surface.

### 4.2 File Watching
* **Continuous Monitoring:** Uses VS Code's `FileSystemWatcher` API to detect `.md` file creates, changes, and deletes within each notebook in real-time, regardless of the source. Non-markdown files are ignored by the watcher. Paths matching `.onyvoreignore` patterns are excluded (see Section 5.2). Subdirectories containing `.onyvore/` (nested notebooks) are excluded — each notebook manages its own watcher independently.
* **Debounce:** File watcher events are debounced with a 300ms window. Rapid changes to the same file (e.g., auto-save, fast edits) are coalesced into a single update. When multiple files change within the debounce window (e.g., an agent writing a batch of files), all changes are batched and processed together. This prevents a storm of incremental updates.
* **Incremental Updates:** File watcher events (after debounce) trigger incremental updates to the notebook's search index and link graph, keeping both current without full re-scans. The update behavior depends on the event type:
  * **Create:** The new file is indexed and its noun phrases are extracted and matched against existing note titles (outbound links). Additionally, existing noun phrases already cached in the link graph are re-evaluated against the new file's title to form inbound links. This reverse match is a string comparison against cached data — no NLP re-run is needed.
  * **Change:** The changed file's noun phrases are re-extracted and its outbound edges are rebuilt.
  * **Delete:** The file's entries are removed from `metadata.json`, `links.json`, and the search index. Dangling backlinks (edges pointing to the deleted file) are pruned from the graph.
* **Rename Handling:** `FileSystemWatcher` emits a delete + create pair for renames. The delete path prunes old edges; the create path rebuilds them against the new filename and content. The link graph self-heals — no stable file IDs are needed. Note: this approach performs redundant work (full NLP extraction on content that hasn't changed). Optimizing rename detection (e.g., matching content hashes within a short time window to coalesce delete + create into a single rename operation) is deferred to a future iteration.

### 4.3 High-Performance Search
* **Search Engine:** Powered by **Orama**, a pure-TypeScript, in-memory search engine. Orama indexes the title (path-qualified for files in subdirectories, e.g., "work overview" for `work/overview.md`), the file path, and the full text of each note, providing broad keyword and partial-match recall. Each notebook has its own independent search index.
* **Search Scope:** Search covers the viewed notebook by default. When a workspace has more than one notebook, a toggle widens it to all of them, with results grouped by notebook and the notebook holding the strongest match listed first.
* **Fuzzy Matching:** Instant results for keyword and partial matches across the searched notebook(s). Search queries match against the note title, file path, and content — so searching "work overview" preferentially surfaces `work/overview.md` over `personal/overview.md`.
* **Graph-Boosted Ranking:** Search results are boosted by link graph centrality. Notes with more inbound links rank higher, surfacing well-connected notes above isolated ones with the same keyword relevance. The formula is: `finalScore = oramaScore * (1 + log2(1 + inboundLinkCount))`. Results with zero content matches (matched only by title fuzzy matching) are filtered out.
* **Snippet Previews:** Each search result includes **all matching text snippets** — ~120-character windows around every occurrence of the search terms in the document. Nearby matches are merged into single longer snippets. Search terms are highlighted within snippets. The match count is displayed as a badge on each result.
* **Persistence:** All derived artifacts (`index.bin`, `links.json`, `metadata.json`) are written to disk on two triggers: after each debounced batch of incremental updates completes, and on extension deactivation (exit). This ensures a VS Code crash loses at most one debounce window (~300ms) of work. The persisted `index.bin` allows sub-100ms startup for large notebooks (10,000+ notes).

### 4.4 Automatic Linking

Onyvore computes a link graph between notes within each notebook. Links never cross notebook boundaries. The link graph and search index are intentionally separate pipelines — full-text search is broad and forgiving, while the link graph is selective and precise. The link graph feeds into search ranking (see Section 4.3) but does not constrain what is indexed.

**v1 is English-only.** The NLP library (compromise) supports English noun-phrase extraction. Multilingual support is a future consideration.

#### Edge Types

Three kinds of edge coexist, and any pair of notes may be connected by more than one at a time. They are stored, ranked, and displayed separately because they mean different things and are trustworthy to different degrees.

| Type | Derived from | Direction | `count` means |
| :--- | :--- | :--- | :--- |
| `explicit` | A `[[wikilink]]` the author wrote | Directional — the source owns the link | Fixed (100); wikilinks are not counted |
| `mention` | A noun phrase matching another note's title | Directional | Occurrences of the phrase |
| `similar` | TF-IDF cosine similarity between documents | Symmetric — stored both ways | `similarity * 100` |

Only `explicit` and `mention` count as "linked" for orphan detection. `similar` is a discovery aid, not a statement that two notes are related on purpose.

```json
{ "source": "recipes.md", "target": "hotsauce.md", "type": "mention", "noun": "hotsauce", "count": 8 }
```

#### Trigger Model
The link graph is updated via file watcher events (Section 4.2). Any filesystem change — from the extension, an external agent, or manual editing — triggers an incremental update. There is no separate "index operation" trigger; the file watcher is the single event source for both the search index and the link graph.

Indexing is two-phase, and the ordering is load-bearing. Every document in a batch is registered in the corpus *before* any edge is computed from it, because TF-IDF needs corpus-wide document frequency and mention matching needs every title registered. Computing edges while documents are still being added yields wrong scores and missing links.

#### `explicit` — Wikilinks

`[[target]]` and `[[target|display text]]` are parsed from note content, skipping fenced and inline code. Resolution is Obsidian-compatible:

1. A trailing `.md` in the target is ignored.
2. A target containing `/` is matched as a path, case-insensitively.
3. Otherwise the target matches any note with that basename, case-insensitively.
4. When several notes match, the shortest path wins.

Unresolved wikilinks produce no edge. Because Onyvore never rewrites user files, renaming a note leaves wikilinks pointing at the old name — these are surfaced rather than silently repaired (see Section 9). When the missing target is later created, cached link text is re-resolved so the edge appears without waiting for the source note to change.

#### `mention` — Noun Phrase to Title

Onyvore extracts noun phrases from note content and matches them against note titles. This is the linking that requires no syntax from the author: connections are discovered, not authored.

**NLP behavior (compromise).** Empirically tested; these characteristics inform the pipeline:

* **Unknown words default to nouns.** Made-up words (e.g. "onyvore") are reliably tagged as nouns regardless of casing or position. No dictionary is required.
* **Casing does not affect extraction.** Both "Onyvore" and "onyvore" are extracted.
* **Noun phrase grouping is greedy.** "onyvore search engine" is one phrase, not three — handled by decomposition below.
* **Gerunds are excluded.** "indexing" and "working" are tagged as verbs, which usefully reduces noise.
* **Hyphenated compounds are decomposed.** "machine-learning" splits into "machine" and "learning".

**Extraction pipeline.**

1. **Parse:** Content is processed through compromise; nouns are lemmatized to singular form so "clusters" and "cluster" are one term.
2. **Decompose:** Multi-word phrases are kept as-is *and* split into individual words. "onyvore search engine" yields four candidates: the full phrase plus each word. No intermediate sub-spans are generated. Single-word phrases are not decomposed.
3. **Filter — stop nouns:** All candidates are checked against a built-in list of ~65 ultra-generic and PKM-common nouns ("thing", "note", "file", "version", …). Words from a decomposed phrase are filtered independently: "change management" decomposes to "change management", "change", "management"; "change" is dropped while the full phrase and "management" survive. The list is not user-configurable.
4. **Filter — minimum length:** Single-character tokens are excluded.

**Matching.** Surviving phrases are matched case-insensitively against note titles. Each note registers two title variants:

* **Basename title:** the filename without `.md` (`overview` for `overview.md`).
* **Path-qualified title:** the parent directory plus the basename (`work overview` for `work/overview.md`). Root-level notes register only the basename.

This disambiguates notes sharing a basename: "work overview" matches only `work/overview.md`, while the bare "overview" matches both `work/overview.md` and `personal/overview.md` — correct when the source refers to the concept generically.

Only titles are match targets. If a concept matters enough to link to, it should be its own note. This encourages atomic notes and produces fewer false positives. **Self-links are excluded** — a note's own title is not a valid target for phrases extracted from that note.

There is one edge per (source, target) pair. When several phrases from one note match the same target (e.g. "sourdough" directly and as part of "sourdough starter"), their counts sum into a single edge, and the `noun` field stores the single phrase that contributed most.

#### `similar` — Document Similarity

Each note becomes a TF-IDF vector over its extracted terms; cosine similarity between vectors above a threshold (default 0.15) creates a symmetric edge in both directions. Terms appearing in every note have an IDF of zero and are discarded as non-discriminative.

Two bounds keep this tractable, because an uncapped similarity graph is O(n²) in both computation and stored size:

* **Per-note cap.** At most `maxSimilarPerNote` (default 10) related notes are kept per note, chosen by similarity. A pair survives if *either* endpoint ranks it in its own top matches, so capping never strips a note's strongest relationship.
* **Cached vectors.** Vectors are computed once per corpus revision and reused. Without this, a single edit re-vectorizes the entire notebook on every save.

Similarity scores are computed against the corpus as it stood when the edge was written. Because IDF shifts as the notebook grows, stored scores drift; they are refreshed on rebuild and whenever the containing note is reindexed.

#### Incremental Update Behavior

* **Create:** The note is indexed, its terms extracted, and its outbound edges of all three types computed. Inbound edges are also refreshed — notes already in the corpus may mention the new title, and wikilinks that previously failed to resolve may now find it.
* **Change:** The note is re-indexed and its outbound edges rebuilt. Its `similar` edges are replaced in both directions, since similarity is symmetric.
* **Delete:** The note is removed from the search index, term store, metadata, and link graph. Every edge touching it is pruned from both directions.
* **Rename:** `FileSystemWatcher` emits delete + create, and a startup diff produces the same pair. Onyvore recognizes it by content hash and *moves* the note instead of reprocessing it: term vectors and document frequency are re-keyed rather than recomputed, skipping the NLP pass that dominates indexing cost.

  Links are still rebuilt, because the note's *title* changed — notes mentioning the old name no longer match, and wikilinks written against the old name become unresolved and are surfaced as such (Section 4.6).

  A hash only pairs when exactly one deletion and one creation share it. Identical content is ordinary — two empty notes, two copies of a template — and guessing which became which would attribute a note's links to the wrong file. Ambiguous groups fall back to delete + create, which is always correct, just slower.

#### Initial Notebook Computation

On first initialization (or when `.onyvore/` artifacts are absent), the full notebook is scanned to build the search index and link graph. This is materially heavier than incremental updates and runs as a **non-blocking background process:**

1. **Immediate availability:** The sidebar and file editing are available immediately.
2. **Progressive results:** Search and links populate as files are processed, returning partial results until the scan completes. A status indicator shows progress.
3. **File watcher active during init:** Changes made during initialization are processed afterward, so nothing is lost.
4. **Whole-corpus passes:** `similar` and `mention` edges are computed in a single sweep once every note is registered — cheaper and more accurate than per-file computation against a partial corpus.

Derived artifacts are checkpointed periodically during the scan. If VS Code exits mid-initialization, the next startup enters the reconciliation path below and only the remaining work is done.

#### Startup Reconciliation

When the extension activates and a notebook's artifacts already exist, they may be stale — files can change while the extension is not running. Onyvore reconciles persisted state against the filesystem on every startup:

1. **Load persisted state.** `index.bin`, `links.json`, `metadata.json`, and `tfidf.json` are loaded. Search and links are immediately available from persisted data.
2. **Verify the artifact set.** Every artifact carries a format version, and all four must load. Because they are written as four independent files, a crash can leave them disagreeing about what is indexed — so a missing, unreadable, or out-of-version artifact triggers a full rebuild rather than serving a half-restored state.
3. **Diff against the filesystem.** The current tree is compared to `metadata.json`: files on disk but not in metadata are **created**, files with a newer mtime are **modified**, files in metadata but no longer on disk are **deleted**. Each is processed through the matching path above.
4. **Non-blocking.** Reconciliation runs in the background using the same progressive model, and the file watcher is active throughout.

Reconciliation is also the mechanism behind `.onyvoreignore` changes (Section 5.2): reloading the rules turns newly-ignored files into deletions and newly-admitted files into creations, which is exactly the diff this already computes.

### 4.5 Graph View

A read-only force-directed view of the notebook's link graph, in its own panel. It follows the **active notebook**, so it reflects whatever note is being edited.

* Node size reflects how many `explicit` and `mention` edges touch a note; `similar` edges are excluded so size tracks deliberate connection rather than vocabulary overlap.
* Edges are colored and weighted by type, and authored links pull harder in the layout than computed ones — so the shape reflects how much each kind of edge is worth trusting.
* Orphans and the active note are distinguished, making both easy to spot.
* Clicking a node opens that note; the wheel zooms.
* Large notebooks are capped at the best-connected 500 notes, and the number omitted is stated rather than silently truncated.

### 4.6 Editor Integration

Wikilinks are authored in the editor, so Onyvore provides the language features that make them usable. All of them resolve links through the same shared implementation the link graph uses, so the editor and the graph cannot disagree about where `[[foo]]` points.

* **Completion:** Typing `[[` suggests notes from the current notebook. The inserted text is the bare basename, or the path-qualified form when the basename is ambiguous, so a suggestion always resolves back to the note it named. The current note is excluded — a note cannot link to itself.
* **Navigation:** Resolved wikilinks are document links, so ctrl-click opens the target.
* **Hover:** Hovering a wikilink previews the target's opening lines, or reports that it resolves to nothing.
* **Diagnostics:** Wikilinks that resolve to no note are reported as warnings in the Problems panel, controlled by `onyvore.wikilinks.showUnresolved`.
* **Quick fixes:** An unresolved link offers to create the missing note, seeded with its title, or to repoint the link at an existing note with a similar name.

The diagnostics are how renames are handled. Onyvore never rewrites user files, so a link broken by a rename cannot be silently repaired the way Obsidian repairs one; reporting it makes the zero-mutation guarantee safe rather than lossy, and the quick fix applies the edit as the user's own action.

### 4.7 Metadata
Onyvore derives metadata for each note and stores it in `metadata.json`. Metadata is computed from filesystem state:
* **Last-seen modification time:** Used by startup reconciliation (Section 4.4) to detect files changed while the extension was not running.
* **Content hash:** Used to recognize a rename as a move rather than a delete plus an unrelated create. Optional — a note indexed before hashing existed simply never pairs, and falls back to the slower path.

---

## 5. Technical Architecture

### 5.1 Data Persistence (`.onyvore/` Folder)

Each notebook contains a `.onyvore/` directory. Its presence is what makes the directory a notebook.

| File | Derived? | Contents |
| :--- | :--- | :--- |
| `notebook.json` | No | Marks the directory as a notebook. Survives `Rebuild`. |
| `index.bin` | Yes | Serialized Orama search index, plus the path→document-id map used for precise removal. |
| `links.json` | Yes | The computed link graph: every edge, of every type. |
| `metadata.json` | Yes | Per-note last-seen modification time and content hash, used by reconciliation and rename detection. |
| `tfidf.json` | Yes | Per-note term frequencies and corpus document frequencies. |

Every derived file carries a format `version`. A version this build does not recognize is treated as unreadable and the notebook rebuilds — the artifacts are disposable by design, so this is always cheaper and safer than maintaining compatibility shims.

All derived files can be deleted and fully regenerated from the notebook's `.md` files; that is exactly what `Onyvore: Rebuild Notebook` does. `notebook.json` is not derived and is not deleted by a rebuild.

### 5.2 `.onyvoreignore`
Users can create a `.onyvoreignore` file in the notebook root (as a sibling of `.onyvore/`) to exclude paths from indexing, linking, and file watching. Paths in the file are relative to the notebook root. The syntax follows `.gitignore` conventions (glob patterns, `#` comments, `!` negation). Each notebook's `.onyvoreignore` is self-contained — a parent notebook's ignore file does not propagate into nested notebooks.

`.onyvoreignore` is user-authored and is not a derived artifact — it is not stored in `.onyvore/` and is not affected by `Onyvore: Rebuild Notebook`.

The rules are evaluated by the stdio server, so one implementation covers filesystem scans (initialization, reconciliation, rebuild) as well as live file events. The extension host also keeps a copy to suppress watcher events early, but the server is authoritative — a rule that the host missed still excludes the file.

When the file changes, Onyvore reloads the rules and re-runs reconciliation: newly-ignored files no longer appear in the scan and are removed from the index and link graph, while newly-admitted files look newly created and are processed as such.

Examples:

```
# Exclude documentation from a codebase
docs/api/
vendor/

# Exclude a scratch folder
_drafts/
```

Ignored paths are excluded from:
* File watching (no index/link updates for changes in ignored paths)
* Search indexing (ignored files do not appear in search results)
* Link graph (ignored files are not scanned for noun phrases and cannot be link targets)
* Initial notebook computation (ignored files are skipped during the background scan)

### 5.3 Settings

All settings live under `onyvore.*` in VS Code settings. Those that shape the link graph are pushed to the stdio server on activation and whenever they change; changing one recomputes the affected edges immediately rather than leaving them stale until the next rebuild.

| Setting | Default | Effect |
| :--- | :--- | :--- |
| `relatedNotes.enabled` | `true` | Compute `similar` edges at all. Turn off to rely on wikilinks and mentions alone. |
| `relatedNotes.threshold` | `0.15` | Minimum cosine similarity (0–1). Higher means fewer, closer matches. |
| `relatedNotes.maxPerNote` | `10` | Related notes kept per note. Bounds both the panel and `links.json`. |
| `fileWatcher.debounceMs` | `300` | How long changes must settle before reindexing. |
| `wikilinks.showUnresolved` | `true` | Report unresolved `[[wikilinks]]` in the Problems panel. |

### 5.4 Technology Stack
* **Runtime:** Node.js (VS Code Extension Host).
* **Framework:** NestJS via `@onivoro/server-vscode` (three-tier architecture: extension host + stdio server + React webview).
* **Search Engine:** Orama (Pure JS).
* **NLP:** compromise (Pure JS noun-phrase extraction).
* **Webview UI:** React + Redux + native CSS with VS Code theme variables (`--vscode-editor-foreground`, `--vscode-editor-background`) + `@vscode/codicons` icon font.
* **Build:** Nx monorepo. Webpack (extension host + stdio server), Vite (browser webview).

---

## 6. User Experience (UX)

### 6.1 Notebook Discovery
On workspace activation, Onyvore scans the workspace recursively at unlimited depth for directories containing `.onyvore/`. Each discovered notebook is registered and its file watcher, search index, and link graph are initialized. New notebooks can be created at any time via `Onyvore: Initialize Notebook`.

Notebook discovery only runs at two points:
* **Workspace activation** (automatic).
* **Manual invocation** via `Onyvore: Discover Notebooks` (user-triggered).

Discovery does not run continuously. If a `.onyvore/` directory is created mid-session (e.g., by an agent or script running `mkdir some-dir/.onyvore`), Onyvore will not detect it until the user runs `Onyvore: Discover Notebooks` or restarts the workspace. This is intentional — watching the entire workspace tree for new `.onyvore/` directories would be expensive and is not justified for a rare event.

### 6.2 Active Notebook vs. Viewed Notebook
Onyvore distinguishes between two notebook concepts:

* **Active notebook:** The notebook that contains the file currently focused in the editor. Determined automatically by file focus. Drives the Links Panel (outbound/inbound links for the focused note). The active notebook's name is displayed in the VS Code status bar. If no notebook owns the focused file, there is no active notebook.
* **Viewed notebook:** The notebook currently displayed in the Notebook Sidebar. The user explicitly selects this via the dropdown. Drives the file tree, unlinked notes, and search scope. Defaults to the active notebook if no explicit selection has been made, or to the sole notebook if only one exists.

This separation allows the user to browse one notebook's files while editing a note in a different notebook. The Links Panel always reflects the active notebook (follows the editor), while the sidebar reflects the viewed notebook (follows the dropdown).

### 6.3 Sidebar Layout
The sidebar is organized top-to-bottom:

1. **Toolbar:** "ONYVORE" title + plus (+) button (initialize new notebook) + rebuild button (rebuild viewed notebook's index).
2. **Notebook Selector:** Dropdown with typeahead filtering. Shown when more than one notebook exists. The selected notebook becomes the "viewed notebook."
3. **Search Bar:** Always visible (omnipresent). Searches the viewed notebook's full-text index, or all notebooks when the scope toggle is on. Arrow keys move through results, Enter opens the highlighted one, Escape clears. Results appear inline below the search field, each showing the note title, file path (using the shared `TreeItem` component), a match count badge, and **all matching text snippets** with highlighted search terms. Files with zero content matches are filtered out. Pressing Escape clears the search.
4. **File Tree:** Collapsible section showing the viewed notebook's files with progress bar during initialization/reconciliation.
5. **Unlinked Notes:** Collapsible section (collapsed by default) showing orphan notes in the viewed notebook.
The **Links Panel** is a separate view rather than another section of this list, so it can be collapsed, reordered, or dragged to the secondary sidebar — which is where a backlinks panel belongs while writing. It follows the **active note** (the editor), not the viewed notebook, and renders up to five sections: Links, Backlinks, Mentions, Mentioned By, and Related Notes, omitting any that are empty.

All tree-like lists (files, links, unlinked notes, search results) use a shared `TreeItem` component with label, sublabel (responsive — drops below label when sidebar is narrow), icon (`@vscode/codicons`), and optional badge. Sections use a shared `CollapsibleSection` component with inverted-color headers (foreground as background, vice versa).

### 6.4 Onboarding Flow
1.  **Initialize:** User clicks the plus (+) button in the sidebar toolbar, selects a directory via the native picker. Alternatively, runs `Onyvore: Initialize Notebook` from the Command Palette. Onyvore creates the `.onyvore/` metadata directory and begins a background scan. The new notebook auto-selects in the dropdown.
2.  **Search:** The omnipresent search bar provides instant, scoped access to the viewed notebook's contents.

### 6.5 Command Palette Highlights
* `Onyvore: Initialize Notebook` (Create a new notebook in a directory selected via the directory picker).
* `Onyvore: Discover Notebooks` (Re-scan the workspace for `.onyvore/` directories and register any newly discovered notebooks).
* `Onyvore: Search Notebook` (Focus the search bar, scoped to the viewed notebook. Results support arrow-key navigation and Enter to open; Escape clears).
* `Onyvore: Rebuild Notebook` (Delete all derived artifacts — `index.bin`, `links.json`, `metadata.json` — from `.onyvore/` and trigger a full re-index from scratch. Useful as a recovery mechanism if the index or link graph enters a bad state).

---

## 7. Comparison Analysis

| Feature | Joplin | Obsidian | **Onyvore** |
| :--- | :--- | :--- | :--- |
| **Storage** | SQLite DB | Markdown Files | **Markdown Files** |
| **Indexing** | Persistent DB | File Scan | **In-Memory (Orama)** |
| **Linking** | Manual | Manual (`[[wikilinks]]`) | **Wikilinks + automatic (NLP + similarity)** |
| **File Mutation** | Yes | Yes (frontmatter) | **None (sidecar metadata)** |
| **Multi-notebook workspace** | Single profile | One vault per window | **Multiple notebooks per workspace** |
| **Portability** | Moderate | High | **Maximum (Self-Contained)** |
| **External Authoring** | No | Limited | **Full (Open Directory)** |

### Key Distinctions: Onyvore vs. Obsidian

Obsidian is Onyvore's closest competitor. Both are markdown-first, file-based knowledge management tools. The following distinctions define Onyvore's core value proposition:

**1. Automatic linking in addition to manual wikilinks.**
Obsidian supports `[[wikilinks]]` and nothing else, so connections exist only where the user remembered to create them. Onyvore supports the same wikilinks — they are the most precise signal available, because a human authored them deliberately — and adds two computed layers on top: noun phrases matched against note titles, and whole-document similarity. Connections are discovered as well as authored. For large knowledge bases, this surfaces relationships manual linking would never capture, without giving up the ones worth stating explicitly.

**2. Zero file mutation vs. frontmatter injection.**
Obsidian injects YAML frontmatter into files and rewrites content when links are updated or files are renamed. Onyvore never touches user files. All metadata, links, and indexes are sidecar artifacts in `.onyvore/`. This makes Onyvore safe for environments where files are authored by multiple tools — AI agents, scripts, CI pipelines — because there is no risk of Onyvore's modifications conflicting with external writes.

**3. VS Code native vs. standalone application.**
Obsidian is a standalone Electron app with its own editor, plugin system, and window management. Onyvore runs inside VS Code, inheriting its full ecosystem — terminal, git integration, extensions, multi-root workspaces, remote development, and keyboard shortcuts. Users who already live in VS Code don't need to context-switch to a separate application for knowledge management.

**4. Multiple notebooks per workspace vs. one vault per window.**
Obsidian supports one vault per window. To work across multiple vaults, users must open multiple Obsidian windows. Onyvore supports multiple independent notebooks within a single VS Code workspace, with automatic active-notebook switching as the user moves between files.

**5. Agent-friendly by design.**
Obsidian's linking model assumes a human author creating `[[wikilinks]]` manually. AI agents and scripts would need to know Obsidian's link syntax, frontmatter conventions, and file mutation rules. Onyvore's open directory model requires nothing — an agent just writes a `.md` file to the directory, and Onyvore handles indexing, linking, and integration automatically. The zero-mutation guarantee means there are no conflicting writes between the extension and external tools.

---

## 8. Distribution Strategy
* **Universal VSIX:** A single bundle package.
* **Platform Support:** Functioning immediately on Windows, macOS, and Linux.
* **Zero Setup:** No external installation of Bun, SQLite, or CLI tools required.

---

## 9. Future Considerations
* **Multilingual NLP:** compromise is English-only. Multilingual noun-phrase extraction would require evaluating alternative pure-JS NLP libraries or a pluggable extraction backend.
