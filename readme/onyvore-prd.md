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
* **Links Panel:** A dedicated sidebar panel for the active note, divided into two sections:
  * **Outbound Links:** Notes that the active note links *to* (noun phrases extracted from this note matched a target note's title). Clicking an entry navigates to the target note. Each entry shows the top matching noun phrase and aggregate occurrence count (e.g., "hotsauce (5 mentions) → hotsauce.md").
  * **Inbound Links (Backlinks):** Notes that link *to* the active note (other notes contain noun phrases matching this note's title). Each entry shows the source note, top matching noun phrase, and aggregate occurrence count (e.g., "recipes.md — hotsauce (5 mentions)"). Clicking navigates to the source note.
  Both sections are ranked by aggregate occurrence count (most mentions first). This provides bidirectional navigation — users can discover what the current note references and what references it.
  When no markdown file is focused (non-markdown file open, no file open, or file is unmanaged), the Links Panel displays: "Open a note to see its links."
* **Orphan Detection:** Notes with zero inbound and outbound links are surfaced as an "Unlinked Notes" section within the Notebook Sidebar, below the notebook's file tree. This keeps orphan discovery in the same context as notebook navigation. Computed directly from the link graph at zero additional cost.

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
* **Fuzzy Matching:** Instant results for keyword and partial matches across the active notebook. Search queries match against the note title, file path, and content — so searching "work overview" preferentially surfaces `work/overview.md` over `personal/overview.md`.
* **Graph-Boosted Ranking:** Search results are boosted by link graph centrality. Notes with more inbound links rank higher, surfacing well-connected notes above isolated ones with the same keyword relevance. The formula is: `finalScore = oramaScore * (1 + log2(1 + inboundLinkCount))`. Results with zero content matches (matched only by title fuzzy matching) are filtered out.
* **Snippet Previews:** Each search result includes **all matching text snippets** — ~120-character windows around every occurrence of the search terms in the document. Nearby matches are merged into single longer snippets. Search terms are highlighted within snippets. The match count is displayed as a badge on each result.
* **Persistence:** All derived artifacts (`index.bin`, `links.json`, `metadata.json`) are written to disk on two triggers: after each debounced batch of incremental updates completes, and on extension deactivation (exit). This ensures a VS Code crash loses at most one debounce window (~300ms) of work. The persisted `index.bin` allows sub-100ms startup for large notebooks (10,000+ notes).

### 4.4 Automatic Linking
Onyvore computes a link graph between notes within each notebook using deterministic noun-phrase extraction. The link graph and search index are intentionally separate pipelines — full-text search is broad and forgiving, while the link graph is selective and precise. The link graph feeds into search ranking (see Section 4.3) but does not constrain what is indexed. Links do not cross notebook boundaries.

**v1 is English-only.** The NLP library (compromise) supports English noun-phrase extraction. Multilingual support is a future consideration.

#### Trigger Model
The link graph is updated via file watcher events (Section 4.2). Any filesystem change — whether from the extension, an external agent, or manual editing — triggers an incremental update. There is no separate "index operation" trigger; the file watcher is the single event source for both the search index and the link graph.

#### Initial Notebook Computation
On first initialization (or when `.onyvore/` is absent/deleted), the full notebook must be scanned to build the search index, extract all noun phrases, and generate the link graph. This is a materially heavier operation than incremental updates and is handled as a **non-blocking background process:**

1. **Immediate availability:** The Notebook Sidebar and file editing are available immediately. The notebook is usable before initialization completes.
2. **Progressive search and links:** Both the search index and link graph are populated incrementally as files are processed. Search, outbound links, and backlinks work immediately but return partial results until the scan completes. A status bar indicator shows initialization progress.
3. **File watcher active during init:** Files created or modified during initialization are queued and processed after the initial scan completes, ensuring no changes are lost.

Derived artifacts are persisted periodically during the initial scan (e.g., every N files processed). If VS Code crashes mid-initialization, the next startup enters the normal reconciliation path — `metadata.json` already tracks which files have been processed, so only the remaining files are scanned. The exact batching, concurrency, and memory management for the background computation pipeline require further design consideration beyond this specification.

#### Startup Reconciliation
When the extension activates and a notebook's `.onyvore/` directory already exists (i.e., not a first-time initialization), the persisted index and link graph may be stale — files could have been created, modified, or deleted while the extension was not running (e.g., by an AI agent, a script, or manual editing). Onyvore reconciles the persisted state against the current filesystem on every startup:

1. **Load persisted state:** `index.bin`, `links.json`, and `metadata.json` are loaded from disk. Search and backlinks are immediately available using the persisted (potentially stale) data.
2. **Diff against filesystem:** Onyvore compares the current filesystem state against `metadata.json` (which tracks known files and their last-seen modification times):
   * **New files** (on disk but not in metadata) → processed via the Create path (index, extract, link).
   * **Modified files** (modification time newer than recorded in metadata) → processed via the Change path (re-index, re-extract, rebuild edges).
   * **Deleted files** (in metadata but no longer on disk) → processed via the Delete path (remove from index, metadata, and link graph; prune dangling backlinks).
3. **Non-blocking:** Reconciliation runs as a background process using the same progressive model as initial computation. The notebook is fully usable during reconciliation — search and backlinks serve persisted data immediately, with corrections applied incrementally as diffs are processed.
4. **File watcher starts immediately:** Real-time changes made during reconciliation are queued and processed after reconciliation completes.

#### NLP Behavior (compromise)
Compromise is the pure-JS NLP library used for noun phrase extraction. Its behavior has been empirically tested (see `tools/scripts/compromise-test.ts`) and the following characteristics inform the pipeline design:

* **Unknown words default to nouns.** Made-up words (e.g., "onyvore") are reliably tagged as nouns regardless of casing or sentence position. Compromise does not require words to be in a dictionary.
* **Casing does not affect extraction.** Both "Onyvore" and "onyvore" are extracted as nouns. Capitalized unknown words may additionally be tagged as ProperNouns, but extraction succeeds either way.
* **Noun phrase grouping is greedy.** Compromise groups adjacent nouns into a single phrase. "onyvore search engine" is extracted as one phrase, not three separate nouns. This must be handled in the matching step (see below).
* **Gerunds are excluded.** Words like "indexing" and "working" are tagged as verbs (Gerund), not nouns. This is desirable — it reduces noise.
* **Hyphenated compounds are decomposed.** "machine-learning" is split into "machine" and "learning," both tagged as nouns.

#### Extraction Pipeline
1. **Parse:** Note content is processed through compromise to extract noun phrases.
2. **Decompose:** Multi-word noun phrases are retained as-is and also decomposed into individual words. For example, "onyvore search engine" produces four candidates: "onyvore search engine" (full phrase), "onyvore", "search", "engine". A 4-word phrase like "onyvore search engine architecture" produces five candidates: the full phrase plus each individual word. No intermediate sub-spans are generated. Single-word phrases are not decomposed.
3. **Filter — Stop Nouns:** All candidates (full phrases and individual words from decomposition) are filtered against a built-in static list of ~50-100 common nouns. Individual words from a decomposed phrase are filtered independently — e.g., "change management" decomposes to "change management", "change", "management"; "change" is removed by the stop list while "change management" (full phrase) and "management" survive. This list covers ultra-generic nouns (e.g., "time," "way," "thing," "part," "people," "day," "year," "example," "case," "place," "point," "fact," "hand," "end," "line," "number," "group," "area," "world," "work," "state," "system," "program," "question," "problem," "issue," "use," "kind," "sort," "type," "form," "set," "list," "level," "side," "head," "home," "office," "room," "result," "change," "order," "idea") as well as domain-common terms that would over-link in typical notebooks (e.g., "note," "file," "page," "document," "section," "item," "entry," "record," "version," "name," "title," "link," "tag," "folder," "draft"). The list is not user-configurable.
4. **Filter — Minimum Length:** Single-character tokens and single-letter words are excluded.

#### Matching
Surviving noun phrases are matched **case-insensitively** against **note titles** registered in the title index. Each file registers multiple title variants:
* **Basename title:** The file's basename without the `.md` extension (e.g., `overview` for `overview.md`).
* **Path-qualified title:** For files in subdirectories, the parent directory name followed by the basename (e.g., `work overview` for `work/overview.md`). Root-level files do not register a path-qualified title.

This disambiguates files that share the same basename across different directories. A noun phrase like "work overview" matches only `work/overview.md`, not `personal/overview.md`. The unqualified basename "overview" still matches both, producing edges to both — which is correct when the source note mentions the concept generically.

Only titles are match targets — if a concept is important enough to be linked to, it should be its own note. This encourages atomic note-taking and produces fewer false positives.

A match produces an edge in the link graph. **Self-links are excluded** — a note's own title is not a valid match target for noun phrases extracted from that same note.

#### Edge Structure
There is one edge per unique (source, target) pair. If multiple noun phrases from the same source note match the same target (e.g., "sourdough" as a direct extraction and as a constituent of "sourdough starter" both matching `sourdough.md`), their counts are summed into a single edge. The `noun` field stores the phrase with the highest individual count (for display in the Links Panel).

```json
{ "source": "note-a.md", "target": "note-b.md", "noun": "sourdough", "count": 8 }
```

Aggregate occurrence count is used to rank links — notes with more mentions surface first in the Links Panel.

### 4.5 Metadata
Onyvore derives metadata for each note and stores it in `metadata.json`. Metadata is computed from filesystem state:
* **Last-seen modification time:** Used by startup reconciliation (Section 4.4) to detect files changed while the extension was not running.

---

## 5. Technical Architecture

### 5.1 Data Persistence (`.onyvore/` Folder)
Each notebook contains a `.onyvore/` directory with:
* `index.bin`: A serialized binary snapshot of the Orama search index.
* `links.json`: The computed link graph between all notes in the notebook.
* `metadata.json`: Derived metadata for each note (last-seen modification time for reconciliation). See Section 4.5.

All files in `.onyvore/` are derived artifacts. They can be deleted and fully regenerated from the notebook's `.md` files.

### 5.2 `.onyvoreignore`
Users can create a `.onyvoreignore` file in the notebook root (as a sibling of `.onyvore/`) to exclude paths from indexing, linking, and file watching. Paths in the file are relative to the notebook root. The syntax follows `.gitignore` conventions (glob patterns, `#` comments, `!` negation). Each notebook's `.onyvoreignore` is self-contained — a parent notebook's ignore file does not propagate into nested notebooks.

`.onyvoreignore` is user-authored and is not a derived artifact — it is not stored in `.onyvore/` and is not affected by `Onyvore: Rebuild Notebook`. The file watcher monitors `.onyvoreignore` for changes. When the file is modified, Onyvore re-evaluates all files against the new patterns: newly-ignored files are removed from the index and link graph; newly-included files are processed via the Create path. This is equivalent to a targeted partial rebuild.

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

### 5.3 Technology Stack
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
3. **Search Bar:** Always visible (omnipresent). Searches the viewed notebook's full-text index. Results appear inline below the search field, each showing the note title, file path (using the shared `TreeItem` component), a match count badge, and **all matching text snippets** with highlighted search terms. Files with zero content matches are filtered out. Pressing Escape clears the search.
4. **File Tree:** Collapsible section showing the viewed notebook's files with progress bar during initialization/reconciliation.
5. **Unlinked Notes:** Collapsible section (collapsed by default) showing orphan notes in the viewed notebook.
6. **Links Panel:** Collapsible sections for outbound links and backlinks of the **active note** (from the active notebook, which follows editor focus).

All tree-like lists (files, links, unlinked notes, search results) use a shared `TreeItem` component with label, sublabel (responsive — drops below label when sidebar is narrow), icon (`@vscode/codicons`), and optional badge. Sections use a shared `CollapsibleSection` component with inverted-color headers (foreground as background, vice versa).

### 6.4 Onboarding Flow
1.  **Initialize:** User clicks the plus (+) button in the sidebar toolbar, selects a directory via the native picker. Alternatively, runs `Onyvore: Initialize Notebook` from the Command Palette. Onyvore creates the `.onyvore/` metadata directory and begins a background scan. The new notebook auto-selects in the dropdown.
2.  **Search:** The omnipresent search bar provides instant, scoped access to the viewed notebook's contents.

### 6.5 Command Palette Highlights
* `Onyvore: Initialize Notebook` (Create a new notebook in a directory selected via the directory picker).
* `Onyvore: Discover Notebooks` (Re-scan the workspace for `.onyvore/` directories and register any newly discovered notebooks).
* `Onyvore: Search Notebook` (Focus the search bar, scoped to the viewed notebook).
* `Onyvore: Rebuild Notebook` (Delete all derived artifacts — `index.bin`, `links.json`, `metadata.json` — from `.onyvore/` and trigger a full re-index from scratch. Useful as a recovery mechanism if the index or link graph enters a bad state).

---

## 7. Comparison Analysis

| Feature | Joplin | Obsidian | **Onyvore** |
| :--- | :--- | :--- | :--- |
| **Storage** | SQLite DB | Markdown Files | **Markdown Files** |
| **Indexing** | Persistent DB | File Scan | **In-Memory (Orama)** |
| **Linking** | Manual | Manual (`[[wikilinks]]`) | **Automatic (NLP-computed)** |
| **File Mutation** | Yes | Yes (frontmatter) | **None (sidecar metadata)** |
| **Multi-notebook workspace** | Single profile | One vault per window | **Multiple notebooks per workspace** |
| **Portability** | Moderate | High | **Maximum (Self-Contained)** |
| **External Authoring** | No | Limited | **Full (Open Directory)** |

### Key Distinctions: Onyvore vs. Obsidian

Obsidian is Onyvore's closest competitor. Both are markdown-first, file-based knowledge management tools. The following distinctions define Onyvore's core value proposition:

**1. Automatic linking vs. manual wikilinks.**
Obsidian requires users to explicitly create `[[wikilinks]]` between notes. This means connections only exist where the user remembered to create them. Onyvore computes links automatically using NLP — every note is analyzed for noun phrases and matched against note titles across the notebook. Connections are discovered, not authored. For large knowledge bases, this surfaces relationships that manual linking would never capture.

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
* **Link Graph Visualization:** With the computed link graph already in place, a read-only force-directed graph view (via a VS Code Webview) is a natural addition. The data layer exists; only the rendering is needed.
* **Multilingual NLP:** compromise is English-only. Multilingual noun-phrase extraction would require evaluating alternative pure-JS NLP libraries or a pluggable extraction backend.
* **Cross-Notebook Search:** A workspace-level search that spans all notebooks, with results grouped by notebook. Requires aggregating across independent indexes.
