# lib-isomorphic-onyvore

Shared constants and types imported by all three Onyvore tiers (VS Code extension host, stdio server, browser webview). This library contains zero runtime logic — only type definitions and constant values.

## Import Path

```typescript
import { onyvoreCommands, onyvoreRpcMethods, STOP_NOUNS } from '@onivoro/isomorphic-onyvore';
import type { Edge, NotebookInfo, FileEvent } from '@onivoro/isomorphic-onyvore';
```

The path mapping `@onivoro/isomorphic-onyvore` is defined in `tsconfig.base.json` and resolves to `libs/isomorphic/onyvore/src/index.ts`.

## Contents

### Constants

| File | Export | Purpose |
|---|---|---|
| `onyvore-commands.constant.ts` | `onyvoreCommands` | VS Code command palette command IDs (e.g. `onyvore.initializeNotebook`). These strings must match the `contributes.commands` entries in `apps/vscode/onyvore/package.json` and the `@CommandHandler()` decorator arguments in the extension host. |
| `onyvore-rpc-methods.constant.ts` | `onyvoreRpcMethods` | JSON-RPC method names for stdio server requests (e.g. `notebook.register`, `notebook.search`) and notifications (e.g. `notebook.indexUpdated`, `notebook.ready`). Used by `@StdioHandler()` decorators in the stdio server, `messageBus.sendRequest()` calls in the extension host, and Redux middleware dispatch in the browser. |
| `stop-nouns.constant.ts` | `STOP_NOUNS` | A `ReadonlySet<string>` of ~60 ultra-generic and domain-common English nouns filtered out during NLP extraction. These prevent over-linking on words like "time", "note", "file", etc. The list is not user-configurable. Used only by `NlpService` in the stdio server. |

### Types

| File | Exports | Used By |
|---|---|---|
| `notebook.types.ts` | `NotebookInfo`, `NotebookFileTree`, `NotebookFile` | Notebook metadata exchanged between server and webview. `NotebookInfo.status` drives progress indicators. |
| `edge.types.ts` | `Edge` | A single link graph edge (`source → target` with `noun` and `count`). Persisted in `links.json` and used for link panel display. |
| `metadata.types.ts` | `NoteMetadata`, `NotebookMetadata` | Per-file modification time tracking. `NotebookMetadata.files` is persisted as `metadata.json` and drives startup reconciliation. |
| `links-panel.types.ts` | `LinkEntry`, `LinksForNote` | Response shape for the `notebook.getLinks` RPC method. Contains outbound and inbound link arrays sorted by occurrence count. |
| `file-event.types.ts` | `FileEventType`, `FileEvent`, `FileEventBatch` | File watcher event payloads sent from the extension host to the stdio server via `notebook.fileEvent`. |

## Alignment Invariants

Changing a constant or type here affects all three tiers. When modifying:

- **Adding an RPC method**: Add to `onyvoreRpcMethods`, implement the `@StdioHandler` in `apps/stdio/onyvore`, and add the caller in the extension host or browser middleware.
- **Adding a command**: Add to `onyvoreCommands`, add the `@CommandHandler` in `apps/vscode/onyvore`, and add the `contributes.commands` entry in `apps/vscode/onyvore/package.json`.
- **Changing a type**: All consumers across the three tiers must be updated.
