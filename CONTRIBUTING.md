# Contributing to JSON Viewer

Thanks for taking the time to help. Bug reports, ideas, documentation fixes and code are all
welcome.

JSON Viewer is a browser-only app: there is no backend, nothing is uploaded, saved files live in the
browser and share links are encoded into the URL hash. Contributions need to keep it that way.

## Ways to contribute

- **Report a bug**: open an issue with the *Bug report* form. A small JSON sample (with anything
  private removed) and the steps to reproduce it help most.
- **Suggest a feature**: open an issue with the *Feature request* form and describe the problem
  you want solved, not only the solution.
- **Report a security problem**: don't open a public issue. See [SECURITY.md](SECURITY.md).
- **Send a pull request**: for anything bigger than a small fix, open an issue first so we can agree
  on the approach before you spend time on it.

## Getting started

You need Node.js 26 (the version CI uses) and npm.

```bash
git clone https://github.com/<your-username>/json-viewer.git
cd json-viewer
npm ci
npm start                         # http://localhost:4200
```

| Command | What it does |
|---|---|
| `npm start` | Dev server at http://localhost:4200 |
| `npm run build` | Production build in `dist/json-viewer/browser` |
| `npm test` | Unit tests (Vitest) in watch mode |
| `npx ng test --watch=false` | Unit tests once, as CI runs them |
| `npm run lint:styles` | Stylelint over `src/**/*.scss` |
| `npm run e2e` | End-to-end tests (Playwright). Run `npx playwright install chromium` once first |

The build prints a bundle-size budget warning for the initial bundle (Monaco). That is expected and
not a failure.

The [README](README.md) explains the features, the source layout and the main gotchas. Read its
*Development* section before changing code.

## Making a change

1. Fork the repository and create a branch from `main`, for example `fix/tree-scroll` or
   `feat/csv-import`.
2. Make your change, keeping it focused on one thing.
3. Add or update tests (see below).
4. Run the checks:
   ```bash
   npx ng test --watch=false
   npm run build
   npm run lint:styles   # if you changed a stylesheet
   npm run e2e           # if you changed UI behaviour
   ```
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/) and open a pull
   request against `main`. The pull request template has a short checklist.

### Commit messages

Use a conventional prefix and a short subject in the imperative mood:

```
feat: add CSV import to the table view
fix: keep cursor position after format
docs: explain JSONPath filters in the README
chore: bump monaco-editor
```

Common prefixes are `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci` and `perf`. Keep each
commit to one change. The prefixes also set the next version (see "Releases and versioning" in the
README), so mark breaking changes with `!` (`feat!: ...`) or a `BREAKING CHANGE:` footer.

## Code conventions

- **NgModule, not standalone.** Components are declared in `src/app/app-module.ts`. Add a new
  component to `declarations`, and any new Material module to `imports`.
- Component selectors use the `app` prefix. Each component has its own `.ts`, `.html` and `.scss`
  under `src/app/components/<name>/`.
- **Logic goes in `src/app/utils/`** as plain, framework-free functions, with a `*.spec.ts` beside
  each file. Components stay thin and call into utils.
- **No zone.js.** State changed in a promise or timer isn't rendered until `markForCheck()` is
  called.
- TypeScript is `strict`, and templates are strictly type-checked.
- Formatting follows `.prettierrc` (100 columns, single quotes) and `.editorconfig` (2 spaces, final
  newline). Don't reformat code you aren't changing.
- **Styles:** use the design tokens in `src/styles.scss` and the mixins in
  `src/styles/_mixins.scss` instead of raw hex values. Customise Angular Material with its
  `mat.*-overrides()` token mixins, not `!important`. Stylelint enforces this.
- Don't add new dependencies without discussing it in an issue first.

### Things that are easy to break

- **Tree rows have a fixed height.** The tree is virtually scrolled, so every row must be exactly
  `TREE_ROW_HEIGHT` px.
- **One path format everywhere** (`$`, `$.items[1].qty`, `$["a b"]`). Build paths with
  `childPath()` from `utils/json-utils.ts`.
- **Numbers are parsed losslessly** (`utils/json-parse.ts`). Don't round-trip documents through
  plain `JSON.parse` / `JSON.stringify` in the tree, format, minify or compare paths.
- **Edits keep the user's formatting.** `utils/json-edit.ts` changes only the edited part of the
  text; don't replace that with re-serialising the whole document.
- **Header buttons** look different in the narrow layout (below 768px, labels are hidden). Check
  both widths after changing them.

## Tests

- Unit tests are Vitest specs run through `ng test`, using jsdom and `fake-indexeddb`. Every change
  to a util needs a new or updated spec.
- End-to-end tests are Playwright specs in `e2e/`. Seed documents with `openShared()` from
  `e2e/helpers.ts` rather than typing into Monaco.
- For style-only changes, check the result in the running app in both light and dark themes, and
  include a screenshot in the pull request.

## Pull request review

- CI runs the style lint, unit tests, production build and end-to-end tests on every pull request.
  All of them must pass.
- Keep pull requests small and focused; they get reviewed faster.
- Be ready to make changes after review. Once approved, the pull request is squash-merged into
  `main`.

## License

By contributing, you agree that your contributions are licensed under the
[GNU General Public License v3.0](LICENSE), the same license as the project.

## Code of conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By taking part, you agree to uphold
it.
