# app-vscode-onyvore

VS Code extension host for Onyvore. This is the orchestrator — it spawns the stdio server, serves the React webview, registers command palette commands, manages file watchers, and tracks the active notebook. It does NOT run NLP, search, or link graph computation; all heavy processing is delegated to the stdio server child process.

## Search syntax

Everything narrows — terms, phrases, and filters all combine with AND.

| Syntax | Meaning | Example |
|---|---|---|
| `two words` | Both must match | `sourdough starter` |
| `"exact phrase"` | These words, in order | `"cold proof"` |
| `-word` | Exclude | `bread -banana` |
| `title:` | Match the title only | `title:sourdough` |
| `path:` | Match the path only | `path:recipes` |
| `in:folder/` | Inside a folder | `in:work/ retro` |
| `links:note` | Notes that link to that note | `links:hotsauce` |
| `related:note` | Notes similar to that note | `related:sourdough` |
| `is:orphan` | Notes nothing links to | `is:orphan in:archive/` |

The last three read Onyvore's link graph. `links:hotsauce` shows everything you wrote that references that note, without opening it; `is:orphan in:archive/` shows what in a folder is disconnected from everything else.

**How matching works.** Words match by prefix, so `ferment` finds "fermented"; nothing matches the middle of a word. Matching is case-insensitive and there is no stemming — `jogging` will not find a note that says `jog`. If no note matches every word, the search widens to any word and says so. If nothing matches at all, a single-character typo is forgiven on words of four characters or more.

Notes are found by their **filename** as well as their text, so searching `hotsauce` finds `hotsauce.md` whether or not the body says the word. Results show where the match happened.

`OR`, parentheses, and regular expressions are deliberately unsupported — Onyvore lives inside VS Code, where ripgrep is a keystroke away.

## Runtime

- Runs in the VS Code extension host (Node.js with access to the full `vscode` API)
- Built with Webpack; `vscode` is the only external (provided by the runtime)
- Bundles the stdio server (`dist/server/main.js`) and webview (`dist/webview/`) as assets
- Activated on `onStartupFinished` (see `package.json`)

## Entry Point

`src/main.ts` imports `reflect-metadata` (required by NestJS) and calls `createExtensionFromModule(OnyvoreExtensionModule)`, which exports `{ activate, deactivate }` for VS Code.

## Extension Module (`src/app/onyvore-extension.module.ts`)

The `@VscodeExtensionModule` decorator configures:

| Property | Value | Purpose |
|---|---|---|
| `name` | `'Onyvore'` | Display name |
| `serverScript` | `path.join(__dirname, 'server', 'main.js')` | Path to the bundled stdio server |
| `webviewViewType` | `'onyvore.webview'` | Must match `package.json` `contributes.views` ID |
| `createWebviewProvider` | `() => new OnyvoreWebviewProvider(...)` | Factory for the webview provider |
| `commandHandlerTokens` | `[OnyvoreCommandHandlerService]` | Services with `@CommandHandler` methods |
| `serverOutputChannel` | `{ name: 'Onyvore Server', showOnError: true }` | VS Code OutputChannel for server logs |

The `@Module` decorator registers every service as a provider. NestJS instantiates them eagerly, so services that only register VS Code providers still run their `onModuleInit`.

## Webview Provider (`src/app/classes/onyvore-webview-provider.class.ts`)

Extends `BaseWebviewProvider` with:
- `viewType = 'onyvore.webview'` — matches the sidebar view registration
- `webviewDistPath = 'webview'` — relative to `extensionPath`, resolves to the bundled React app
- Theme bridge injection via `generateVscodeThemeBridgeInjection()` — exposes VS Code CSS variables to the webview

## Services

### OnyvoreCommandHandlerService

Four `@CommandHandler` methods corresponding to `contributes.commands` in `package.json`:

| Command | Behavior |
|---|---|
| `onyvore.initializeNotebook` | Opens a directory picker, creates `.onyvore/` with its marker file, registers with the server, starts full initialization, sets up file watcher |
| `onyvore.discoverNotebooks` | Re-scans workspace for `.onyvore/` directories, registers any new notebooks, sets up file watchers |
| `onyvore.searchNotebook` | Sends `search.show` notification to the webview. Targets the notebook shown in the sidebar, falling back to the active one. |
| `onyvore.rebuildNotebook` | Confirmation dialog, then sends `notebook.rebuild` to the server. Targets the notebook shown in the sidebar, falling back to the active one. |

Injects: `VSCODE_API`, `MESSAGE_BUS`, `WEBVIEW_PROVIDER`, `NotebookDiscoveryService`, `ActiveNotebookService`, `FileWatcherService`.

### OnyvoreWebviewHandlerService

Five `@WebviewHandler` methods handling messages from the React webview:

| Method | Behavior |
|---|---|
| `openFile` | Resolves notebook root + relative path → `vscode.window.showTextDocument()` |
| `pickDirectory` | Opens `vscode.window.showOpenDialog()` with folder selection |
| `getActiveNotebook` | Returns current notebook ID and active note path |
| `getConfiguration` | Reads VS Code configuration values |
| `getWorkspaceFolders` | Returns workspace folder paths |

Requests from the webview are routed here first; if no `@WebviewHandler` matches, they pass through to the stdio server (e.g. `notebook.search`, `notebook.getLinks`).

### OnyvoreServerNotificationHandlerService

Four `@ServerNotificationHandler` methods for notifications sent from the stdio server:

| Notification | Behavior |
|---|---|
| `notebook.initProgress` | Shows initialization progress in the status bar |
| `notebook.reconcileProgress` | Shows reconciliation progress in the status bar |
| `notebook.ready` | Shows "Notebook ready" in the status bar |
| `notebook.indexUpdated` | No-op in extension host (auto-broadcast to webview by framework) |

All server notifications are automatically broadcast to the webview by the framework, so the webview's Redux middleware also receives them.

### NotebookDiscoveryService

Implements `OnModuleInit` — runs `discoverNotebooks()` on extension activation.

- **Discovery**: `findFiles('**/.onyvore/**')` locates any file inside a `.onyvore/` directory, and the notebook root is derived from the path. Matching the directory rather than one artifact matters because every artifact is derived — `Rebuild` deletes them all — and keying on `metadata.json` made a rebuilt notebook undiscoverable on the next reload. Each discovered notebook is registered via `notebook.register` and then reconciled. Notebooks predating the marker file get `.onyvore/notebook.json` backfilled.
- **Initialization**: Creates `.onyvore/` and writes `notebook.json` — the one file there that is not derived — then registers the notebook and triggers `notebook.initialize`.
- **File resolution**: `findNotebookForFile(filePath)` determines which notebook owns a file by finding the deepest matching notebook root that isn't blocked by a nested notebook boundary. Used by `ActiveNotebookService`.

### ActiveNotebookService

Implements `OnModuleInit` and `OnModuleDestroy`.

- Listens to `vscode.window.onDidChangeActiveTextEditor`
- When the focused file changes, resolves which notebook owns it via `NotebookDiscoveryService.findNotebookForFile()`
- Only tracks `.md` files. Focusing a non-markdown document clears the active note so the Links Panel says "Open a note to see its links" rather than showing stale links; losing focus entirely (command palette, terminal) preserves state
- Also records which notebook the sidebar is showing (`setViewedNotebook`), so the Search and Rebuild commands target the same notebook as the sidebar's own buttons
- Updates a status bar item showing the active notebook name (or "No Notebook")
- Sends `activeNotebook.changed` notification to the webview via the message bus

### NotebookFilesService

Caches each notebook's file list, refreshed on `notebook.ready` and `notebook.indexUpdated`. The editor features need the list synchronously and on every keystroke, so round-tripping to the stdio server per request is not viable.

### OnyvoreSettingsService

Reads `onyvore.*` settings. Graph-shaping ones (`relatedNotes.*`) are pushed to the server via `server.configure` on activation and on change; host-only ones (`fileWatcher.debounceMs`, `wikilinks.showUnresolved`) are exposed as getters.

### WikilinkFeaturesService

Registers completion, document-link, and hover providers for markdown files. Resolution comes from the shared isomorphic helpers — the same ones the stdio server uses to build the link graph — so where the editor navigates and where the graph drew an edge cannot disagree.

### WikilinkDiagnosticsService

Reports wikilinks that resolve to nothing as warnings, and provides quick fixes: create the missing note, or repoint the link at an existing note with a similar name. Refreshes on document change, configuration change, and `notebook.indexUpdated`.

This is how renames are handled. Onyvore never rewrites user files, so a link broken by a rename is surfaced rather than silently repaired, and the quick fix applies the edit as the user's action.

### SecondaryViewsService

Registers the Links (`onyvore.links`) and Graph (`onyvore.graph`) webview views. The extension framework wires exactly one webview provider, so these are registered directly: requests reuse the exported `defaultWebviewMessageHandler`, and the three notifications these panels need are forwarded explicitly, since the framework's broadcast reaches only the primary provider.

All views render the same bundle; `OnyvoreSecondaryWebviewProvider` injects `window.__ONYVORE_VIEW__` to say which one it is.

### FileWatcherService

Creates one `vscode.FileSystemWatcher` per registered notebook with glob `**/*.md`.

**Event handling:**
1. Check if file is inside a nested notebook (discard if so)
2. Check if file matches `.onyvoreignore` patterns (discard if so)
3. Skip `.onyvore/` directory contents
4. Buffer event in a per-notebook `pending` map (later events for the same path supersede earlier ones)
5. After the debounce window (`onyvore.fileWatcher.debounceMs`, default 300ms), flush the batch to the stdio server via `notebook.fileEvent`

Also watches each notebook's `.onyvoreignore`. On change it refreshes its local copy — so live events stop flowing for newly-ignored paths — and sends `notebook.ignoreChanged` with just the notebook id. The server owns the authoritative filter and re-runs reconciliation to apply the new rules to files already on disk.

## VS Code Manifest (`package.json`)

**Critical alignment points:**
- `contributes.commands[*].command` must match `onyvoreCommands` constants and `@CommandHandler()` strings
- `contributes.views.onyvore[0].id` (`onyvore.webview`) must match `OnyvoreWebviewProvider.viewType`
- `main` (`./dist/main.js`) must match the webpack output entry
- `repository` field is required or `vsce package` will prompt interactively

## Build

```bash
# Build all three tiers (stdio + browser are built first via dependsOn)
nx build app-vscode-onyvore

# Package as VSIX
nx package app-vscode-onyvore
# Output: apps/vscode/onyvore/onyvore.vsix

# Install locally
code --install-extension apps/vscode/onyvore/onyvore.vsix
```

## Key Dependencies

| Package | Purpose |
|---|---|
| `@onivoro/server-vscode` | `createExtensionFromModule`, `@VscodeExtensionModule`, `@CommandHandler`, `@WebviewHandler`, `@ServerNotificationHandler`, `BaseWebviewProvider`, `VSCODE_API`, `WEBVIEW_PROVIDER` |
| `@onivoro/isomorphic-jsonrpc` | `MESSAGE_BUS`, `MessageBus` |
| `@onivoro/isomorphic-onyvore` | Command constants, RPC method constants, shared types |
| `@nestjs/common` | `@Injectable`, `@Inject`, `@Module`, `OnModuleInit` |
| `reflect-metadata` | NestJS decorator metadata (must be imported before anything else) |
| `ignore` | `.onyvoreignore` glob pattern matching (gitignore-compatible) |
