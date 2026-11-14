# AGENTS.md

Guidance for AI coding agents working in this repository. [README.md](README.md) describes the
features, the file layout and the main gotchas, so read it first and don't duplicate it here.

## What this is

A browser-only JSON viewer, editor and comparer. Angular 21, Angular Material and Monaco. There is
no backend: nothing is uploaded, saved files live in the browser, and share links are encoded into
the URL hash. Keep it that way.

## Commands

```bash
npm ci                          # install (CI uses this, so keep package-lock.json in sync)
npm start                       # dev server, http://localhost:4200
npm run build                   # production build -> dist/json-viewer/browser
npm test                        # unit tests (Vitest, watch mode)
npx ng test --watch=false       # unit tests once, as CI runs them
```

Before calling a task done, run the tests and the production build. CI runs both on every PR and on
pushes to `main`. There is no linter configured.

The build prints bundle-size budget warnings for the initial bundle and `app.scss`. They are
expected today and are not failures; don't treat them as a regression unless the build errors.

## Code conventions

- **NgModule, not standalone.** Components are declared in `src/app/app-module.ts`. A new component
  must be added to `declarations`, and any new Material module to `imports`.
- Component selectors use the `app` prefix. Each component has its own `.ts`, `.html` and `.scss`
  under `src/app/components/<name>/`.
- **Put logic in `src/app/utils/`** as plain, framework-free functions, with a `*.spec.ts` beside
  each file. Components stay thin and call into utils.
- **No zone.js.** State changed in a promise or timer isn't rendered until `markForCheck()` is
  called, so call it after async updates.
- TypeScript is `strict`, with `noImplicitOverride`, `noImplicitReturns` and
  `noPropertyAccessFromIndexSignature`. Templates are strictly type-checked.
- Formatting follows `.prettierrc` (100 columns, single quotes) and `.editorconfig` (2 spaces, final
  newline, no trailing whitespace). Some existing files aren't fully formatted, so don't reformat code you aren't
  changing.
- Use the existing code style, naming and folder structure. Don't introduce new patterns without
  discussing it first.

## Invariants that are easy to break

- **Tree rows have a fixed height.** The tree is virtually scrolled, so every row must be exactly
  `TREE_ROW_HEIGHT` px (`json-tree.component.ts`, `json-tree-node.component.scss`).
- **One path format everywhere** (`$`, `$.items[1].qty`, `$["a b"]`). Build paths with `childPath()`
  from `utils/json-utils.ts`. The tree, diff, JSONPath results and "Copy path" all rely on it.
- **Numbers are parsed losslessly** (`utils/json-parse.ts`). Large integers and long decimals must
  keep every digit through the tree, format, minify and compare, so don't round-trip documents
  through plain `JSON.parse` / `JSON.stringify` in those paths.
- **Edits keep the user's formatting.** `utils/json-edit.ts` changes only the edited part of the
  text. Don't replace that with re-serialising the whole document.
- **Header buttons** are styled in `app.scss` under `.app-header .header-actions` and override
  Material with `!important`. Check the result visually after changing them, including the narrow
  layout (below 768px, labels are hidden).

## Testing

- Tests are Vitest specs run through `ng test`, using jsdom and `fake-indexeddb`.
- Add or update a spec with every change to a util. UI-only style changes need a manual check in the
  running app.

## Git

- Work on a new branch, not on `main`. The default branch is `main`.
- Use conventional commit prefixes (`feat:`, `fix:`, `chore:`), a short subject, and keep each
  commit to one change.
- Don't commit generated output (`dist/`, `.angular/`) or the local `.claude/` folder.

## Deployment

Deployed on Vercel from `vercel.json`: static output in `dist/json-viewer/browser`, an SPA rewrite
that excludes `/vs/` (Monaco's assets), and cache headers for hashed bundles. Don't change the
rewrite without checking that Monaco still loads.
