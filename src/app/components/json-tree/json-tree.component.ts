import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DiffKind } from '../../utils/json-diff';
import { stringifyJson } from '../../utils/json-parse';
import { looksLikeJson, parseEmbedded } from '../../utils/json-unwrap';
import {
  EditError,
  InputType,
  inputTextOf,
  inputTypeOf,
  valueFromInput,
} from '../../utils/json-edit';
import { JsonPathError, looksLikeJsonPath, queryJsonPath } from '../../utils/json-path';
import { byteLength, childPath, formatBytes, JsonType, jsonTypeOf } from '../../utils/json-utils';

export interface JsonNode {
  key: string | null;
  value: any;
  type: JsonType;
  children: JsonNode[];
  collapsed: boolean;
  /** JSONPath-style path, unique within the document (e.g. `$.items[1].qty`). */
  path: string;
  /** True when the parent is an array, so the key is an index. */
  inArray: boolean;
  /** Diff mark for this node, inherited from the nearest marked ancestor. */
  mark: DiffKind | null;
  /** True when the mark was set on this node itself (not inherited). */
  markOwn: boolean;
  /** This node, or something inside it, differs from the other document. */
  hasChange: boolean;
  /** The search query matches this node's key or value. */
  match: boolean;
  /** Visible in "filter" mode: a match, inside a match, or containing one. */
  searchVisible: boolean;
  /** A string that looks like it holds a JSON object or array. */
  embedsJson: boolean;
}

/** Shared, mutable state handed to every node so the recursion needs no event plumbing. */
export interface TreeContext {
  /** Text to highlight inside values. Empty while a JSONPath is active. */
  query: string;
  /** Something is typed in the search box (plain text or a JSONPath). */
  active: boolean;
  /** The search box holds a JSONPath, so whole rows are marked instead of text. */
  pathMode: boolean;
  filter: boolean;
  changesOnly: boolean;
  selectedPath: string | null;
  activePath: string | null;
  flashPath: string | null;
  select: (node: JsonNode) => void;
  toggle: (node: JsonNode) => void;
  /** Replaces a string holding JSON with the parsed value. */
  unwrap: (node: JsonNode) => void;
}

/** A change the user asks for in the tree; the owner applies it to the document text. */
export type TreeEdit =
  | { kind: 'set'; path: string; value: unknown }
  | { kind: 'rename'; path: string; key: string }
  | { kind: 'delete'; path: string }
  | { kind: 'add'; path: string; key: string | null; value: unknown };

/** The inline form in the inspector bar. */
export interface EditForm {
  mode: 'edit' | 'rename' | 'add';
  key: string;
  type: InputType;
  text: string;
  error: string | null;
}

/** One rendered line: a node, or the closing bracket of an expanded container. */
export interface TreeRow {
  node: JsonNode;
  depth: number;
  closing: boolean;
}

/** Fixed row height (px). The virtual scroller needs every row to be exactly this tall. */
export const TREE_ROW_HEIGHT = 26;
/** Above this many nodes, search waits for a pause in typing. */
const LARGE_TREE_NODES = 20_000;

@Component({
  selector: 'app-json-tree',
  standalone: false,
  templateUrl: './json-tree.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './json-tree.component.scss',
})
export class JsonTreeComponent implements OnChanges, OnDestroy {
  @Input() data: any = null;
  @Input() error: string | null = null;
  @Input() isEmpty = false;
  @Input() expandAllTrigger = 0;
  @Input() collapseAllTrigger = 0;
  /** Marks from a diff, keyed by node path. Null when not comparing. */
  @Input() diffMarks: Record<string, DiffKind> | null = null;
  /**
   * Whether a mark covers everything inside the node (an added or removed subtree in
   * Compare) or only the node itself (a schema error).
   */
  @Input() inheritMarks = true;
  @Input() changesOnly = false;
  /**
   * A request to expand, select and scroll to a path. Each request is a new object;
   * `revealHandled` fires once it is done, so the owner can clear it and a tree
   * created later does not replay it.
   */
  @Input() reveal: { path: string } | null = null;
  @Output() revealHandled = new EventEmitter<void>();
  /** The path the user selected (by click or keyboard). */
  @Output() selectionChange = new EventEmitter<string>();
  /** Edits made in the inspector (or with F2 / Delete). */
  @Output() edit = new EventEmitter<TreeEdit>();

  form: EditForm | null = null;
  readonly inputTypes: InputType[] = ['string', 'number', 'boolean', 'null', 'json'];

  /** Focuses the form's first field when it opens. */
  @ViewChild('formField')
  set formField(el: ElementRef<HTMLInputElement> | undefined) {
    if (el) setTimeout(() => el.nativeElement.focus());
  }
  /** Emits the path of a string the user wants replaced by the JSON it holds. */
  @Output() unwrap = new EventEmitter<string>();

  rootNodes: JsonNode[] = [];
  /** Visible lines, flattened from the tree. Only the ones in view are rendered. */
  rows: TreeRow[] = [];
  readonly rowHeight = TREE_ROW_HEIGHT;
  query = '';
  /** The trimmed search text; `query` is the raw input value. */
  queryText = '';
  /** Why the typed JSONPath could not be evaluated, if it could not. */
  queryError: string | null = null;
  private queryPaths = new Set<string>();
  filterMode = false;
  matchPaths: string[] = [];
  activeIdx = -1;
  selected: JsonNode | null = null;
  selectedMeta = '';
  /** The selected value is a string that parses as a JSON object or array. */
  selectedEmbedsJson = false;

  readonly ctx: TreeContext = {
    query: '',
    active: false,
    pathMode: false,
    filter: false,
    changesOnly: false,
    selectedPath: null,
    activePath: null,
    flashPath: null,
    select: (node) => this.setSelected(node, true),
    toggle: (node) => {
      node.collapsed = !node.collapsed;
      this.refresh();
    },
    unwrap: (node) => this.unwrap.emit(node.path),
  };

  private viewport?: CdkVirtualScrollViewport;
  private resizeObserver?: ResizeObserver;

  /** The viewport only exists while there is data; keep it measured when its size changes. */
  @ViewChild(CdkVirtualScrollViewport)
  set viewportRef(vp: CdkVirtualScrollViewport | undefined) {
    if (vp === this.viewport) return;
    this.resizeObserver?.disconnect();
    this.viewport = vp;
    if (vp && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => vp.checkViewportSize());
      this.resizeObserver.observe(vp.elementRef.nativeElement);
    }
  }

  private prevExpandAll = 0;
  private prevCollapseAll = 0;

  constructor(
    private host: ElementRef<HTMLElement>,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  get hasData(): boolean {
    return !this.error && !this.isEmpty && this.rootNodes.length > 0;
  }

  get noChanges(): boolean {
    return !!this.diffMarks && Object.keys(this.diffMarks).length === 0;
  }

  ngOnDestroy(): void {
    clearTimeout(this.queryTimer);
    this.resizeObserver?.disconnect();
  }

  trackRow = (_: number, row: TreeRow): string => row.node.path + (row.closing ? '}' : '');

  ngOnChanges(changes: SimpleChanges): void {
    this.ctx.changesOnly = this.changesOnly && !!this.diffMarks;

    if (changes['data'] || changes['diffMarks'] || changes['inheritMarks']) {
      this.buildTree();
    }
    if (changes['expandAllTrigger'] && this.expandAllTrigger !== this.prevExpandAll) {
      this.prevExpandAll = this.expandAllTrigger;
      this.setAllCollapsed(false, this.rootNodes);
    }
    if (changes['collapseAllTrigger'] && this.collapseAllTrigger !== this.prevCollapseAll) {
      this.prevCollapseAll = this.collapseAllTrigger;
      this.setAllCollapsed(true, this.rootNodes);
    }
    if (changes['reveal'] && this.reveal) {
      this.revealPath(this.reveal.path);
      // Deferred, so the owner is not changed in the middle of its own change detection.
      Promise.resolve().then(() => this.revealHandled.emit());
    }
    this.refresh();
  }

  /** Rebuilds the flat list of visible rows after any change to structure, search or filters. */
  private refresh(): void {
    const rows: TreeRow[] = [];
    const visible = (n: JsonNode): boolean =>
      !(this.ctx.changesOnly && !n.hasChange) &&
      !(this.ctx.filter && this.ctx.active && !n.searchVisible);
    const walk = (n: JsonNode, depth: number): void => {
      if (!visible(n)) return;
      rows.push({ node: n, depth, closing: false });
      if (n.children.length && !n.collapsed) {
        for (const child of n.children) walk(child, depth + 1);
        rows.push({ node: n, depth, closing: true });
      }
    };
    this.rootNodes.forEach((n) => walk(n, 0));
    this.rows = rows;
  }

  get emptyMessage(): string {
    if (this.ctx.changesOnly) return 'No differences on this side';
    return this.queryError
      ? `Invalid path: ${this.queryError}`
      : `Nothing matches “${this.queryText}”`;
  }

  // ── Search ────────────────────────────────────────────────────────────────
  private nodeCount = 0;
  private queryTimer?: ReturnType<typeof setTimeout>;

  /** Searches as you type; in large documents, waits for a pause in typing first. */
  queueQueryChange(): void {
    clearTimeout(this.queryTimer);
    if (this.nodeCount < LARGE_TREE_NODES) return this.onQueryChange();
    this.queryTimer = setTimeout(() => {
      this.onQueryChange();
      this.cdr.markForCheck(); // no zone.js: a timer alone does not trigger rendering
    }, 200);
  }

  onQueryChange(): void {
    clearTimeout(this.queryTimer);
    this.queryText = this.query.trim();
    this.ctx.active = !!this.queryText;
    this.ctx.pathMode = this.ctx.active && looksLikeJsonPath(this.queryText);
    this.ctx.query = this.ctx.pathMode ? '' : this.queryText;
    this.applySearch();
    this.activeIdx = -1;
    if (this.matchPaths.length) this.goTo(0);
    else this.ctx.activePath = null;
  }

  clearQuery(): void {
    this.query = '';
    this.onQueryChange();
  }

  toggleFilter(): void {
    this.filterMode = !this.filterMode;
    this.ctx.filter = this.filterMode;
    this.refresh();
  }

  step(direction: 1 | -1): void {
    if (!this.matchPaths.length) return;
    this.goTo(this.activeIdx < 0 ? 0 : this.activeIdx + direction);
  }

  private goTo(index: number): void {
    const total = this.matchPaths.length;
    if (!total) return;
    this.activeIdx = (index + total) % total;
    const path = this.matchPaths[this.activeIdx];
    this.ctx.activePath = path;
    this.scrollToPath(path);
  }

  private applySearch(): void {
    const active = this.ctx.active;
    const q = this.queryText.toLowerCase();
    this.matchPaths = [];
    this.queryPaths = new Set();
    this.queryError = null;
    if (active && this.ctx.pathMode) {
      try {
        for (const hit of queryJsonPath(this.data, this.queryText)) this.queryPaths.add(hit.path);
      } catch (e) {
        this.queryError = e instanceof JsonPathError ? e.message : 'Could not evaluate the path';
      }
    }
    const visit = (node: JsonNode, forced: boolean): boolean => {
      node.match =
        active && (this.ctx.pathMode ? this.queryPaths.has(node.path) : this.nodeMatches(node, q));
      if (node.match) this.matchPaths.push(node.path);
      const inherited = forced || node.match;
      let descendantMatch = false;
      for (const child of node.children) {
        if (visit(child, inherited)) descendantMatch = true;
      }
      node.searchVisible = !active || inherited || descendantMatch;
      if (active && descendantMatch) node.collapsed = false;
      return node.match || descendantMatch;
    };
    this.rootNodes.forEach((n) => visit(n, false));
    this.refresh();
  }

  private nodeMatches(node: JsonNode, q: string): boolean {
    if (node.key !== null && node.key.toLowerCase().includes(q)) return true;
    return node.children.length === 0 && String(node.value).toLowerCase().includes(q);
  }

  // ── Selection, copy ───────────────────────────────────────────────────────
  /** `notify` reports the selection to the owner (for selections the user made). */
  private setSelected(node: JsonNode, notify = false): void {
    if (notify) this.selectionChange.emit(node.path);
    if (this.selected?.path !== node.path) this.form = null;
    this.ctx.selectedPath = node.path;
    this.selected = node;
    this.selectedEmbedsJson = node.embedsJson && parseEmbedded(node.value) !== undefined;
    const size = () => formatBytes(byteLength(stringifyJson(node.value)));
    if (node.type === 'object') {
      this.selectedMeta = `object · ${node.children.length} keys · ${size()}`;
    } else if (node.type === 'array') {
      this.selectedMeta = `array · ${node.children.length} items · ${size()}`;
    } else if (node.type === 'string') {
      this.selectedMeta = `string · ${node.value.length} chars`;
    } else {
      this.selectedMeta = node.type;
    }
  }

  clearSelection(): void {
    this.form = null;
    this.selected = null;
    this.selectedEmbedsJson = false;
    this.ctx.selectedPath = null;
  }

  unwrapSelected(): void {
    if (this.selected) this.unwrap.emit(this.selected.path);
  }

  // ── Editing ───────────────────────────────────────────────────────────────
  get canRename(): boolean {
    return !!this.selected && this.selected.key !== null && !this.selected.inArray;
  }

  get canAdd(): boolean {
    return !!this.selected && (this.selected.type === 'object' || this.selected.type === 'array');
  }

  get canDelete(): boolean {
    return !!this.selected && this.selected.path !== '$';
  }

  startEdit(): void {
    if (!this.selected) return;
    const v = this.selected.value;
    this.form = { mode: 'edit', key: '', type: inputTypeOf(v), text: inputTextOf(v), error: null };
  }

  startRename(): void {
    if (this.canRename)
      this.form = {
        mode: 'rename',
        key: this.selected!.key!,
        type: 'string',
        text: '',
        error: null,
      };
  }

  startAdd(): void {
    if (this.canAdd) this.form = { mode: 'add', key: '', type: 'string', text: '', error: null };
  }

  deleteSelected(): void {
    if (this.canDelete) this.edit.emit({ kind: 'delete', path: this.selected!.path });
  }

  cancelForm(): void {
    this.form = null;
    this.focusTree();
  }

  /** Checks the form and emits the edit; problems are shown in the form instead. */
  applyForm(): void {
    const form = this.form;
    const node = this.selected;
    if (!form || !node) return;
    try {
      if (form.mode === 'rename') {
        const key = form.key;
        if (!key) throw new EditError('Type a name');
        if (key !== node.key && this.siblingKeys(node).includes(key))
          throw new EditError(`"${key}" already exists here`);
        if (key !== node.key) this.edit.emit({ kind: 'rename', path: node.path, key });
      } else if (form.mode === 'edit') {
        this.edit.emit({
          kind: 'set',
          path: node.path,
          value: valueFromInput(form.type, form.text),
        });
      } else {
        const isObject = node.type === 'object';
        if (isObject && !form.key) throw new EditError('Type a name');
        if (isObject && node.children.some((c) => c.key === form.key))
          throw new EditError(`"${form.key}" already exists here`);
        this.edit.emit({
          kind: 'add',
          path: node.path,
          key: isObject ? form.key : null,
          value: valueFromInput(form.type, form.text),
        });
      }
    } catch (e) {
      form.error = e instanceof EditError ? e.message : 'Cannot apply this edit';
      return;
    }
    this.form = null;
    this.focusTree();
  }

  private siblingKeys(node: JsonNode): string[] {
    const chain = this.findChain(this.rootNodes, node.path, []);
    const parent = chain && chain.length > 1 ? chain[chain.length - 2] : null;
    return parent ? parent.children.map((c) => c.key ?? '') : [];
  }

  private focusTree(): void {
    setTimeout(() => this.viewport?.elementRef.nativeElement.focus());
  }

  copyPath(): void {
    if (this.selected) this.copy(this.selected.path, 'Path');
  }

  copyValue(): void {
    if (!this.selected) return;
    const v = this.selected.value;
    this.copy(typeof v === 'string' ? v : stringifyJson(v, 2), 'Value');
  }

  private copy(text: string, label: string): void {
    navigator.clipboard
      .writeText(text)
      .then(() => this.snackBar.open(`${label} copied`, '', { duration: 1500 }))
      .catch(() =>
        this.snackBar.open('Copy failed — clipboard access denied', '', { duration: 2500 }),
      );
  }

  // ── Reveal / scroll ───────────────────────────────────────────────────────
  private revealPath(path: string): void {
    const chain = this.findChain(this.rootNodes, path, []);
    if (!chain) return;
    chain.slice(0, -1).forEach((n) => (n.collapsed = false));
    this.refresh();
    this.setSelected(chain[chain.length - 1]);
    this.ctx.flashPath = path;
    this.scrollToPath(path);
    setTimeout(() => {
      this.ctx.flashPath = null;
      this.cdr.markForCheck(); // no zone.js: a timer alone does not trigger rendering
    }, 1200);
  }

  private findChain(nodes: JsonNode[], path: string, trail: JsonNode[]): JsonNode[] | null {
    for (const node of nodes) {
      if (node.path === path) return [...trail, node];
      if (node.children.length && path.startsWith(node.path)) {
        const found = this.findChain(node.children, path, [...trail, node]);
        if (found) return found;
      }
    }
    return null;
  }

  private rowIndex(path: string | null): number {
    return path ? this.rows.findIndex((r) => !r.closing && r.node.path === path) : -1;
  }

  /** Centers the row for `path` in the viewport (after the new rows have rendered). */
  private scrollToPath(path: string): void {
    setTimeout(() => {
      const i = this.rowIndex(path);
      const vp = this.viewport;
      if (i < 0 || !vp) return;
      const offset = i * TREE_ROW_HEIGHT - vp.getViewportSize() / 2 + TREE_ROW_HEIGHT / 2;
      vp.scrollToOffset(Math.max(0, offset), 'smooth');
    });
  }

  private ensureVisible(index: number): void {
    const vp = this.viewport;
    if (!vp || index < 0) return;
    const top = index * TREE_ROW_HEIGHT;
    const scrolled = vp.measureScrollOffset('top');
    const size = vp.getViewportSize();
    if (top < scrolled) vp.scrollToOffset(top);
    else if (top + TREE_ROW_HEIGHT > scrolled + size)
      vp.scrollToOffset(top + TREE_ROW_HEIGHT - size);
  }

  // ── Keyboard navigation ───────────────────────────────────────────────────
  onKeydown(event: KeyboardEvent): void {
    if (!this.rows.length || event.ctrlKey || event.metaKey || event.altKey) return;
    const nodeRows = (from: number, step: 1 | -1): number => {
      for (let i = from + step; i >= 0 && i < this.rows.length; i += step)
        if (!this.rows[i].closing) return i;
      return -1;
    };
    const current = this.rowIndex(this.ctx.selectedPath);
    const node = current >= 0 ? this.rows[current].node : null;
    const isContainer = !!node && node.children.length > 0;
    let target = -2; // -2: key not handled

    switch (event.key) {
      case 'ArrowDown':
        target = current < 0 ? nodeRows(-1, 1) : nodeRows(current, 1);
        break;
      case 'ArrowUp':
        target = current < 0 ? nodeRows(this.rows.length, -1) : nodeRows(current, -1);
        break;
      case 'Home':
        target = nodeRows(-1, 1);
        break;
      case 'End':
        target = nodeRows(this.rows.length, -1);
        break;
      case 'ArrowRight':
        if (node && isContainer && node.collapsed) this.ctx.toggle(node);
        else if (node && isContainer) target = nodeRows(current, 1);
        else target = -1;
        break;
      case 'ArrowLeft':
        if (node && isContainer && !node.collapsed) this.ctx.toggle(node);
        else if (node) {
          const chain = this.findChain(this.rootNodes, node.path, []);
          const parent = chain && chain.length > 1 ? chain[chain.length - 2] : null;
          target = parent ? this.rowIndex(parent.path) : -1;
        }
        break;
      case 'Enter':
      case ' ':
        if (node && isContainer) this.ctx.toggle(node);
        break;
      case 'F2':
        // Rename a member that holds an object or array; edit any other value.
        if (node && isContainer && this.canRename) this.startRename();
        else if (node) this.startEdit();
        break;
      case 'Delete':
        this.deleteSelected();
        break;
      default:
        return;
    }
    event.preventDefault();
    if (target >= 0) {
      this.setSelected(this.rows[target].node, true);
      this.ensureVisible(target);
    }
  }

  // ── Tree construction ─────────────────────────────────────────────────────
  private buildTree(): void {
    if (this.data === null || this.data === undefined) {
      this.rootNodes = [];
      this.rows = [];
      this.matchPaths = [];
      this.clearSelection();
      return;
    }
    const collapseState = new Map<string, boolean>();
    this.snapshotState(this.rootNodes, collapseState);
    this.nodeCount = 0;
    this.rootNodes = [this.createNode(null, this.data, '$', false, collapseState, null)];
    this.applySearch();

    const keep = this.ctx.selectedPath
      ? this.findChain(this.rootNodes, this.ctx.selectedPath, [])
      : null;
    if (keep) this.setSelected(keep[keep.length - 1]);
    else this.clearSelection();
  }

  private snapshotState(nodes: JsonNode[], map: Map<string, boolean>): void {
    for (const node of nodes) {
      map.set(node.path, node.collapsed);
      if (node.children.length) this.snapshotState(node.children, map);
    }
  }

  private createNode(
    key: string | null,
    value: any,
    path: string,
    inArray: boolean,
    collapseState: Map<string, boolean>,
    inheritedMark: DiffKind | null,
  ): JsonNode {
    const type = jsonTypeOf(value);
    const ownMark = this.diffMarks?.[path] ?? null;
    const mark = ownMark ?? inheritedMark;
    const passDown = this.inheritMarks ? mark : null;
    this.nodeCount++;
    const node: JsonNode = {
      key,
      value,
      type,
      children: [],
      collapsed: collapseState.has(path) ? collapseState.get(path)! : path !== '$',
      path,
      inArray,
      mark,
      markOwn: !!ownMark,
      hasChange: !!mark,
      match: false,
      searchVisible: true,
      embedsJson: type === 'string' && looksLikeJson(value),
    };

    if (type === 'object') {
      node.children = Object.entries(value).map(([k, v]) =>
        this.createNode(k, v, childPath(path, k, false), false, collapseState, passDown),
      );
    } else if (type === 'array') {
      node.children = (value as any[]).map((v, i) =>
        this.createNode(String(i), v, childPath(path, i, true), true, collapseState, passDown),
      );
    }
    if (node.children.some((c) => c.hasChange)) node.hasChange = true;
    // When comparing, open the branches that lead to a difference (but not the inside of a
    // wholly added or removed subtree), so large documents are not expanded in full.
    if (this.diffMarks && node.hasChange && !inheritedMark) node.collapsed = false;
    return node;
  }

  private setAllCollapsed(collapsed: boolean, nodes: JsonNode[]): void {
    for (const node of nodes) {
      node.collapsed = collapsed;
      if (node.children.length > 0) {
        this.setAllCollapsed(collapsed, node.children);
      }
    }
  }
}
