# JSON Viewer

A browser-based workspace for reading, editing, searching and comparing JSON. Two panes sit side by side. Each one can be a code editor, a tree or a table, so you can look at two documents at once, find things in them, and see exactly what differs. Everything runs in the browser; nothing is uploaded.

Built with Angular 21, Angular Material and the Monaco editor.

## What it does

**Two documents at once**
- Left and right panes, each switchable between **Editor**, **Tree** and **Table**.
- A saved-files sidebar. Use the **L** / **R** buttons on a file to open it in a specific pane. Search matches file names and contents.
- Open a file from disk (pick two to fill both panes), or drop files onto a pane. **Download** a pane as `.json`.
- Your session is restored on reload: both panes, unsaved text, view modes.
- Files you save are kept in the browser (IndexedDB). Several tabs can save at the same time without losing each other's files, and every tab's list stays up to date. Deleting a file offers **Undo**.

**Find things**
- Tree search with highlighted matches, next/previous, and a filter that hides everything else.
- **JSONPath**: start the search box with `$` to run a query, for example `$.items[?(@.qty > 1)].sku`. See [JSONPath](#jsonpath).
- Select a node to see its path, type and size, and copy the path or value.
- **Edit in the tree**: change a value (choosing its type), rename a key, add a member or item, or delete a node, from the bar under the tree (or F2 and Delete). Only the edited part of the text changes, so your formatting is kept, and each edit can be undone.
- **Breadcrumb**: the footer shows where you are (`$ › lines › [1] › qty`), following the editor cursor or the tree selection. Click a step to select that value. Switching a pane between editor and tree keeps the same place.
- Keyboard navigation in the tree (see [Keyboard](#keyboard)).

**Tables**
- The **Table** view shows an array of records with one column per key. Pick any array in the document; nested arrays are combined, so `$.orders[*].lines` lists the lines of every order.
- Click a column header to sort (numbers numerically, text naturally, missing values last), filter rows on any column, and copy or download the rows shown as CSV.

**Validate**
- Put a JSON Schema in one pane and a document in the other: a **Validate** button appears on the document's pane (also in the palette). The problems are listed with their paths; click one to reveal it, and the tree marks each value at fault. It updates as you edit either pane.
- Supports draft 7 to 2020-12: types, `enum`/`const`, string, number, array and object constraints, `required`, `additionalProperties`, `patternProperties`, `allOf`/`anyOf`/`oneOf`/`not`, `if`/`then`/`else`, and local `$ref`. Formats `date-time`, `date`, `time`, `email`, `uuid`, `uri` and `ipv4` are checked. Keywords it does not check are listed.

**Compare**
- **Workspace | Compare** switch in the header. Compare shows added, removed and changed counts, a clickable list of differences (old → new), a **Changes only** filter and **Swap sides**.
- Objects are compared by key, so key order does not matter.
- **Ignore paths**: JSONPath expressions, separated by commas (for example `$..updatedAt, $.meta`), are left out of the comparison on both sides.
- **JSON Patch**: copies an RFC 6902 patch that turns the left document into the right one (arrays are patched by position; ignored paths are left out).
- **Match array items by key** (on by default): items in arrays of records are paired by an identifying key such as `id`, `sku` or `orderId`, so an inserted, removed or reordered item does not mark every following item as changed. The compare bar names the keys used. Arrays without such a key, or with the option off, are compared by index.

**Work with the JSON**
- Format, minify, sort keys, paste, copy, save, clear.
- Parse errors show `Ln x, Col y`; click it to jump to the error.
- **JSON inside strings** (a message body stored as a string, for example) gets a **JSON** chip in the tree; click it to replace the string with the real object. *Unwrap embedded JSON strings* in the palette does every one at once.
- **Text that is not quite JSON** gets a one-click fix next to the parse error (also in the palette, with Undo):
  - **Repair**: comments, trailing or missing commas, single or curly quotes, unquoted keys, `True`/`None`/`undefined`/`NaN`, and JSON5 numbers such as `.5` or `0x1F`.
  - **Unescape**: escaped JSON copied from a log, such as `{\"id\":1}`.
  - **Decode JWT**: a token (optionally after `Bearer `) becomes its header and payload, with `exp`/`iat` shown as dates. The signature is not verified.
  - **Decode Base64**: Base64 or Base64URL text that holds JSON.
  - **To array**: JSON Lines (one value per line) becomes an array.
- Large integers (such as 64-bit IDs) and long decimals keep every digit through the tree, format, minify and compare.
- **Command palette** (Ctrl/Cmd+K) with every action, including *Copy as YAML*, *Copy as TypeScript types*, *Copy as C# classes* (System.Text.Json; GUIDs, dates and number sizes are detected), *Copy as JSON Schema* and, for arrays, *Copy as JSON Lines*.
- **Share** copies a link that reopens both panes and the Compare view. The documents are compressed into the URL hash, so nothing is stored on a server. *Copy link, hiding sensitive values* redacts both documents first.
- **Sensitive data**: *Copy with sensitive values hidden* and *Hide sensitive values* (palette) replace values under keys such as `password`, `token`, `apiKey`, `cardNumber` or `iban`, and strings that look like tokens, emails or card numbers. Emails keep their first letter and domain and cards their last four digits, so the result is still useful for debugging.

## Keyboard

| Keys | Where | Does |
|---|---|---|
| Ctrl/Cmd + K | anywhere, including the editor | Open the command palette |
| Ctrl/Cmd + S | anywhere | Save the active pane (asks for a name the first time) |
| Ctrl/Cmd + Shift + S | anywhere | Save as a new file |
| Ctrl/Cmd + O | anywhere | Open a file from disk into the active pane |
| ← / → (Shift for bigger steps), Home, End | pane divider | Resize the panes; Enter or double-click splits them evenly |
| Shift + Alt + F | editor | Format the document |
| Enter / Shift + Enter | tree search box | Next / previous match |
| Esc | tree search box | Clear the search |
| ↑ ↓ Home End | tree | Move the selection |
| → / ← | tree | Expand, or step into the first child / collapse, or step to the parent |
| Enter or Space | tree | Expand or collapse the selected node |
| F2 | tree | Edit the selected value, or rename a member that holds an object or array |
| Delete | tree | Delete the selected node |
| Esc | dialogs, palette, mobile file drawer, tree edit bar | Close |

## JSONPath

Text that starts with `$` in a tree search box is run as a JSONPath. Anything else is a plain text search, so searching for a value like `$5.00` still works.

| Syntax | Meaning |
|---|---|
| `$` | the whole document |
| `.name`, `['name']` | a key (use brackets for keys with spaces or dots) |
| `[0]`, `[-1]` | an array index, counting from the end for negatives |
| `[*]`, `.*` | every child |
| `[0,2]`, `['a','b']` | several indexes or keys |
| `[1:3]`, `[::2]`, `[::-1]` | slices with optional step |
| `..name`, `..*` | search at any depth |
| `[?(@.price > 10)]` | filter children |

Inside a filter: `@` is the current item, `$` the root; compare with `== != < <= > >=`, combine with `&& || !` and parentheses, match text with `=~ /regex/i`, and use `length(@.tags)` or `count(@.tags[*])`. A path that matches nothing is simply empty. A malformed path shows *Invalid path*, with the reason on hover. A query that matches more than 100,000 nodes is stopped.

## Limits

- Saved files have no fixed size limit beyond the browser's storage quota. If IndexedDB is unavailable (some private modes), they fall back to local storage, which holds about 5 MB. A save that fails shows an error, and the pane stays marked as unsaved.
- Files over 25 MB are not opened. Share links over 100,000 characters are refused (links over 8,000 may be cut off by chat apps).
- Unsaved text over 2 MB is not kept in the session.
- Tree rows are one line; long values are cut with an ellipsis (select the node and use **Copy value** for the full text).
- Large-number precision relies on `JSON.parse` source-text access (Chrome 114+, Firefox 135+, Safari 18.4+). In older browsers numbers behave as in plain JavaScript.
- The table shows up to 200 rows at first, with **Show more** for the rest.
- Share links use `CompressionStream`; browsers without it fall back to longer, uncompressed links.

## Privacy

Your documents never leave the browser: there is no backend, saved files live in the browser, and a share link carries its document in the URL hash (`#s=…`), which browsers do not send to a server.

The hosted app does collect anonymous page-view statistics with [Vercel Web Analytics](https://vercel.com/docs/analytics/privacy-policy) (page path, referrer, country, browser, OS and device type; no cookies). Document contents are never part of this data, and the URL hash is removed before an event is sent. The analytics script loads in production builds only, so the dev server (`npm start`) does not report. If you self-host the app and do not want it, delete `startAnalytics()` in `src/main.ts`.

## Development

```bash
npm ci
npm start          # dev server at http://localhost:4200
npm run build      # production build in dist/json-viewer/browser (static files)
npm test           # unit tests (Vitest)
npm run e2e        # end-to-end tests (Playwright, Chromium); run `npx playwright install chromium` once first
npm run lint:styles   # Stylelint over the SCSS
```

CI (`.github/workflows/ci.yml`) runs the style lint, the unit tests and the production build on every pull request, and the end-to-end tests in a parallel job (the Playwright report is uploaded as an artifact).

The end-to-end tests live in `e2e/`. Playwright starts `ng serve --configuration production` on port 4300 (or reuses one already running there locally). Tests seed the panes through `#s=` share links (`e2e/helpers.ts`), so they need no saved state.

The production build is plain static files and can be served from any static host (it is deployed on Vercel).

### Releases and versioning

Versions are worked out from the [Conventional Commits](https://www.conventionalcommits.org/) on `main` by [release-please](https://github.com/googleapis/release-please) (`.github/workflows/release.yml`). After each push to `main` it keeps a release pull request open that bumps the version in `package.json` and adds the changes to `CHANGELOG.md`. Merging that pull request tags the release (`vX.Y.Z`) and publishes it on GitHub. Before 1.0, `feat` bumps the minor version, `fix` and `perf` the patch version, and a breaking change (`feat!:` or a `BREAKING CHANGE:` footer) the minor version.

The header shows the version from `package.json` (`utils/app-version.ts`), linked to its release notes.

### Layout

```
src/app/
  app.ts, app.html, app.scss       Shell: header, files sidebar, panes, compare bar, palette wiring
  components/
    json-editor/                   Monaco wrapper
    json-tree/                     Tree: search, JSONPath, diff marks, virtual scrolling, keyboard
    json-tree-node/                One fixed-height row of the tree
    json-table/                    Table view: array picker, sort, filter, CSV
    command-palette/               Ctrl/Cmd+K palette
  utils/
    json-parse.ts                  Lossless number parsing
    json-diff.ts                   Structural diff, with array items matched by key
    json-unwrap.ts                 JSON embedded in strings, escaped JSON
    json-locate.ts                 Text offset ↔ path, breadcrumb steps
    json-schema-validate.ts        JSON Schema validation
    json-patch.ts                  JSON Patch (RFC 6902) between two documents
    json-edit.ts                   Edits to JSON text that keep its formatting
    json-redact.ts                 Hiding sensitive values
    monaco-errors.ts               Drops Monaco's own cancellation errors (installed in main.ts)
    json-repair.ts                 Repairing almost-JSON, JSON Lines, JWT and Base64 decoding
    json-table.ts                  Finding arrays to tabulate, sorting, CSV
    file-store.ts                  Saved files: IndexedDB, with a localStorage fallback
    json-path.ts                   JSONPath evaluator
    json-convert.ts, json-schema.ts   YAML, TypeScript, C# and JSON Schema output
    json-error.ts                  Parse error locations
    share-link.ts                  Share link encoding
    app-version.ts                 App version (from package.json) and its release link
```

### Things to know

- **The app runs without zone.js** (the Angular 21 default). State changed inside a promise or timer is not rendered until something calls `markForCheck()`, so call it after async updates.
- The tree renders only the rows in view (CDK virtual scroll), so every row must be exactly `TREE_ROW_HEIGHT` px tall (`json-tree.component.ts` and `json-tree-node.component.scss`).
- Node paths use one format everywhere (`$`, `$.items[1].qty`, `$["a b"]`): the tree, the diff, JSONPath results and "Copy path" all share `childPath()` in `json-utils.ts`.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions and the pull request process, and [SECURITY.md](SECURITY.md) to report a vulnerability privately. This project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[GNU General Public License v3.0](LICENSE)
