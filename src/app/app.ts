import {
  ChangeDetectorRef,
  Component,
  DoCheck,
  ElementRef,
  HostListener,
  OnDestroy,
  Optional,
  ViewChild,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate } from '@angular/service-worker';
import { Subscription } from 'rxjs';
import { DiffEntry, DiffKind, DiffResult } from './utils/json-diff';
import type { SchemaError } from './utils/json-schema-validate';
import { parseJson, stringifyJson } from './utils/json-parse';
import {
  byteLength,
  childPath,
  formatBytes,
  jsonTypeOf,
  looksLikeSchema,
  summarizeValue,
} from './utils/json-utils';
import { JsonErrorLocation, friendlyJsonError, locateJsonError } from './utils/json-error';
import { parseEmbedded, replaceAt, unwrapAll } from './utils/json-unwrap';
import { TextFix, findTextFix, toJsonLines } from './utils/json-repair';
import {
  PathSegment,
  pathAtOffset,
  pathSegments,
  spanOfPath,
  valueAtPath,
} from './utils/json-locate';
import { EditError, addChild, deleteAt, renameKey, setValue } from './utils/json-edit';
import { TreeEdit } from './components/json-tree/json-tree.component';
import { ShareLinkError } from './utils/share-link';
import { PaletteCommand } from './components/command-palette/command-palette.component';
import { SavedFile } from './utils/file-store';
import { PANEL_MODES, PanelMode, RestoredSession, SessionState } from './utils/session';
import { SessionService } from './services/session.service';
import { ShareService } from './services/share.service';
import { FilesService } from './services/files.service';
import { CompareService, ValidationView } from './services/compare.service';

export type { SavedFile } from './utils/file-store';
export type { PanelMode } from './utils/session';
export type { ValidationView } from './services/compare.service';
export { WORKER_MIN_CHARS } from './services/compare.service';

/** The path of the container holding `path` (`$` for top-level members). */
function parentPath(path: string): string {
  const steps = pathSegments(path);
  return steps.length > 1 ? steps[steps.length - 2].path : '$';
}

export interface PanelState {
  jsonText: string;
  parsedJson: any;
  jsonError: string | null;
  isValid: boolean;
  mode: PanelMode;
  expandAllTrigger: number;
  collapseAllTrigger: number;
  currentFileId: string | null;
  /** Name of a file opened from disk (not necessarily saved in the app). */
  sourceName: string | null;
  errorLocation: JsonErrorLocation | null;
  jumpRequest: { line: number; column: number; n: number } | null;
  /** Where the user is: the editor cursor's value, or the tree's selected node. */
  focusPath: string | null;
  /** One-shot requests to show a path, cleared once handled. */
  treeReveal: { path: string } | null;
  editorSelect: { start: number; end: number } | null;
}

function newPanel(): PanelState {
  return {
    jsonText: '',
    parsedJson: null,
    jsonError: null,
    isValid: false,
    mode: 'editor',
    expandAllTrigger: 0,
    collapseAllTrigger: 0,
    currentFileId: null,
    sourceName: null,
    errorLocation: null,
    jumpRequest: null,
    focusPath: null,
    treeReveal: null,
    editorSelect: null,
  };
}

/** Above this size, the cursor is not mapped to a path (each lookup scans the text). */
const MAX_LOCATE_CHARS = 10_000_000;
/** The pane divider never makes a pane narrower than this. */
const MIN_PANE_WIDTH = 200;
/** Below this width the files sidebar becomes an overlay drawer. */
const NARROW_BREAKPOINT = 1000;
const THEME_KEY = 'json-viewer-theme';

/** Larger files are refused: they would freeze the editor and cannot be kept in browser storage. */
const MAX_OPEN_BYTES = 25 * 1024 * 1024;
/** Above this size, parsing while typing waits until the user pauses. */
export const LARGE_TEXT_CHARS = 200_000;
/** How long typing must pause before a large document is parsed again. */
export const PARSE_DEBOUNCE_MS = 250;

@Component({
  selector: 'app-root',
  standalone: false,
  templateUrl: './app.html',
  styleUrl: './app.scss',
  // One per app, so its timers and listeners go away with it.
  providers: [SessionService, ShareService, FilesService, CompareService],
})
export class App implements DoCheck, OnDestroy {
  @ViewChild('leftPanel', { static: false }) leftPanelRef!: ElementRef<HTMLElement>;

  isDarkTheme = true;
  editorTheme: 'vs-dark' | 'vs' = 'vs-dark';

  // ── Workspace / Compare ───────────────────────────────────────────────────
  viewMode: 'edit' | 'compare' = 'edit';
  changesOnly = false;
  /** Match array items by an identifying key (id, sku...) instead of by index. */
  matchArrays = true;
  /** JSONPath expressions (comma-separated) whose values Compare leaves out, e.g. `$..updatedAt`. */
  ignoreText = '';
  /** Why `ignoreText` could not be used, if it could not. */
  get ignoreError(): string | null {
    return this.compare.ignoreError;
  }
  /** The worker is still comparing the current documents. */
  get diffPending(): boolean {
    return this.compare.diffPending;
  }

  left: PanelState = newPanel();
  right: PanelState = newPanel();
  activePanel!: PanelState;
  savingPanel: PanelState | null = null;

  isDragging = false;
  private startX = 0;
  private startLeftWidth = 0;
  /** Left pane width as a share of both panes (for the divider's aria-valuenow). */
  splitPercent = 50;

  // ── Local Storage ─────────────────────────────────────────────────────────
  /** Most recently saved first. */
  get savedFiles(): SavedFile[] {
    return this.files.list;
  }
  set savedFiles(files: SavedFile[]) {
    this.files.list = files;
  }
  showFilesPanel = typeof window !== 'undefined' && window.innerWidth >= NARROW_BREAKPOINT;
  showSaveDialog = false;
  saveFileName = '';
  fileSearchQuery = '';
  renamingFileId: string | null = null;
  renameValue = '';

  // The app runs without zone.js, so state changed inside a promise callback is not rendered
  // until something calls markForCheck(); do that after every async update.
  constructor(
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
    private session: SessionService,
    private share: ShareService,
    private files: FilesService,
    private compare: CompareService,
    @Optional() private swUpdate: SwUpdate | null,
  ) {
    this.activePanel = this.left;
    this.loadPersistedTheme();
    this.watchForUpdates();
    this.share.watch((hash) => void this.openSharedHash(hash));
    this.compare.onResult(() => this.cdr.markForCheck());
    this.ready = this.init();
  }

  /** Resolves once saved files are loaded and the previous session is restored. */
  readonly ready: Promise<void>;

  private async init(): Promise<void> {
    await this.files.load();
    const restored = await this.session.restore(this.files.store, this.savedFiles);
    if (restored) {
      this.applySession(restored);
    } else {
      // First visit with saved files: start with the two most recent side by side.
      const [first, second] = this.savedFiles;
      if (first) this.assignFile(first, this.left);
      if (second) this.assignFile(second, this.right);
    }
    // A share link in the address bar wins over the restored session.
    await this.openSharedHash(location.hash);
    this.session.start(this.files.store, () => this.sessionState());
    // Another tab saved, renamed or deleted a file.
    this.files.watch(() => this.cdr.markForCheck());
    this.cdr.markForCheck();
    this.preloadRareFeatures();
  }

  /**
   * Fetches the rarely used code (converters, redaction, JSON Patch, schema validation) once the
   * browser is idle. It stays out of the initial bundle, but a command that writes to the
   * clipboard rarely waits for a download, which could lose the click it was started by.
   */
  private preloadRareFeatures(): void {
    if (typeof requestIdleCallback !== 'function') return;
    requestIdleCallback(() => {
      const chunks = [
        import('./utils/json-convert'),
        import('./utils/json-schema'),
        import('./utils/json-redact'),
        import('./utils/json-patch'),
        import('./utils/json-schema-validate'),
      ];
      for (const chunk of chunks) chunk.catch(() => undefined);
    });
  }

  private updateSub?: Subscription;

  /** Offers a reload once the service worker has downloaded a new version of the app. */
  private watchForUpdates(): void {
    if (!this.swUpdate?.isEnabled) return;
    this.updateSub = this.swUpdate.versionUpdates.subscribe((event) => {
      if (event.type !== 'VERSION_READY') return;
      this.snackBar
        .open('A new version is available.', 'Reload')
        .onAction()
        .subscribe(() => location.reload());
    });
  }

  ngOnDestroy(): void {
    this.updateSub?.unsubscribe();
    for (const timer of this.parseTimers.values()) clearTimeout(timer);
    this.parseTimers.clear();
  }

  private assignFile(file: SavedFile, panel: PanelState): void {
    panel.currentFileId = file.id;
    panel.jsonText = file.content;
    this.parsePanel(panel);
  }

  setActive(panel: PanelState): void {
    this.activePanel = panel;
  }

  /** Parses scheduled while typing in a large document, per pane. */
  private parseTimers = new Map<PanelState, ReturnType<typeof setTimeout>>();

  onTextChange(text: string, panel: PanelState): void {
    panel.jsonText = text;
    this.activePanel = panel;
    if (text.length <= LARGE_TEXT_CHARS) {
      this.parsePanel(panel);
      return;
    }
    // Parsing a large document on every keystroke stalls typing: wait for a pause.
    clearTimeout(this.parseTimers.get(panel));
    this.parseTimers.set(
      panel,
      setTimeout(() => {
        this.parsePanel(panel);
        this.cdr.markForCheck();
      }, PARSE_DEBOUNCE_MS),
    );
  }

  /** Runs a parse still waiting for a typing pause, so the pane's parsed state matches its text. */
  private ensureParsed(...panels: PanelState[]): void {
    for (const panel of panels) if (this.parseTimers.has(panel)) this.parsePanel(panel);
  }

  private parsePanel(panel: PanelState): void {
    clearTimeout(this.parseTimers.get(panel));
    this.parseTimers.delete(panel);
    const text = panel.jsonText;
    panel.errorLocation = null;
    if (!text.trim()) {
      panel.parsedJson = null;
      panel.jsonError = null;
      panel.isValid = false;
      return;
    }
    try {
      panel.parsedJson = parseJson(text);
      panel.jsonError = null;
      panel.isValid = true;
      this.compare.noteSource(panel.parsedJson, text);
    } catch (e: any) {
      panel.parsedJson = null;
      panel.jsonError = e.message;
      panel.isValid = false;
      panel.errorLocation = locateJsonError(text, e.message);
    }
  }

  formatJson(panel: PanelState): void {
    this.ensureParsed(panel);
    if (!panel.isValid || panel.parsedJson === null) return;
    panel.jsonText = stringifyJson(panel.parsedJson, 2);
    this.snackBar.open('JSON formatted', '', { duration: 1500 });
  }

  minifyJson(panel: PanelState): void {
    this.ensureParsed(panel);
    if (!panel.isValid || panel.parsedJson === null) return;
    panel.jsonText = stringifyJson(panel.parsedJson);
    this.snackBar.open('JSON minified', '', { duration: 1500 });
  }

  sortKeys(panel: PanelState): void {
    this.ensureParsed(panel);
    if (!panel.isValid || panel.parsedJson === null) return;
    const sort = (v: any): any =>
      Array.isArray(v)
        ? v.map(sort)
        : jsonTypeOf(v) === 'object'
          ? // fromEntries defines own properties, so a "__proto__" key is kept as a key
            Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((k) => [k, sort(v[k])]),
            )
          : v;
    panel.jsonText = stringifyJson(sort(panel.parsedJson), 2);
    this.parsePanel(panel);
    this.snackBar.open('Keys sorted A → Z', '', { duration: 1500 });
  }

  /** Replaces the pane's text with `doc`, pretty-printed. */
  private setDocument(panel: PanelState, doc: unknown): void {
    panel.jsonText = stringifyJson(doc, 2);
    this.parsePanel(panel);
    this.cdr.markForCheck();
  }

  /**
   * Applies an edit made in the tree to the pane's text. Only the edited part of the
   * text changes, so formatting is kept. The snackbar offers Undo.
   */
  applyTreeEdit(panel: PanelState, edit: TreeEdit): void {
    this.ensureParsed(panel);
    const before = panel.jsonText;
    let text: string;
    let focus: string;
    try {
      switch (edit.kind) {
        case 'set':
          text = setValue(before, edit.path, edit.value);
          focus = edit.path;
          break;
        case 'rename':
          text = renameKey(before, edit.path, edit.key);
          focus = childPath(parentPath(edit.path), edit.key, false);
          break;
        case 'delete':
          text = deleteAt(before, edit.path);
          focus = parentPath(edit.path);
          break;
        case 'add': {
          text = addChild(before, edit.path, edit.key, edit.value);
          const parent = valueAtPath(panel.parsedJson, edit.path);
          focus =
            edit.key !== null
              ? childPath(edit.path, edit.key, false)
              : childPath(edit.path, Array.isArray(parent) ? parent.length : 0, true);
          break;
        }
      }
    } catch (e) {
      this.snackBar.open(
        e instanceof EditError ? e.message : 'Could not apply the edit',
        'Dismiss',
        { duration: 4000 },
      );
      return;
    }
    panel.jsonText = text;
    this.parsePanel(panel);
    this.navigateTo(panel, focus);
    const label = { set: 'Value changed', rename: 'Key renamed', delete: 'Deleted', add: 'Added' }[
      edit.kind
    ];
    this.snackBar
      .open(label, 'Undo', { duration: 5000 })
      .onAction()
      .subscribe(() => {
        panel.jsonText = before;
        this.parsePanel(panel);
        this.cdr.markForCheck();
      });
  }

  // ── Sensitive data ─────────────────────────────────────────────────────────
  /** Copies the pane's JSON with passwords, tokens, emails, card numbers... hidden. */
  async copyRedacted(panel: PanelState): Promise<void> {
    const { describeRedaction, redact } = await import('./utils/json-redact');
    this.ensureParsed(panel);
    if (!this.isReady(panel)) return;
    const r = redact(panel.parsedJson);
    navigator.clipboard
      .writeText(stringifyJson(r.value, 2))
      .then(() =>
        this.snackBar.open(
          r.count
            ? `Copied with ${describeRedaction(r)} hidden`
            : 'Copied (nothing sensitive found)',
          '',
          { duration: 3000 },
        ),
      )
      .catch(() =>
        this.snackBar.open('Copy failed — clipboard access denied', '', { duration: 2500 }),
      );
  }

  /** Hides sensitive values in the pane itself; the snackbar offers Undo. */
  async redactPane(panel: PanelState): Promise<void> {
    const { describeRedaction, redact } = await import('./utils/json-redact');
    this.ensureParsed(panel);
    if (!this.isReady(panel)) return;
    const r = redact(panel.parsedJson);
    if (!r.count) {
      this.snackBar.open('Nothing sensitive found', '', { duration: 2000 });
      return;
    }
    const before = panel.jsonText;
    this.setDocument(panel, r.value);
    this.snackBar
      .open(`Hid ${describeRedaction(r)}`, 'Undo', { duration: 6000 })
      .onAction()
      .subscribe(() => {
        panel.jsonText = before;
        this.parsePanel(panel);
        this.cdr.markForCheck();
      });
  }

  /** Replaces the string at `path` with the JSON it holds (e.g. a message body). */
  unwrapAt(panel: PanelState, path: string): void {
    this.ensureParsed(panel);
    if (!this.isReady(panel)) return;
    let changed = false;
    const doc = replaceAt(panel.parsedJson, path, (v) => {
      const inner = typeof v === 'string' ? parseEmbedded(v) : undefined;
      if (inner === undefined) return v;
      changed = true;
      return unwrapAll(inner).value;
    });
    if (!changed) {
      this.snackBar.open('That value does not hold valid JSON', '', { duration: 2000 });
      return;
    }
    this.setDocument(panel, doc);
    this.snackBar.open('Unwrapped embedded JSON', '', { duration: 1500 });
  }

  /** Replaces every string in the document that holds JSON. */
  unwrapAllIn(panel: PanelState): void {
    this.ensureParsed(panel);
    if (!this.isReady(panel)) return;
    const { value, count } = unwrapAll(panel.parsedJson);
    if (!count) {
      this.snackBar.open('No embedded JSON found', '', { duration: 2000 });
      return;
    }
    this.setDocument(panel, value);
    this.snackBar.open(`Unwrapped ${count} embedded JSON string${count === 1 ? '' : 's'}`, '', {
      duration: 2000,
    });
  }

  private fixMemo = new Map<PanelState, { text: string; fix: TextFix | null }>();

  /**
   * For a pane whose text is not valid JSON: a fix that turns it into JSON (unescape,
   * decode a JWT or Base64, JSON Lines to an array, or repair). Memoized per text.
   */
  textFix(panel: PanelState): TextFix | null {
    if (!panel.jsonError) return null;
    let memo = this.fixMemo.get(panel);
    if (!memo || memo.text !== panel.jsonText) {
      memo = { text: panel.jsonText, fix: findTextFix(panel.jsonText) };
      this.fixMemo.set(panel, memo);
    }
    return memo.fix;
  }

  /** Applies the pane's fix; the snackbar offers Undo. */
  applyFix(panel: PanelState): void {
    this.ensureParsed(panel);
    const fix = this.textFix(panel);
    if (!fix) return;
    const before = panel.jsonText;
    panel.jsonText = fix.text;
    this.parsePanel(panel);
    this.snackBar
      .open(`${fix.label}: done`, 'Undo', { duration: 6000 })
      .onAction()
      .subscribe(() => {
        panel.jsonText = before;
        this.parsePanel(panel);
        this.cdr.markForCheck();
      });
  }

  copyJson(panel: PanelState): void {
    navigator.clipboard
      .writeText(panel.jsonText)
      .then(() => this.snackBar.open('Copied to clipboard!', '', { duration: 1500 }))
      .catch(() =>
        this.snackBar.open('Copy failed — use Ctrl+A, Ctrl+C in the editor', '', {
          duration: 2500,
        }),
      );
  }

  pasteJson(panel: PanelState): void {
    navigator.clipboard
      .readText()
      .then((text) => {
        if (text.trim()) {
          this.onTextChange(text, panel);
          this.cdr.markForCheck();
          this.snackBar.open('Pasted from clipboard', '', { duration: 1500 });
        }
      })
      .catch(() =>
        this.snackBar.open('Paste failed — clipboard access denied', '', { duration: 2500 }),
      );
  }

  clearJson(panel: PanelState): void {
    panel.jsonText = '';
    panel.parsedJson = null;
    panel.jsonError = null;
    panel.isValid = false;
    panel.errorLocation = null;
    panel.currentFileId = null;
    panel.sourceName = null;
  }

  /** Short error text, without the position suffix that the footer shows separately. */
  errorText(panel: PanelState): string {
    return panel.jsonError ? friendlyJsonError(panel.jsonError) : '';
  }

  /** Switches the pane to its editor and puts the cursor on the parse error. */
  jumpToError(panel: PanelState): void {
    this.ensureParsed(panel);
    const loc = panel.errorLocation;
    if (!loc) return;
    this.viewMode = 'edit';
    panel.mode = 'editor';
    this.activePanel = panel;
    panel.jumpRequest = { line: loc.line, column: loc.column, n: (panel.jumpRequest?.n ?? 0) + 1 };
  }

  togglePanelMode(panel: PanelState): void {
    this.ensureParsed(panel);
    panel.mode = panel.mode === 'editor' ? 'tree' : 'editor';
  }

  /** Switches the pane's view and shows the same place in the new view. */
  setPanelMode(panel: PanelState, mode: PanelMode): void {
    this.ensureParsed(panel);
    panel.mode = mode;
    this.activePanel = panel;
    if (panel.focusPath) this.navigateTo(panel, panel.focusPath);
  }

  // ── Location: editor cursor ↔ tree selection, breadcrumb ────────────────
  /** Shows `path` in the pane: selects the value in the editor, or reveals the node in the tree. */
  navigateTo(panel: PanelState, path: string): void {
    panel.focusPath = path;
    if (this.isTreeView(panel)) {
      panel.treeReveal = { path };
    } else if (
      this.isEditorView(panel) &&
      this.isReady(panel) &&
      panel.jsonText.length <= MAX_LOCATE_CHARS
    ) {
      const span = spanOfPath(panel.jsonText, path);
      if (span) panel.editorSelect = { start: span.start, end: span.end };
    }
  }

  onCursor(panel: PanelState, offset: number): void {
    panel.focusPath =
      this.isReady(panel) && panel.jsonText.length <= MAX_LOCATE_CHARS
        ? pathAtOffset(panel.jsonText, offset)
        : null;
  }

  private crumbMemo = new Map<PanelState, { path: string | null; segments: PathSegment[] }>();

  /** Breadcrumb steps for the pane's location (memoized per path). */
  breadcrumb(panel: PanelState): PathSegment[] {
    if (!this.isReady(panel) || !panel.focusPath || this.isTableView(panel)) return [];
    let memo = this.crumbMemo.get(panel);
    if (!memo || memo.path !== panel.focusPath) {
      memo = { path: panel.focusPath, segments: pathSegments(panel.focusPath) };
      this.crumbMemo.set(panel, memo);
    }
    return memo.segments;
  }

  isEditorView(panel: PanelState): boolean {
    return this.viewMode === 'edit' && panel.mode === 'editor';
  }

  isTableView(panel: PanelState): boolean {
    return this.viewMode === 'edit' && panel.mode === 'table';
  }

  modeIcon(panel: PanelState): string {
    if (this.isTreeView(panel)) return 'account_tree';
    return panel.mode === 'table' ? 'table_chart' : 'code';
  }

  expandAll(panel: PanelState): void {
    panel.expandAllTrigger++;
  }
  collapseAll(panel: PanelState): void {
    panel.collapseAllTrigger++;
  }

  toggleTheme(): void {
    this.isDarkTheme = !this.isDarkTheme;
    this.editorTheme = this.isDarkTheme ? 'vs-dark' : 'vs';
    try {
      localStorage.setItem(THEME_KEY, this.isDarkTheme ? 'dark' : 'light');
    } catch {
      /* storage unavailable: the choice just won't persist */
    }
  }

  private loadPersistedTheme(): void {
    try {
      if (localStorage.getItem(THEME_KEY) === 'light') {
        this.isDarkTheme = false;
        this.editorTheme = 'vs';
      }
    } catch {
      /* ignore */
    }
  }

  // ── Compare ───────────────────────────────────────────────────────────────
  setViewMode(mode: 'edit' | 'compare'): void {
    if (this.viewMode === mode) return;
    this.ensureParsed(this.left, this.right);
    this.viewMode = mode;
    if (mode === 'compare') this.changesOnly = false;
  }

  isTreeView(panel: PanelState): boolean {
    return this.viewMode === 'compare' || panel.mode === 'tree';
  }

  sideLabel(side: 'left' | 'right'): string {
    if (this.viewMode === 'compare') return side === 'left' ? 'Before' : 'After';
    return side === 'left' ? 'Left' : 'Right';
  }

  private isReady(panel: PanelState): boolean {
    return panel.isValid && panel.parsedJson !== null;
  }

  get compareReady(): boolean {
    return this.isReady(this.left) && this.isReady(this.right);
  }

  get compareMessage(): string {
    const problems = [
      !this.isReady(this.left) ? 'left' : '',
      !this.isReady(this.right) ? 'right' : '',
    ].filter(Boolean);
    return `Load valid JSON in the ${problems.join(' and ')} pane to compare.`;
  }

  /** Memoized by document identity, so it is cheap to read from the template. */
  get diff(): DiffResult | null {
    if (!this.compareReady) return null;
    const { matchArrays, ignoreText } = this;
    return this.compare.diff(this.left.parsedJson, this.right.parsedJson, {
      matchArrays,
      ignoreText,
    });
  }

  /** Copies an RFC 6902 patch that turns the left document into the right one. */
  async copyPatch(): Promise<void> {
    this.ensureParsed(this.left, this.right);
    if (!this.compareReady) return;
    const ops = await this.compare.patch(
      this.left.parsedJson,
      this.right.parsedJson,
      this.ignoreText,
    );
    navigator.clipboard
      .writeText(stringifyJson(ops, 2))
      .then(() =>
        this.snackBar.open(
          `Copied JSON Patch: ${ops.length} operation${ops.length === 1 ? '' : 's'}`,
          '',
          { duration: 2000 },
        ),
      )
      .catch(() =>
        this.snackBar.open('Copy failed — clipboard access denied', '', { duration: 2500 }),
      );
  }

  // ── Schema validation (one pane holds the document, the other the schema) ──
  validationDoc: 'left' | 'right' | null = null;

  startValidation(docSide: 'left' | 'right'): void {
    this.ensureParsed(this.left, this.right);
    this.validationDoc = docSide;
    this.viewMode = 'edit';
  }

  closeValidation(): void {
    this.validationDoc = null;
  }

  /** The current validation, recomputed only when either document changes. */
  get validation(): ValidationView | null {
    if (!this.validationDoc || this.viewMode !== 'edit') return null;
    const docPanel = this.validationDoc === 'left' ? this.left : this.right;
    const schemaPanel = docPanel === this.left ? this.right : this.left;
    const docSide = this.validationDoc;
    const schemaSide = docSide === 'left' ? 'right' : 'left';
    if (!this.isReady(schemaPanel))
      return { docSide, schemaSide, problem: `Load a JSON Schema in the ${schemaSide} pane.` };
    if (!this.isReady(docPanel))
      return {
        docSide,
        schemaSide,
        problem: `Load valid JSON in the ${docSide} pane to validate it.`,
      };
    return this.compare.validate(docPanel.parsedJson, schemaPanel.parsedJson, docSide);
  }

  /** Offer validation when the other pane holds a schema and this one holds a document. */
  canValidate(panel: PanelState): boolean {
    const other = panel === this.left ? this.right : this.left;
    return (
      this.viewMode === 'edit' &&
      this.isReady(panel) &&
      !this.holdsSchema(panel) &&
      this.holdsSchema(other)
    );
  }

  revealSchemaError(error: SchemaError): void {
    const docPanel = this.validationDoc === 'right' ? this.right : this.left;
    this.navigateTo(docPanel, error.path);
  }

  /** Marks for a pane's tree: the differences in Compare, or the schema errors of a validated document. */
  treeMarks(panel: PanelState): Record<string, DiffKind> | null {
    if (this.viewMode === 'compare') {
      const d = this.diff;
      return d ? (panel === this.left ? d.left : d.right) : null;
    }
    const v = this.validation;
    if (!v?.result || (v.docSide === 'left') !== (panel === this.left)) return null;
    return this.compare.errorMarks(v.result.errors);
  }

  private schemaHint = new Map<PanelState, { doc: unknown; isSchema: boolean }>();

  /** True when the pane holds something that looks like a JSON Schema (memoized per document). */
  holdsSchema(panel: PanelState): boolean {
    if (!this.isReady(panel)) return false;
    let memo = this.schemaHint.get(panel);
    if (!memo || memo.doc !== panel.parsedJson) {
      memo = { doc: panel.parsedJson, isSchema: looksLikeSchema(panel.parsedJson) };
      this.schemaHint.set(panel, memo);
    }
    return memo.isSchema;
  }

  /** Each side reveals its own path: a matched array item can sit at different indexes. */
  revealChange(entry: DiffEntry): void {
    if (entry.kind !== 'add') this.navigateTo(this.left, entry.path);
    if (entry.kind !== 'del') this.navigateTo(this.right, entry.rightPath ?? entry.path);
  }

  summarize(value: unknown): string {
    return summarizeValue(value);
  }

  changeSymbol(kind: DiffEntry['kind']): string {
    return { add: '+', del: '−', chg: '~' }[kind];
  }

  swapPanels(): void {
    this.ensureParsed(this.left, this.right);
    const fields: (keyof PanelState)[] = [
      'jsonText',
      'parsedJson',
      'jsonError',
      'isValid',
      'currentFileId',
      'sourceName',
      'errorLocation',
      'mode',
      'focusPath',
    ];
    for (const f of fields) {
      const tmp = this.left[f];
      (this.left as any)[f] = this.right[f];
      (this.right as any)[f] = tmp;
    }
  }

  // ── Pane divider: mouse, touch and pen (pointer events) and keyboard ────
  @ViewChild('rightPanel', { static: false }) rightPanelRef?: ElementRef<HTMLElement>;

  onResizeStart(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.isDragging = true;
    this.startX = event.clientX;
    this.startLeftWidth = this.leftPanelRef?.nativeElement.getBoundingClientRect().width ?? 0;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (!this.isDragging) return;
    this.setLeftWidth(this.startLeftWidth + event.clientX - this.startX);
  }

  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  onPointerUp(): void {
    this.isDragging = false;
  }

  /** Arrow keys move the divider (Shift for bigger steps), Home/End go to the limits, Enter resets. */
  onResizeKey(event: KeyboardEvent): void {
    const el = this.leftPanelRef?.nativeElement;
    if (!el) return;
    const width = el.getBoundingClientRect().width;
    const step = event.shiftKey ? 100 : 20;
    switch (event.key) {
      case 'ArrowLeft':
        this.setLeftWidth(width - step);
        break;
      case 'ArrowRight':
        this.setLeftWidth(width + step);
        break;
      case 'Home':
        this.setLeftWidth(0);
        break;
      case 'End':
        this.setLeftWidth(Infinity);
        break;
      case 'Enter':
        this.resetSplit();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /** Splits the space evenly again (double-click or Enter on the divider). */
  resetSplit(): void {
    const el = this.leftPanelRef?.nativeElement;
    if (!el) return;
    el.style.flexBasis = el.style.flexGrow = el.style.flexShrink = '';
    this.splitPercent = 50;
  }

  /** Sets the left pane's width, keeping both panes at least MIN_PANE_WIDTH wide. */
  private setLeftWidth(px: number): void {
    const left = this.leftPanelRef?.nativeElement;
    const right = this.rightPanelRef?.nativeElement;
    if (!left) return;
    const total = left.getBoundingClientRect().width + (right?.getBoundingClientRect().width ?? 0);
    const width = Math.round(Math.max(MIN_PANE_WIDTH, Math.min(px, total - MIN_PANE_WIDTH)));
    left.style.flexBasis = `${width}px`;
    left.style.flexGrow = '0';
    left.style.flexShrink = '0';
    this.splitPercent = total > 0 ? Math.round((width / total) * 100) : 50;
  }

  // ── Open, drop and download ───────────────────────────────────────────────
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;
  fileTarget: PanelState = this.left;
  dragOverPanel: PanelState | null = null;

  openFileDialog(panel: PanelState): void {
    this.fileTarget = panel;
    this.activePanel = panel;
    this.fileInputRef.nativeElement.click();
  }

  onFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // lets the same file be chosen again
    void this.openFiles(files, this.fileTarget);
  }

  /** The first file goes to `target`, a second one to the other pane. */
  async openFiles(files: File[], target: PanelState): Promise<void> {
    if (!files.length) return;
    const other = target === this.left ? this.right : this.left;
    if (files.length > 2)
      this.snackBar.open('Only the first two files were opened', '', { duration: 2500 });
    for (const [i, file] of files.slice(0, 2).entries()) {
      const panel = i === 0 ? target : other;
      if (file.size > MAX_OPEN_BYTES) {
        this.snackBar.open(`"${file.name}" is larger than ${formatBytes(MAX_OPEN_BYTES)}`, '', {
          duration: 3500,
        });
        continue;
      }
      try {
        const text = await file.text();
        panel.currentFileId = null;
        panel.sourceName = file.name;
        this.onTextChange(text, panel);
        this.cdr.markForCheck();
        this.snackBar.open(
          `Opened "${file.name}" in the ${panel === this.left ? 'left' : 'right'} pane`,
          '',
          { duration: 1800 },
        );
      } catch {
        this.snackBar.open(`Could not read "${file.name}"`, '', { duration: 3000 });
      }
    }
  }

  private hasFiles(event: DragEvent): boolean {
    return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
  }

  onDragOver(event: DragEvent, panel: PanelState): void {
    if (!this.hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.dragOverPanel = panel;
  }

  onDragLeave(event: DragEvent): void {
    const box = event.currentTarget as HTMLElement;
    if (!box.contains(event.relatedTarget as Node | null)) this.dragOverPanel = null;
  }

  onDrop(event: DragEvent, panel: PanelState): void {
    if (!this.hasFiles(event)) return;
    event.preventDefault();
    this.dragOverPanel = null;
    void this.openFiles(Array.from(event.dataTransfer!.files), panel);
  }

  downloadName(panel: PanelState): string {
    const base = this.panelFileName(panel) ?? 'untitled';
    return /\.(json|txt)$/i.test(base) ? base : `${base}.json`;
  }

  downloadJson(panel: PanelState): void {
    if (!panel.jsonText.trim()) return;
    const url = URL.createObjectURL(new Blob([panel.jsonText], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = this.downloadName(panel);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url));
    this.snackBar.open(`Downloaded ${link.download}`, '', { duration: 1800 });
  }

  // ── Session (autosave / restore) ──────────────────────────────────────────
  /** Schedules a session save when anything it remembers has changed. Runs on every render. */
  ngDoCheck(): void {
    this.session.check();
  }

  /** Saves at once when the tab is hidden or closed, so a change made just before is not lost. */
  @HostListener('window:pagehide')
  flushSession(): void {
    this.session.flush();
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') this.flushSession();
  }

  /** Writes the session without blocking typing. Resolves once it is stored (or the browser refused). */
  persistSession(): Promise<void> {
    return this.session.persist();
  }

  private sessionState(): SessionState {
    return {
      left: this.left,
      right: this.right,
      viewMode: this.viewMode,
      active: this.activePanel === this.right ? 'right' : 'left',
      matchArrays: this.matchArrays,
      ignoreText: this.ignoreText,
      savedFiles: this.savedFiles,
    };
  }

  private applySession(session: RestoredSession): void {
    for (const [panel, pane] of [
      [this.left, session.left],
      [this.right, session.right],
    ] as const) {
      Object.assign(panel, pane);
      this.parsePanel(panel);
    }
    this.viewMode = session.viewMode;
    this.activePanel = session.active === 'right' ? this.right : this.left;
    this.matchArrays = session.matchArrays;
    this.ignoreText = session.ignoreText;
  }

  // ── Share links ───────────────────────────────────────────────────────────
  /**
   * Copies a link that reopens both panes (and the Compare view) for whoever opens it. With
   * `hideSensitive`, the documents are redacted first.
   */
  async shareLink(hideSensitive = false): Promise<void> {
    this.ensureParsed(this.left, this.right);
    let left = this.left.jsonText;
    let right = this.right.jsonText;
    if (!left.trim() && !right.trim()) {
      this.snackBar.open('Nothing to share yet: add JSON to a pane first', '', { duration: 2500 });
      return;
    }
    let hidden = 0;
    if (hideSensitive) {
      const { redact } = await import('./utils/json-redact');
      const panes = [this.left, this.right].filter((p) => p.jsonText.trim());
      const invalid = panes.find((p) => !this.isReady(p));
      if (invalid) {
        this.snackBar.open(
          `The ${invalid === this.left ? 'left' : 'right'} pane is not valid JSON, so it cannot be checked for sensitive data`,
          'Dismiss',
          { duration: 5000 },
        );
        return;
      }
      const texts = [this.left, this.right].map((p) => {
        if (!p.jsonText.trim()) return '';
        const r = redact(p.parsedJson);
        hidden += r.count;
        return r.count ? stringifyJson(r.value, 2) : p.jsonText;
      });
      [left, right] = texts;
    }
    const outcome = await this.share.copyLink({ left, right, view: this.viewMode });
    if (outcome.status === 'too-large') {
      this.snackBar.open(
        'Too large for a link. Download the files and send those instead.',
        'Dismiss',
        { duration: 6000 },
      );
      return;
    }
    if (outcome.status === 'denied') {
      this.snackBar.open('Could not copy the link: clipboard access denied', '', {
        duration: 3000,
      });
    } else {
      const what = hideSensitive
        ? hidden
          ? `Link copied, with ${hidden} sensitive value${hidden === 1 ? '' : 's'} hidden`
          : 'Link copied (nothing sensitive found)'
        : 'Link copied';
      this.snackBar.open(
        outcome.long ? `${what}. It is long, so some chat apps may cut it off.` : what,
        '',
        { duration: 3000 },
      );
    }
    this.cdr.markForCheck();
  }

  /** Opens the documents in a `#s=` share link. Returns false when the hash is not a share link. */
  async openSharedHash(hash: string): Promise<boolean> {
    if (!this.share.isShareLink(hash)) return false;
    const before = [this.left, this.right].map((p) => ({
      jsonText: p.jsonText,
      currentFileId: p.currentFileId,
      sourceName: p.sourceName,
    }));
    const hadWork = before.some((b) => b.jsonText.trim());
    const viewBefore = this.viewMode;
    try {
      const shared = await this.share.read(hash);
      for (const [panel, text] of [
        [this.left, shared.left],
        [this.right, shared.right],
      ] as const) {
        panel.currentFileId = null;
        panel.sourceName = null;
        panel.jsonText = text;
        this.parsePanel(panel);
      }
      this.viewMode = shared.view;
      this.share.clearHash();
      const ref = this.snackBar.open('Opened the shared documents', hadWork ? 'Undo' : '', {
        duration: hadWork ? 10000 : 3000,
      });
      if (hadWork) {
        ref.onAction().subscribe(() => {
          [this.left, this.right].forEach((panel, i) => {
            Object.assign(panel, before[i]);
            this.parsePanel(panel);
          });
          this.viewMode = viewBefore;
          this.cdr.markForCheck();
        });
      }
    } catch (e: any) {
      this.snackBar.open(
        `Could not open the link. ${e instanceof ShareLinkError ? e.message : 'Something went wrong'}.`,
        'Dismiss',
        { duration: 6000 },
      );
    }
    this.cdr.markForCheck();
    return true;
  }

  // ── Command palette ───────────────────────────────────────────────────────
  showPalette = false;
  paletteCommands: PaletteCommand[] = [];

  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const panel = this.activePanel ?? this.left;
    if (key === 'k' && !event.shiftKey) {
      event.preventDefault();
      this.showPalette ? this.closePalette() : this.openPalette();
    } else if (key === 's') {
      event.preventDefault(); // never the browser's "Save page"
      if (this.showSaveDialog) void this.confirmSave();
      else if (!this.showPalette)
        event.shiftKey ? this.openSaveDialog(panel) : void this.quickSave(panel);
    } else if (key === 'o' && !event.shiftKey && !this.showSaveDialog) {
      event.preventDefault();
      this.closePalette();
      this.openFileDialog(panel);
    }
  }

  /** Ctrl/Cmd+S: saves a pane that already has a saved file in place; otherwise asks for a name. */
  async quickSave(panel: PanelState): Promise<void> {
    if (!panel.jsonText.trim()) return;
    const file = this.files.find(panel.currentFileId);
    if (!file) return this.openSaveDialog(panel);
    this.savingPanel = panel;
    this.saveFileName = file.name;
    await this.confirmSave();
  }

  openPalette(): void {
    if (this.showSaveDialog) return;
    this.paletteCommands = this.buildCommands();
    this.showPalette = true;
    // Render now, so the palette's search box has focus before the next key arrives.
    // Otherwise a fast typist's first letters land in the editor and change the document.
    this.cdr.detectChanges();
  }

  closePalette(): void {
    this.showPalette = false;
  }

  /** Commands apply to the active pane; the pane name is shown as a hint. */
  private buildCommands(): PaletteCommand[] {
    const p = this.activePanel ?? this.left;
    this.ensureParsed(this.left, this.right);
    const pane = p === this.left ? 'Left' : 'Right';
    const ready = this.isReady(p);
    const cmds: PaletteCommand[] = [];
    const add = (group: string, label: string, run: () => void, scoped = false) =>
      cmds.push({ id: group + label, group, label, run, hint: scoped ? pane : undefined });

    if (ready) {
      add('Format', 'Format document', () => this.formatJson(p), true);
      add('Format', 'Minify', () => this.minifyJson(p), true);
      add('Format', 'Sort keys A → Z', () => this.sortKeys(p), true);
      add('Format', 'Unwrap embedded JSON strings', () => this.unwrapAllIn(p), true);
      add(
        'Convert',
        'Copy as YAML',
        () => this.copyConverted(p, 'YAML', async (v) => (await this.converters()).toYaml(v)),
        true,
      );
      add(
        'Convert',
        'Copy as TypeScript types',
        () =>
          this.copyConverted(p, 'TypeScript types', async (v) =>
            (await this.converters()).toTypeScript(v),
          ),
        true,
      );
      add('Copy', 'Copy with sensitive values hidden', () => this.copyRedacted(p), true);
      add(
        'Edit',
        'Hide sensitive values (passwords, tokens, emails, cards)',
        () => this.redactPane(p),
        true,
      );
      add(
        'Convert',
        'Copy as C# classes',
        () =>
          this.copyConverted(p, 'C# classes', async (v) => (await this.converters()).toCSharp(v)),
        true,
      );
      if (Array.isArray(p.parsedJson))
        add(
          'Convert',
          'Copy as JSON Lines',
          () => this.copyConverted(p, 'JSON Lines', async (v) => toJsonLines(v)),
          true,
        );
      add(
        'Convert',
        'Copy as JSON Schema',
        () =>
          this.copyConverted(p, 'JSON Schema', async (v) => {
            const { toJsonSchema } = await import('./utils/json-schema');
            return JSON.stringify(toJsonSchema(v), null, 2);
          }),
        true,
      );
    }
    add('Copy', 'Copy JSON', () => this.copyJson(p), true);
    add('Edit', 'Paste JSON from clipboard', () => this.pasteJson(p), true);
    add('File', 'Open file from disk…', () => this.openFileDialog(p), true);
    add('File', 'Copy share link', () => void this.shareLink());
    add('File', 'Copy share link, hiding sensitive values', () => void this.shareLink(true));
    if (p.jsonText.trim()) {
      add('File', 'Save…', () => this.openSaveDialog(p), true);
      add('File', 'Download as .json', () => this.downloadJson(p), true);
    }
    add('Edit', 'Clear', () => this.clearJson(p), true);
    if (p.errorLocation) add('Edit', 'Jump to the parse error', () => this.jumpToError(p), true);
    const fix = this.textFix(p);
    if (fix) add('Format', fix.label, () => this.applyFix(p), true);

    if (this.viewMode === 'edit') {
      for (const mode of PANEL_MODES) {
        if (mode !== p.mode) add('View', `Show as ${mode}`, () => this.setPanelMode(p, mode), true);
      }
    }
    if (this.isTreeView(p)) {
      add('View', 'Expand all nodes', () => this.expandAll(p), true);
      add('View', 'Collapse all nodes', () => this.collapseAll(p), true);
    }
    add('View', this.viewMode === 'edit' ? 'Switch to Compare' : 'Switch to Workspace', () =>
      this.setViewMode(this.viewMode === 'edit' ? 'compare' : 'edit'),
    );
    add('View', 'Swap left and right', () => this.swapPanels());
    if (this.compareReady) add('Compare', 'Copy JSON Patch (left → right)', () => this.copyPatch());
    if (this.isReady(this.left) && this.isReady(this.right)) {
      add('Validate', 'Validate the left pane against the schema in the right pane', () =>
        this.startValidation('left'),
      );
      add('Validate', 'Validate the right pane against the schema in the left pane', () =>
        this.startValidation('right'),
      );
    }
    if (this.validationDoc)
      add('Validate', 'Close schema validation', () => this.closeValidation());
    add('View', this.showFilesPanel ? 'Hide saved files' : 'Show saved files', () =>
      this.toggleFilesPanel(),
    );
    add('View', this.isDarkTheme ? 'Switch to light theme' : 'Switch to dark theme', () =>
      this.toggleTheme(),
    );

    for (const file of this.savedFiles) {
      add('Open', `“${file.name}” in the left pane`, () => this.openFileIn(file, this.left));
      add('Open', `“${file.name}” in the right pane`, () => this.openFileIn(file, this.right));
    }
    return cmds;
  }

  private converters() {
    return import('./utils/json-convert');
  }

  private async copyConverted(
    panel: PanelState,
    label: string,
    convert: (value: any) => Promise<string>,
  ): Promise<void> {
    this.ensureParsed(panel);
    let text: string;
    try {
      text = await convert(panel.parsedJson);
    } catch {
      this.snackBar.open(`Could not convert to ${label}`, '', { duration: 2500 });
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => this.snackBar.open(`Copied as ${label}`, '', { duration: 1800 }))
      .catch(() =>
        this.snackBar.open('Copy failed — clipboard access denied', '', { duration: 2500 }),
      );
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.showSaveDialog) {
      this.cancelSave();
      return;
    }
    if (this.showFilesPanel && this.isNarrow) {
      this.closeFilesPanel();
    }
  }

  /** Re-evaluates `isNarrow` (and the drawer backdrop) when the window resizes. */
  @HostListener('window:resize')
  onWindowResize(): void {
    // Intentionally empty: the listener only triggers a change-detection pass.
  }

  get isNarrow(): boolean {
    return window.innerWidth < NARROW_BREAKPOINT;
  }

  // The footer is read on every render; this memo keeps a large document from being
  // re-encoded or re-scanned each time.
  private textStats = new Map<PanelState, { text: string; bytes: number; lines: number }>();

  private stats(panel: PanelState): { bytes: number; lines: number } {
    let s = this.textStats.get(panel);
    if (!s || s.text !== panel.jsonText) {
      const text = panel.jsonText;
      let lines = text ? 1 : 0;
      for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines++;
      s = { text, bytes: text ? byteLength(text) : 0, lines };
      this.textStats.set(panel, s);
    }
    return s;
  }

  panelSize(panel: PanelState): string {
    return formatBytes(this.stats(panel).bytes);
  }

  panelLines(panel: PanelState): number {
    return this.stats(panel).lines;
  }

  /** True when the pane holds text that is not saved (or differs from its saved file). */
  isDirty(panel: PanelState): boolean {
    if (!panel.jsonText.trim()) return false;
    const file = this.files.find(panel.currentFileId);
    return !file || file.content !== panel.jsonText;
  }

  panelFileName(panel: PanelState): string | null {
    return this.files.find(panel.currentFileId)?.name ?? panel.sourceName;
  }

  // ── Local Storage ─────────────────────────────────────────────────────────
  get filteredFiles(): SavedFile[] {
    return this.files.filter(this.fileSearchQuery);
  }

  generateRandomName(): string {
    const adj = [
      'amber',
      'brave',
      'crisp',
      'dusk',
      'echo',
      'fern',
      'gilt',
      'haze',
      'ivory',
      'jade',
      'keen',
      'lunar',
      'misty',
      'noble',
      'opal',
      'pine',
      'quiet',
      'rusty',
      'sage',
      'teal',
    ];
    const noun = [
      'arc',
      'bay',
      'cove',
      'dale',
      'edge',
      'ford',
      'glade',
      'helm',
      'isle',
      'knoll',
      'lake',
      'mire',
      'nook',
      'oasis',
      'peak',
      'quay',
      'reef',
      'shore',
      'tide',
      'vale',
    ];
    const a = adj[Math.floor(Math.random() * adj.length)];
    const n = noun[Math.floor(Math.random() * noun.length)];
    const num = Math.floor(Math.random() * 1000);
    return `${a}-${n}-${num}`;
  }

  openSaveDialog(panel: PanelState): void {
    this.savingPanel = panel;
    this.activePanel = panel;
    if (panel.currentFileId) {
      const current = this.files.find(panel.currentFileId);
      this.saveFileName = current?.name ?? this.generateRandomName();
    } else if (panel.sourceName) {
      this.saveFileName = panel.sourceName.replace(/\.(json|txt)$/i, '');
    } else {
      this.saveFileName = this.generateRandomName();
    }
    this.showSaveDialog = true;
  }

  /** The file list and the pane only change once the browser has actually stored the file. */
  async confirmSave(): Promise<void> {
    const panel = this.savingPanel;
    if (!panel || !panel.jsonText.trim()) return;
    const name = this.saveFileName.trim() || this.generateRandomName();
    const existing = this.files.find(panel.currentFileId);
    this.showSaveDialog = false;
    this.savingPanel = null;
    let file: SavedFile;
    try {
      file = await this.files.save(name, panel.jsonText, existing?.id);
    } catch {
      this.snackBar.open(
        `Could not save "${name}": browser storage is full or unavailable`,
        'Dismiss',
        { duration: 6000 },
      );
      this.cdr.markForCheck();
      return;
    }
    panel.currentFileId = file.id;
    this.snackBar.open(existing ? `Saved "${name}"` : `Saved as "${name}"`, '', { duration: 2000 });
    this.cdr.markForCheck();
  }

  cancelSave(): void {
    this.showSaveDialog = false;
  }

  toggleFilesPanel(): void {
    this.showFilesPanel = !this.showFilesPanel;
    if (!this.showFilesPanel) {
      this.fileSearchQuery = '';
      this.renamingFileId = null;
    }
  }

  closeFilesPanel(): void {
    this.showFilesPanel = false;
    this.fileSearchQuery = '';
    this.renamingFileId = null;
  }

  loadFile(file: SavedFile): void {
    this.openFileIn(file, this.activePanel ?? this.left);
  }

  /** Opens a saved file in a specific pane, leaving the other pane untouched. */
  openFileIn(file: SavedFile, panel: PanelState, event?: Event): void {
    event?.stopPropagation();
    panel.currentFileId = file.id;
    panel.sourceName = null;
    this.onTextChange(file.content, panel);
    if (this.isNarrow) this.closeFilesPanel();
    const side = panel === this.left ? 'left' : 'right';
    this.snackBar.open(`Opened "${file.name}" in the ${side} pane`, '', { duration: 1500 });
  }

  isOpenIn(file: SavedFile, panel: PanelState): boolean {
    return panel.currentFileId === file.id;
  }

  async deleteFile(id: string, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    const file = this.files.find(id);
    if (!file) return;
    try {
      await this.files.delete(id);
    } catch {
      this.snackBar.open(`Could not delete "${file.name}"`, 'Dismiss', { duration: 4000 });
      return;
    }
    const panes = [this.left, this.right].filter((p) => p.currentFileId === id);
    panes.forEach((p) => (p.currentFileId = null));
    this.cdr.markForCheck();
    this.snackBar
      .open(`Deleted "${file.name}"`, 'Undo', { duration: 6000 })
      .onAction()
      .subscribe(() => void this.restoreFile(file, panes));
  }

  /** Undo for a delete: stores the file again and re-links the panes that showed it. */
  async restoreFile(file: SavedFile, panes: PanelState[]): Promise<void> {
    try {
      await this.files.restore(file);
    } catch {
      this.snackBar.open(`Could not restore "${file.name}"`, 'Dismiss', { duration: 4000 });
      return;
    }
    panes.filter((p) => p.currentFileId === null).forEach((p) => (p.currentFileId = file.id));
    this.cdr.markForCheck();
  }

  startRename(file: SavedFile, event?: MouseEvent): void {
    event?.stopPropagation();
    this.renamingFileId = file.id;
    this.renameValue = file.name;
  }

  async confirmRename(id: string): Promise<void> {
    const name = this.renameValue.trim();
    const file = this.files.find(id);
    this.renamingFileId = null;
    if (!name || !file || file.name === name) return;
    try {
      await this.files.rename(file, name);
    } catch {
      this.snackBar.open(`Could not rename "${file.name}"`, 'Dismiss', { duration: 4000 });
      return;
    }
    this.cdr.markForCheck();
  }

  cancelRename(): void {
    this.renamingFileId = null;
  }
}
