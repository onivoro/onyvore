# Onyvore — orientation

A VS Code extension for local-first personal knowledge management. Notes are plain markdown; Onyvore never writes to them. Everything it derives lives in `.onyvore/` and can be deleted and rebuilt.

Built on the `@onivoro/server-vscode` three-tier architecture in an Nx monorepo.

## Read first

- `readme/onyvore-prd.md` — behavior and semantics, plus the roadmap and non-goals in §9
- `readme/onyvore-architecture.md` — structure, message flow, per-service detail

## Where things are

| Tier | Path | Holds |
|---|---|---|
| Extension host | `apps/vscode/onyvore/` | Commands, webview registration, file watching, wikilink editor providers |
| Stdio server | `apps/stdio/onyvore/` | NLP, search, link graph, persistence — all the real work |
| Webview | `apps/browser/onyvore/` | React UI; one bundle serves the sidebar, Links, and Graph views |
| Shared | `libs/isomorphic/onyvore/` | Types, constants, and pure rules both processes must agree on |

## Things that will bite you

- **Three edge types**, not one: `explicit` (wikilinks, directional), `mention` (noun phrase → title, directional, real counts), `similar` (TF-IDF, symmetric, stored both ways). `count` means different units per type. Orphan detection ignores `similar` on purpose.
- **Indexing is two-phase.** `registerDocument` for the whole batch, *then* `computeEdges`. TF-IDF needs corpus-wide document frequency and mention matching needs every title present, so computing edges mid-batch produces wrong answers.
- **Shared rules are shared for a reason.** Wikilink resolution, search text matching, and query parsing live in the isomorphic library because both processes need identical behavior. Reimplementing either side causes silent divergence — that is how highlights once landed on text the engine never matched.
- **Artifacts are versioned.** Changing a persisted shape means bumping `ARTIFACT_VERSION` or `INDEX_FORMAT_VERSION`; notebooks then rebuild rather than loading something unreadable.
- **`relativePath` is not in the search schema.** Orama keeps non-schema fields on the document, so the path returns with hits without `md` becoming a token every note shares.

## Build

```bash
npx nx build app-vscode-onyvore    # chains stdio + browser + host
npx nx run-many -t test            # app-stdio-onyvore, lib-isomorphic-onyvore
npm run onyvore:vsix               # package the VSIX
```
