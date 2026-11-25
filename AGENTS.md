# AGENTS.md

Guidance for AI coding agents working in this repository. [README.md](README.md) describes the
features, the file layout and the main gotchas, so read it first and don't duplicate it here.

## What this is

A browser-only JSON viewer, editor and comparer. Angular 22, Angular Material and Monaco. There is
no backend: nothing is uploaded, saved files live in the browser, and share links are encoded into
the URL hash. Keep it that way.

## Commands

```bash
npm ci                          # install (CI uses this, so keep package-lock.json in sync)
npm start                       # dev server, http://localhost:4200
npm run build                   # production build -> dist/json-viewer/browser
npm test                        # unit tests (Vitest, watch mode)
npx ng test --watch=false       # unit tests once, as CI runs them
npm run lint                    # ESLint (angular-eslint) over src/**/*.ts and templates
npm run lint:styles             # Stylelint over src/**/*.scss
npm run format:check            # Prettier check (npm run format fixes it)
npm run e2e                     # end-to-end tests (Playwright; `npx playwright install chromium` once)
```

Before calling a task done, run the tests, `npm run lint`, `npm run format:check` and the production
build, and `npm run lint:styles` if you changed a stylesheet. Run `npm run e2e` too if you changed UI behaviour.
CI runs the lint, the style lint, the format check, the unit tests and the build on every PR, plus the end-to-end tests in a separate job.

The build prints a bundle-size budget warning for the initial bundle (Monaco). It is expected today
and is not a failure; don't treat it as a regression unless the build errors. A component style
budget warning (over 12 kB) is new, so split the stylesheet into a child component instead.

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
  newline, no trailing whitespace). CI fails on unformatted code, so run `npm run format` before committing.
- **Styles:** use the tokens in `src/styles.scss` (`--accent`, `rgba(var(--accent-rgb), …)`,
  `--accent-hover`, `--color-error` / `-success` / `-warning`, `--font-mono`) and the theme
  colours on `.app-container` in `app.scss`, not raw hex values or `var()` fallbacks. Shared
  mixins (`icon-size()`, `center-icon`, `truncate`, `bar-header`) are in
  `src/styles/_mixins.scss`; `.flex-spacer` is a global utility.
  Customise Material with its `mat.*-overrides()` token mixins, not `!important`. Stylelint
  enforces the last two rules.
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
- **Header buttons** are styled in `components/app-header/app-header.component.scss` under
  `.app-header .header-actions` through
  Material's token mixins. `mat-toolbar` resets the outlined-button text colour on each button, so
  that token is set on the button itself. Check the result visually after changing them, including
  the narrow layout (below 768px, labels are hidden).

## Testing

- Tests are Vitest specs run through `ng test`, using jsdom and `fake-indexeddb`.
- Add or update a spec with every change to a util. UI-only style changes need a manual check in the
  running app.
- End-to-end tests are Playwright specs in `e2e/`. Seed documents with `openShared()` from
  `e2e/helpers.ts` rather than typing into Monaco.

## Git

- Work on a new branch, not on `main`. The default branch is `main`.
- Use conventional commit prefixes (`feat:`, `fix:`, `chore:`), a short subject, and keep each
  commit to one change.
- Don't commit generated output (`dist/`, `.angular/`) or the local `.claude/` folder.

## Deployment

Deployed on Vercel from `vercel.json`: static output in `dist/json-viewer/browser`, an SPA rewrite
that excludes `/vs/` (Monaco's assets), and cache headers for hashed bundles. Don't change the
rewrite without checking that Monaco still loads.
