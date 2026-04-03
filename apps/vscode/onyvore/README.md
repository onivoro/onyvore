# app-vscode-onyvore

VS Code extension host for Onyvore. This is the orchestrator — it spawns the stdio server, serves the React webview, registers command palette commands, manages file watchers, and tracks the active notebook. It does NOT run NLP, search, or link graph computation; all heavy processing is delegated to the stdio server child process.

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

The `@Module` decorator registers all six services as providers.

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
| `onyvore.initializeNotebook` | Opens a directory picker, creates `.onyvore/`, registers with the server, starts full initialization, sets up file watcher |
| `onyvore.discoverNotebooks` | Re-scans workspace for `.onyvore/` directories, registers any new notebooks, sets up file watchers |
| `onyvore.searchNotebook` | Sends `search.show` notification to the webview (which renders the `SearchOverlay`). Requires an active notebook. |
| `onyvore.rebuildNotebook` | Confirmation dialog, then sends `notebook.rebuild` to the server. Requires an active notebook. |

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

- **Discovery**: Uses `vscode.workspace.findFiles('**/.onyvore')` to locate notebooks. Registers each with the stdio server via `notebook.register`, then triggers `notebook.reconcile`.
- **Initialization**: Creates the `.onyvore/` directory, registers the notebook, triggers `notebook.initialize`.
- **File resolution**: `findNotebookForFile(filePath)` determines which notebook owns a file by finding the deepest matching notebook root that isn't blocked by a nested notebook boundary. Used by `ActiveNotebookService`.

### ActiveNotebookService

Implements `OnModuleInit` and `OnModuleDestroy`.

- Listens to `vscode.window.onDidChangeActiveTextEditor`
- When the focused file changes, resolves which notebook owns it via `NotebookDiscoveryService.findNotebookForFile()`
- Only tracks `.md` files — non-markdown files or unmanaged files result in no active notebook
- Updates a status bar item showing the active notebook name (or "No Notebook")
- Sends `activeNotebook.changed` notification to the webview via the message bus

### FileWatcherService

Creates one `vscode.FileSystemWatcher` per registered notebook with glob `**/*.md`.

**Event handling:**
1. Check if file is inside a nested notebook (discard if so)
2. Check if file matches `.onyvoreignore` patterns (discard if so)
3. Skip `.onyvore/` directory contents
4. Buffer event in a per-notebook `pending` map (later events for the same path supersede earlier ones)
5. After 300ms debounce, flush the batch to the stdio server via `notebook.fileEvent`

Also watches each notebook's `.onyvoreignore` file. On change, reloads the ignore patterns and sends `notebook.ignoreChanged` to the server.

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
