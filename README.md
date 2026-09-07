# Onyvore

Local-first personal knowledge management for VS Code.

Your notes stay ordinary markdown files in ordinary directories. Onyvore adds search, an automatic link graph, and editor support around them — and never writes to your files.

## What it does

A **notebook** is any directory containing an `.onyvore/` folder. One VS Code workspace can hold many, each with its own isolated index and link graph, nested like `.git` repositories.

- **Search** across a notebook or the whole workspace, with a small query syntax including graph-aware operators (`links:`, `related:`, `is:orphan`).
- **Three kinds of link**, shown separately because they mean different things: `[[wikilinks]]` you wrote, notes whose titles you mentioned in prose, and notes with similar content.
- **Editor support** for wikilinks — completion, ctrl-click, hover previews, and warnings for links that point nowhere.
- **A graph view** of how the notebook connects.

## Why zero mutation matters

Onyvore never modifies a note. Everything it knows lives in `.onyvore/` as derived artifacts you can delete and regenerate.

That constraint is the product, not a limitation. It makes a notebook safe to point at a directory that agents, scripts, and CI also write to — there is no risk of Onyvore's edits colliding with theirs. It is also why a link broken by a rename is *reported* to you rather than silently repaired: the fix is offered as a quick action, and you apply it.

## Getting started

Open a folder in VS Code, open the Onyvore sidebar, and click **Initialize Notebook**. Onyvore indexes in the background; the notebook is usable immediately.

## Repository layout

Four Nx projects compose the extension:

| Project | Path | Role |
|---|---|---|
| `app-vscode-onyvore` | `apps/vscode/onyvore/` | Extension host — commands, webviews, file watching, editor providers |
| `app-stdio-onyvore` | `apps/stdio/onyvore/` | Child process — indexing, linking, search |
| `app-browser-onyvore` | `apps/browser/onyvore/` | React webview — sidebar, links panel, graph |
| `lib-isomorphic-onyvore` | `libs/isomorphic/onyvore/` | Shared types, constants, and the rules both processes must agree on |

Each has its own README covering that tier.

## Documentation

| Document | What it covers |
|---|---|
| [`readme/onyvore-prd.md`](readme/onyvore-prd.md) | What Onyvore does and why — behavior, semantics, roadmap, non-goals |
| [`readme/onyvore-architecture.md`](readme/onyvore-architecture.md) | How it is built — structure, message flow, per-service implementation |
| [`apps/vscode/onyvore/README.md`](apps/vscode/onyvore/README.md) | Extension host, and the search syntax reference |
| [`apps/stdio/onyvore/README.md`](apps/stdio/onyvore/README.md) | The indexing, linking, and search services |
| [`apps/browser/onyvore/README.md`](apps/browser/onyvore/README.md) | Webview components and state |
| [`libs/isomorphic/onyvore/README.md`](libs/isomorphic/onyvore/README.md) | Shared contracts, and why some logic is shared |
| [`apps/vscode/onyvore/PUBLISHING.md`](apps/vscode/onyvore/PUBLISHING.md) | Marketplace publishing setup |

## Development

```bash
npx nx build app-vscode-onyvore    # builds all three tiers
npx nx run-many -t test            # stdio server + shared library
npm run onyvore:vsix               # build and package the extension
npm run onyvore:install            # install the packaged VSIX locally
```

Tests live beside the code they cover. The stdio server and shared library are unit tested; the VS Code integration surface currently is not — see the roadmap in the PRD.

## License

MIT
