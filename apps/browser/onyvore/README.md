# app-browser-onyvore

React webview rendered inside VS Code's sidebar panel. Displays notebook navigation, link panels, orphan detection, and search. All data comes from the stdio server via JSON-RPC through a Redux message bus middleware.

## Runtime

- Runs inside a VS Code webview iframe (browser context, no Node.js APIs)
- Communicates with the extension host via `postMessage` (bridged by `@onivoro/browser-jsonrpc`)
- Requests that need server-side processing pass through the extension host to the stdio server transparently
- Built with Vite, output to `dist/apps/browser/onyvore/` which the extension host bundles into `dist/webview/`

## Entry Point

`src/main.tsx` renders the React app wrapped in Redux `Provider`, MUI `ThemeProvider`, and `BrowserRouter`.

## State Management

### Redux Store (`src/app/state/store.ts`)

Uses `@reduxjs/toolkit` with `buildReducers()` from `@onivoro/browser-redux`. Six slices are registered:

| Slice | Purpose |
|---|---|
| `jsonRpcRequestEntitySlice` | Entity adapter for outgoing JSON-RPC requests. The message bus middleware intercepts `setOne` actions. |
| `jsonRpcResponseEntitySlice` | Entity adapter for incoming JSON-RPC responses. Keyed by request ID for lookup. |
| `notebooks` | Notebook list with file trees and status. Updated on initial load and `notebook.indexUpdated` notifications. |
| `activeNotebook` | Current notebook ID and active note relative path. Updated by `activeNotebook.changed` notifications from the extension host. |
| `links` | Outbound and inbound links for the active note. Refreshed on active note change. |
| `searchResults` | Search query, results array, visibility toggle. Drives the `SearchOverlay` component. |

### Message Bus Middleware (`src/app/state/middleware/message-bus.middleware.ts`)

The bridge between Redux and JSON-RPC:

1. Intercepts `jsonRpcRequestEntitySlice.actions.setOne` dispatches
2. Sends the request via `WebviewMessageBus` to the extension host
3. On response, dispatches to `jsonRpcResponseEntitySlice`

Also listens for server notifications and dispatches appropriate slice actions:
- `notebook.indexUpdated` → triggers notebook list refresh
- `notebook.initProgress` / `notebook.reconcileProgress` → updates notebook status
- `notebook.ready` → sets notebook status to ready
- `activeNotebook.changed` → updates active notebook state

### useRpc Hook (`src/app/hooks/use-rpc-request.hook.ts`)

Convenience hook used by all components:
- `sendRequest({ method, params })` — dispatches a request action, returns a request ID
- `lookupResponse(id)` — retrieves the response for a given request ID from the entity store

## Components

### NotebookSidebar

Top-level sidebar component. Fetches the notebook list via `notebook.getNotebooks` on mount and when the `loading` flag is set by `indexUpdated` notifications. Renders one `NotebookTree` and one `UnlinkedNotes` per notebook.

### NotebookTree

Renders a single notebook's file tree as a flat MUI `List`. Each file entry shows the basename (and subdirectory path if nested). Clicking a file dispatches an `openFile` request handled by the extension host's `@WebviewHandler`, which calls `vscode.window.showTextDocument()`. Shows a progress bar during initialization/reconciliation.

### UnlinkedNotes

Fetches orphan notes (zero inbound + outbound links) via `notebook.getOrphans` for a given notebook. Renders below the notebook's file tree with a "link off" icon. Hidden when there are no orphans.

### LinksPanel

Displays outbound and inbound links for the active note. Subscribes to `activeNotebook.notebookId` and `activeNotebook.activeNotePath` from Redux. When both are present, fetches links via `notebook.getLinks`. When no markdown file is active, shows "Open a note to see its links."

Contains two sub-components:

### OutboundLinks

Renders notes that the active note links *to*. Each entry shows the target note title and the top matching noun phrase with aggregate count (e.g. "sourdough (5)"). Clicking navigates to the target note.

### InboundLinks

Renders notes that link *to* the active note (backlinks). Same display format as OutboundLinks but showing source notes.

### SearchOverlay

Absolute-positioned overlay triggered by the `Onyvore: Search Notebook` command. Features:
- Text input with debounced search via `notebook.search`
- Result list with title and relative path
- Clicking a result opens the file and closes the overlay
- Escape key closes the overlay
- Disabled when no active notebook

## Key Dependencies

| Package | Purpose |
|---|---|
| `react`, `react-dom` | UI framework |
| `@reduxjs/toolkit`, `react-redux` | State management |
| `@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled` | Component library |
| `@onivoro/browser-jsonrpc` | `createWebviewMessageBus()`, `WebviewMessageBus` for postMessage transport |
| `@onivoro/browser-redux` | `createEntitySlice()`, `buildReducers()` for Redux entity adapters |
| `@onivoro/isomorphic-jsonrpc` | `JsonRpcRequest`, `JsonRpcResponse` types |
| `@onivoro/isomorphic-onyvore` | RPC method constants, shared types |
| `uuid` | Generates unique request IDs |
