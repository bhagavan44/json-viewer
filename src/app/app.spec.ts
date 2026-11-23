import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { MatMenuModule } from '@angular/material/menu';
import { App, LARGE_TEXT_CHARS, PARSE_DEBOUNCE_MS, SavedFile, WORKER_MIN_CHARS } from './app';
import { LosslessNumber } from './utils/json-parse';
import { JsonWorkerMessage, handleJsonRequest } from './utils/json-worker-handler';
import { SHARE_HASH_PREFIX, encodeShare } from './utils/share-link';

const file = (id: string, name: string, content: string): SavedFile => ({ id, name, content, savedAt: Date.now() });

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      declarations: [App],
      imports: [FormsModule, MatMenuModule],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
  });

  async function create(): Promise<App> {
    const app = TestBed.createComponent(App).componentInstance;
    await app.ready;
    return app;
  }

  it('should create the app', async () => {
    expect(await create()).toBeTruthy();
  });

  it('opens a saved file in the chosen pane only', async () => {
    const app = await create();
    const f = file('1', 'order', '{"a":1}');
    app.savedFiles = [f];

    app.openFileIn(f, app.right);

    expect(app.right.currentFileId).toBe('1');
    expect(app.right.parsedJson).toEqual({ a: 1 });
    expect(app.left.currentFileId).toBeNull();
    expect(app.isOpenIn(f, app.right)).toBe(true);
    expect(app.isOpenIn(f, app.left)).toBe(false);
  });

  it('searches saved files by name and by content', async () => {
    const app = await create();
    app.savedFiles = [file('1', 'orders', '{"sku":"KB-114"}'), file('2', 'users', '{"name":"Priya"}')];

    app.fileSearchQuery = 'order';
    expect(app.filteredFiles.map(f => f.id)).toEqual(['1']);

    app.fileSearchQuery = 'priya';
    expect(app.filteredFiles.map(f => f.id)).toEqual(['2']);
  });

  it('computes a diff only when both panes hold valid JSON', async () => {
    const app = await create();
    app.onTextChange('{"a":1}', app.left);
    expect(app.diff).toBeNull();
    expect(app.compareMessage).toContain('right');

    app.onTextChange('{"a":2,"b":true}', app.right);
    const d = app.diff!;
    expect(d.changed).toBe(1);
    expect(d.added).toBe(1);
    expect(app.diff).toBe(d); // memoized while the documents are unchanged
  });

  it('matches array items by key by default, and by index when turned off', async () => {
    const app = await create();
    app.onTextChange('{"lines":[{"sku":"A","qty":1},{"sku":"B","qty":2}]}', app.left);
    app.onTextChange('{"lines":[{"sku":"NEW","qty":5},{"sku":"A","qty":1},{"sku":"B","qty":3}]}', app.right);

    const byKey = app.diff!;
    expect(byKey.arrayKeys).toEqual(['sku']);
    expect(byKey.changes.map(c => [c.kind, c.path, c.rightPath])).toEqual([
      ['chg', '$.lines[1].qty', '$.lines[2].qty'],
      ['add', '$.lines[0]', undefined],
    ]);

    app.viewMode = 'compare';
    app.revealChange(byKey.changes[0]);
    expect(app.left.treeReveal).toEqual({ path: '$.lines[1].qty' });
    expect(app.right.treeReveal).toEqual({ path: '$.lines[2].qty' });
    app.left.treeReveal = app.right.treeReveal = null; // as the trees do once handled
    app.revealChange(byKey.changes[1]);
    expect(app.left.treeReveal).toBeNull(); // an addition has no place on the left
    expect(app.right.treeReveal).toEqual({ path: '$.lines[0]' });

    app.matchArrays = false;
    expect(app.diff!.arrayKeys).toEqual([]);
    expect(app.diff!).toMatchObject({ changed: 4, added: 1 }); // every pair differs once items shift
  });

  it('swaps the documents between panes', async () => {
    const app = await create();
    app.onTextChange('{"l":1}', app.left);
    app.onTextChange('{"r":2}', app.right);

    app.swapPanels();

    expect(app.left.parsedJson).toEqual({ r: 2 });
    expect(app.right.parsedJson).toEqual({ l: 1 });
  });

  it('flags a pane as dirty when it differs from its saved file', async () => {
    const app = await create();
    const f = file('1', 'order', '{"a":1}');
    app.savedFiles = [f];
    app.openFileIn(f, app.left);
    expect(app.isDirty(app.left)).toBe(false);

    app.onTextChange('{"a":2}', app.left);
    expect(app.isDirty(app.left)).toBe(true);
  });

  it('records where invalid JSON fails and requests a jump to it', async () => {
    const app = await create();
    app.onTextChange('{\n  "a": 1,\n  oops\n}', app.right);

    expect(app.right.isValid).toBe(false);
    expect(app.right.errorLocation).toEqual({ line: 3, column: 3 });
    expect(app.errorText(app.right)).not.toMatch(/position/);

    app.right.mode = 'tree';
    app.jumpToError(app.right);
    expect(app.right.mode).toBe('editor');
    expect(app.right.jumpRequest).toMatchObject({ line: 3, column: 3 });
    expect(app.activePanel).toBe(app.right);
  });

  it('builds palette commands for the active pane and every saved file', async () => {
    const app = await create();
    const f = file('1', 'order', '{"a":1}');
    app.savedFiles = [f];
    app.onTextChange('{"b":2,"a":1}', app.left);

    app.openPalette();
    const labels = app.paletteCommands.map(c => c.label);
    expect(app.showPalette).toBe(true);
    expect(labels).toContain('Format document');
    expect(labels).toContain('Copy as TypeScript types');
    expect(labels).toContain('Copy as JSON Schema');
    expect(labels).toContain('“order” in the right pane');

    app.paletteCommands.find(c => c.label === 'Sort keys A → Z')!.run();
    expect(app.left.jsonText).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('hides conversions when the active pane has no valid JSON', async () => {
    const app = await create();
    app.onTextChange('{oops', app.left);
    app.openPalette();
    const labels = app.paletteCommands.map(c => c.label);
    expect(labels).not.toContain('Format document');
    expect(labels).toContain('Jump to the parse error');
  });

  it('format, minify and sort keep 64-bit integers exact', async () => {
    const app = await create();
    app.onTextChange('{"b":1,"id":1234567890123456789}', app.left);

    app.formatJson(app.left);
    expect(app.left.jsonText).toContain('"id": 1234567890123456789');
    app.minifyJson(app.left);
    expect(app.left.jsonText).toBe('{"b":1,"id":1234567890123456789}');
    app.sortKeys(app.left);
    expect(app.left.jsonText).toContain('1234567890123456789');
  });

  it('sort keeps a "__proto__" key', async () => {
    const app = await create();
    app.onTextChange('{"b":1,"__proto__":{"x":1}}', app.left);
    app.sortKeys(app.left);
    expect(app.left.jsonText).toBe('{\n  "__proto__": {\n    "x": 1\n  },\n  "b": 1\n}');
  });

  it('swaps each pane’s view mode along with its document', async () => {
    const app = await create();
    app.left.mode = 'tree';
    app.swapPanels();
    expect(app.left.mode).toBe('editor');
    expect(app.right.mode).toBe('tree');
  });

  it('counts lines and bytes, and updates them when the text changes', async () => {
    const app = await create();
    expect(app.panelLines(app.left)).toBe(0);
    app.onTextChange('{\n  "é": 1\n}', app.left);
    expect(app.panelLines(app.left)).toBe(3);
    expect(app.panelSize(app.left)).toBe('13 B'); // 12 characters, "é" takes 2 bytes
    app.onTextChange('{}', app.left);
    expect(app.panelLines(app.left)).toBe(1);
  });

  describe('parsing large documents while typing', () => {
    /** A valid document longer than LARGE_TEXT_CHARS whose `n` field is `n`. */
    const large = (n: number) => `{"n":${n},"pad":"${'x'.repeat(LARGE_TEXT_CHARS)}"}`;

    afterEach(() => vi.useRealTimers());

    it('parses small text immediately', async () => {
      const app = await create();
      vi.useFakeTimers();
      app.onTextChange('{"a":1}', app.left);
      expect(app.left.parsedJson).toEqual({ a: 1 });
    });

    it('parses large text only after typing pauses', async () => {
      const app = await create();
      vi.useFakeTimers();
      app.onTextChange(large(1), app.left);
      expect(app.left.jsonText).toBe(large(1));
      expect(app.left.parsedJson).toBeNull();

      vi.advanceTimersByTime(PARSE_DEBOUNCE_MS - 1);
      app.onTextChange(large(2), app.left);
      vi.advanceTimersByTime(PARSE_DEBOUNCE_MS - 1);
      expect(app.left.parsedJson).toBeNull();

      vi.advanceTimersByTime(1);
      expect(app.left.isValid).toBe(true);
      expect(app.left.parsedJson.n).toBe(2);
    });

    it('formats the latest text right after typing', async () => {
      const app = await create();
      vi.useFakeTimers();
      app.onTextChange(large(1), app.left);
      vi.advanceTimersByTime(PARSE_DEBOUNCE_MS);
      app.onTextChange(large(2), app.left);

      app.formatJson(app.left);

      expect(app.left.jsonText).toContain('"n": 2');
      vi.advanceTimersByTime(PARSE_DEBOUNCE_MS);
      expect(app.left.jsonText).toContain('"n": 2');
    });

    it('drops a pending parse when the text is replaced', async () => {
      const app = await create();
      vi.useFakeTimers();
      app.onTextChange(large(1), app.left);
      app.onTextChange('{"a":1}', app.left);
      vi.advanceTimersByTime(PARSE_DEBOUNCE_MS);
      expect(app.left.parsedJson).toEqual({ a: 1 });
    });
  });

  describe('embedded JSON', () => {
    it('unwraps one string selected in the tree', async () => {
      const app = await create();
      app.onTextChange(JSON.stringify({ id: 1, body: JSON.stringify({ sku: 'A', qty: 2 }), other: '{"keep":1}' }), app.left);
      app.unwrapAt(app.left, '$.body');
      expect(app.left.parsedJson).toEqual({ id: 1, body: { sku: 'A', qty: 2 }, other: '{"keep":1}' });
      expect(app.left.jsonText).toContain('"body": {'); // pretty-printed
    });

    it('unwraps every embedded string and keeps big numbers exact', async () => {
      const app = await create();
      app.onTextChange(JSON.stringify({ a: JSON.stringify({ b: '[1]' }) }).replace('{', '{"id":1234567890123456789,'), app.left);
      app.unwrapAllIn(app.left);
      expect(app.left.parsedJson.a).toEqual({ b: [1] });
      expect(app.left.jsonText).toContain('"id": 1234567890123456789');
    });

    it('offers to unescape JSON pasted without its outer quotes, with undo', async () => {
      const app = await create();
      app.onTextChange(JSON.stringify('{"a":1}').slice(1, -1), app.left);
      expect(app.textFix(app.left)?.button).toBe('Unescape');
      app.openPalette();
      app.paletteCommands.find(c => c.label.startsWith('Unescape JSON'))!.run();
      expect(app.left.parsedJson).toEqual({ a: 1 });
      expect(app.textFix(app.left)).toBeNull();
    });
  });

  describe('fixing text that is not JSON', () => {
    it('repairs almost-JSON', async () => {
      const app = await create();
      const text = "{name: 'Priya', tags: ['a',], // note\n}";
      app.onTextChange(text, app.left);
      expect(app.textFix(app.left)?.button).toBe('Repair');
      app.applyFix(app.left);
      expect(app.left.parsedJson).toEqual({ name: 'Priya', tags: ['a'] });
    });

    it('turns JSON Lines into an array from the palette', async () => {
      const app = await create();
      app.onTextChange('{"a":1}\n{"a":2}\n', app.left);
      app.openPalette();
      app.paletteCommands.find(c => c.label === 'Convert JSON Lines to an array')!.run();
      expect(app.left.parsedJson).toEqual([{ a: 1 }, { a: 2 }]);
    });

    it('offers Copy as C# classes, and Copy as JSON Lines for arrays', async () => {
      const app = await create();
      app.onTextChange('[{"a":1}]', app.left);
      app.openPalette();
      const labels = app.paletteCommands.map(c => c.label);
      expect(labels).toContain('Copy as C# classes');
      expect(labels).toContain('Copy as JSON Lines');
    });
  });

  describe('keyboard shortcuts', () => {
    const press = (key: string, extra: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true, ...extra });
      document.dispatchEvent(event);
      return event;
    };

    it('Ctrl+S asks for a name the first time, then saves in place', async () => {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance;
      await app.ready;
      app.onTextChange('{"a":1}', app.left);

      expect(press('s').defaultPrevented).toBe(true);
      expect(app.showSaveDialog).toBe(true);
      app.saveFileName = 'doc';
      press('s'); // Ctrl+S in the dialog confirms it
      await vi.waitFor(() => expect(app.savedFiles).toHaveLength(1));

      app.onTextChange('{"a":2}', app.left);
      press('s');
      await vi.waitFor(() => expect(app.savedFiles[0].content).toBe('{"a":2}'));
      expect(app.showSaveDialog).toBe(false);
      expect(app.savedFiles).toHaveLength(1);

      press('S', { shiftKey: true }); // Save as
      expect(app.showSaveDialog).toBe(true);
    });

    it('Ctrl+O opens the file picker for the active pane', async () => {
      const app = await create();
      app.setActive(app.right);
      const picked = vi.fn();
      app.fileInputRef = { nativeElement: { click: picked } } as any;
      expect(press('o').defaultPrevented).toBe(true);
      expect(picked).toHaveBeenCalled();
      expect(app.fileTarget).toBe(app.right);
    });
  });

  describe('location sync', () => {
    const TEXT = '{\n  "customer": { "name": "Priya" },\n  "items": [ { "sku": "A" } ]\n}';

    it('follows the editor cursor and shows it as a breadcrumb', async () => {
      const app = await create();
      app.onTextChange(TEXT, app.left);
      app.onCursor(app.left, TEXT.indexOf('"A"'));
      expect(app.left.focusPath).toBe('$.items[0].sku');
      expect(app.breadcrumb(app.left).map(c => c.label)).toEqual(['$', 'items', '[0]', 'sku']);
    });

    it('selects the value in the editor when a breadcrumb step is clicked', async () => {
      const app = await create();
      app.onTextChange(TEXT, app.left);
      app.navigateTo(app.left, '$.customer');
      const { start, end } = app.left.editorSelect!;
      expect(TEXT.slice(start, end)).toBe('{ "name": "Priya" }');
      expect(app.left.focusPath).toBe('$.customer');
    });

    it('shows the same place after switching between editor and tree', async () => {
      const app = await create();
      app.onTextChange(TEXT, app.left);
      app.onCursor(app.left, TEXT.indexOf('Priya'));
      app.setPanelMode(app.left, 'tree');
      expect(app.left.treeReveal).toEqual({ path: '$.customer.name' });

      app.left.focusPath = '$.items[0]'; // selected in the tree
      app.setPanelMode(app.left, 'editor');
      const { start, end } = app.left.editorSelect!;
      expect(TEXT.slice(start, end)).toBe('{ "sku": "A" }');
    });

    it('has no location for invalid text', async () => {
      const app = await create();
      app.onTextChange('{"a": ', app.left);
      app.onCursor(app.left, 3);
      expect(app.left.focusPath).toBeNull();
      expect(app.breadcrumb(app.left)).toEqual([]);
    });
  });

  describe('schema validation', () => {
    const SCHEMA = '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","required":["id"],"properties":{"qty":{"type":"integer"}}}';

    it('validates one pane against the schema in the other, and marks the errors in the tree', async () => {
      const app = await create();
      app.onTextChange('{"qty":"two"}', app.left);
      app.onTextChange(SCHEMA, app.right);
      expect(app.canValidate(app.left)).toBe(true);
      expect(app.canValidate(app.right)).toBe(false);

      app.startValidation('left');
      const v = app.validation!;
      expect(v.result!.errors.map(e => e.path)).toEqual(['$', '$.qty']);
      expect(app.validation).toBe(v); // memoized
      expect(app.treeMarks(app.left)).toEqual({ $: 'del', '$.qty': 'del' });
      expect(app.treeMarks(app.right)).toBeNull();

      app.onTextChange('{"id":1,"qty":2}', app.left);
      expect(app.validation!.result!.errors).toEqual([]);
    });

    it('explains when a pane is missing or the schema cannot be used', async () => {
      const app = await create();
      app.onTextChange('{"a":1}', app.left);
      app.startValidation('left');
      expect(app.validation!.problem).toBe('Load a JSON Schema in the right pane.');
      app.onTextChange('{"$ref":"#/nowhere"}', app.right);
      expect(app.validation!.problem).toMatch(/^The schema cannot be used: Reference/);
    });

    it('reveals an error in the validated pane', async () => {
      const app = await create();
      app.onTextChange('{"qty":"two"}', app.left);
      app.onTextChange(SCHEMA, app.right);
      app.left.mode = 'tree';
      app.startValidation('left');
      app.revealSchemaError(app.validation!.result!.errors[1]);
      expect(app.left.treeReveal).toEqual({ path: '$.qty' });
    });
  });

  describe('compare: ignored paths and JSON Patch', () => {
    it('leaves ignored paths out of the comparison, and explains a bad path', async () => {
      const app = await create();
      app.onTextChange('{"id":1,"updatedAt":"a","items":[{"stamp":1,"q":1}]}', app.left);
      app.onTextChange('{"id":1,"updatedAt":"b","items":[{"stamp":2,"q":1}]}', app.right);
      expect(app.diff!.changed).toBe(2);

      app.ignoreText = '$.updatedAt, $..stamp';
      expect(app.diff!.changes).toEqual([]);
      expect(app.ignoreError).toBeNull();

      app.ignoreText = '$.items[';
      expect(app.diff!.changed).toBe(2);
      expect(app.ignoreError).toMatch(/^\$\.items\[: /);

      app.ignoreText = 'updatedAt';
      app.diff;
      expect(app.ignoreError).toBe('"updatedAt" is not a JSONPath (start it with $)');
    });

    it('copies a JSON Patch that skips ignored paths', async () => {
      const copied: string[] = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void copied.push(t) } });
      const app = await create();
      app.onTextChange('{"a":1,"at":1,"list":[1,2]}', app.left);
      app.onTextChange('{"a":2,"at":2,"list":[1]}', app.right);
      app.ignoreText = '$.at';
      app.copyPatch();
      await vi.waitFor(() => expect(copied).toHaveLength(1));
      expect(JSON.parse(copied[0])).toEqual([
        { op: 'replace', path: '/a', value: 2 },
        { op: 'remove', path: '/list/1' },
      ]);
    });

    it('keeps the ignored paths in the session', async () => {
      const first = await create();
      first.ignoreText = '$..updatedAt';
      await first.persistSession();
      expect((await create()).ignoreText).toBe('$..updatedAt');
    });
  });

  describe('large documents in the worker', () => {
    /** Stands in for the JSON worker: runs the same handler, replying asynchronously. */
    class InProcessWorker extends EventTarget {
      private terminated = false;
      postMessage({ id, request }: JsonWorkerMessage): void {
        const data = { id, reply: handleJsonRequest(structuredClone(request)) };
        setTimeout(() => {
          if (!this.terminated) this.dispatchEvent(new MessageEvent('message', { data }));
        });
      }
      terminate(): void {
        this.terminated = true;
      }
    }

    // Each side stays under LARGE_TEXT_CHARS (parsed at once) but together they reach the worker.
    const pad = 'x'.repeat(WORKER_MIN_CHARS / 2);
    const doc = (big: string, v: unknown) => `{"big":${big},"v":${JSON.stringify(v)},"pad":"${pad}"}`;

    beforeEach(() => vi.stubGlobal('Worker', InProcessWorker));
    afterEach(() => vi.unstubAllGlobals());

    it('compares in the worker and fills in the changed values', async () => {
      const app = await create();
      app.onTextChange(doc('12345678901234567890', 1), app.left);
      app.onTextChange(doc('12345678901234567891', 2), app.right);

      expect(app.diff).toBeNull();
      expect(app.diffPending).toBe(true);
      await vi.waitFor(() => expect(app.diff).not.toBeNull());

      expect(app.diffPending).toBe(false);
      const [big, v] = app.diff!.changes;
      expect(big).toMatchObject({ path: '$.big', kind: 'chg' });
      expect(big.before).toBeInstanceOf(LosslessNumber);
      expect(String(big.after)).toBe('12345678901234567891');
      expect(v).toEqual({ path: '$.v', kind: 'chg', before: 1, after: 2 });
      app.setViewMode('compare');
      expect(app.treeMarks(app.left)).toEqual({ '$.big': 'chg', '$.v': 'chg' });
    });

    it('keeps only the latest comparison when the options change while it runs', async () => {
      const app = await create();
      app.onTextChange(doc('1', 1), app.left);
      app.onTextChange(doc('2', 2), app.right);
      void app.diff;
      app.ignoreText = '$.big, nope';
      void app.diff;
      app.ignoreText = '$.big';
      expect(app.diff).toBeNull();

      await vi.waitFor(() => expect(app.diff).not.toBeNull());
      expect(app.diff!.changes.map((c) => c.path)).toEqual(['$.v']);
      expect(app.ignoreError).toBeNull();
    });

    it('keeps the last result and reports a bad ignore path at once while the worker runs', async () => {
      const app = await create();
      app.onTextChange(doc('1', 1), app.left);
      app.onTextChange(doc('2', 2), app.right);
      void app.diff;
      await vi.waitFor(() => expect(app.diff).not.toBeNull());
      const before = app.diff;

      app.ignoreText = 'big';
      expect(app.diff).toBe(before);
      expect(app.diffPending).toBe(true);
      expect(app.ignoreError).toBe('"big" is not a JSONPath (start it with $)');

      app.ignoreText = '$.big';
      expect(app.diff).toBe(before);
      expect(app.ignoreError).toBeNull();
      await vi.waitFor(() => expect(app.diffPending).toBe(false));
      expect(app.diff!.changes.map((c) => c.path)).toEqual(['$.v']);
    });

    it('validates in the worker', async () => {
      const app = await create();
      app.onTextChange(doc('1', 1), app.left);
      app.onTextChange(`{"type":"object","properties":{"v":{"type":"string"}},"description":"${pad}"}`, app.right);
      app.startValidation('left');

      expect(app.validation).toMatchObject({ docSide: 'left', pending: true });
      await vi.waitFor(() => expect(app.validation!.result).toBeDefined());
      expect(app.validation!.pending).toBeUndefined();
      expect(app.validation!.result!.errors.map((e) => e.path)).toEqual(['$.v']);
    });

    it('still compares small documents at once', async () => {
      const app = await create();
      app.onTextChange('{"a":1}', app.left);
      app.onTextChange('{"a":2}', app.right);
      expect(app.diff!.changed).toBe(1);
      expect(app.diffPending).toBe(false);
    });
  });

  describe('editing in the tree', () => {
    const TEXT = '{\n  "name": "Priya",\n  "lines": [\n    { "sku": "A" }\n  ]\n}';

    it('applies edits to the text, keeping its layout, and follows the edited node', async () => {
      const app = await create();
      app.onTextChange(TEXT, app.left);
      app.left.mode = 'tree';

      app.applyTreeEdit(app.left, { kind: 'set', path: '$.name', value: 'Sam' });
      expect(app.left.jsonText).toBe(TEXT.replace('Priya', 'Sam'));
      expect(app.left.treeReveal).toEqual({ path: '$.name' });

      app.applyTreeEdit(app.left, { kind: 'rename', path: '$.name', key: 'customer' });
      expect(app.left.parsedJson.customer).toBe('Sam');
      expect(app.left.focusPath).toBe('$.customer');

      app.applyTreeEdit(app.left, { kind: 'add', path: '$.lines', key: null, value: { sku: 'B' } });
      expect(app.left.parsedJson.lines).toEqual([{ sku: 'A' }, { sku: 'B' }]);
      expect(app.left.focusPath).toBe('$.lines[1]');

      app.applyTreeEdit(app.left, { kind: 'delete', path: '$.lines[0]' });
      expect(app.left.parsedJson.lines).toEqual([{ sku: 'B' }]);
      expect(app.left.focusPath).toBe('$.lines');
    });

    it('reports an edit it cannot make and leaves the text alone', async () => {
      const app = await create();
      app.onTextChange(TEXT, app.left);
      app.applyTreeEdit(app.left, { kind: 'delete', path: '$.missing' });
      expect(app.left.jsonText).toBe(TEXT);
    });
  });

  describe('sensitive data', () => {
    const DOC = '{"user":"priya","password":"hunter2","email":"priya@example.com"}';

    it('hides sensitive values in the pane', async () => {
      const app = await create();
      app.onTextChange(DOC, app.left);
      app.redactPane(app.left);
      expect(app.left.parsedJson).toEqual({ user: 'priya', password: '***', email: 'p***@example.com' });
    });

    it('copies a redacted version, and offers both in the palette', async () => {
      const copied: string[] = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void copied.push(t) } });
      const app = await create();
      app.onTextChange(DOC, app.left);
      app.copyRedacted(app.left);
      await vi.waitFor(() => expect(copied).toHaveLength(1));
      expect(JSON.parse(copied[0]).password).toBe('***');
      expect(app.left.parsedJson.password).toBe('hunter2'); // the pane is unchanged

      app.openPalette();
      const labels = app.paletteCommands.map(c => c.label);
      expect(labels).toContain('Copy with sensitive values hidden');
      expect(labels).toContain('Copy share link, hiding sensitive values');
    });

    it('shares a link with sensitive values hidden', async () => {
      const copied: string[] = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void copied.push(t) } });
      const app = await create();
      app.onTextChange(DOC, app.left);
      await app.shareLink(true);
      const other = await create();
      await other.openSharedHash(copied[0].slice(copied[0].indexOf('#')));
      expect(other.left.parsedJson.password).toBe('***');
    });

    it('refuses a hidden-values link when a pane is not valid JSON', async () => {
      const copied: string[] = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void copied.push(t) } });
      const app = await create();
      app.onTextChange('{"password": ', app.left);
      await app.shareLink(true);
      expect(copied).toEqual([]);
    });
  });

  const fakeFile = (name: string, text: string, size = text.length) => ({ name, size, text: async () => text }) as unknown as File;

  it('opens a picked file in the target pane and a second one in the other pane', async () => {
    const app = await create();

    await app.openFiles([fakeFile('a.json', '{"a":1}'), fakeFile('b.json', '{"b":2}')], app.right);

    expect(app.right.parsedJson).toEqual({ a: 1 });
    expect(app.right.sourceName).toBe('a.json');
    expect(app.left.parsedJson).toEqual({ b: 2 });
    expect(app.panelFileName(app.right)).toBe('a.json');
    expect(app.isDirty(app.right)).toBe(true); // not saved in the app yet
  });

  it('refuses files that are too large', async () => {
    const app = await create();
    await app.openFiles([fakeFile('huge.json', '{}', 30 * 1024 * 1024)], app.left);
    expect(app.left.jsonText).toBe('');
    expect(app.left.sourceName).toBeNull();
  });

  it('names downloads after the saved file or the opened file, and adds .json', async () => {
    const app = await create();
    expect(app.downloadName(app.left)).toBe('untitled.json');

    app.left.sourceName = 'orders.json';
    expect(app.downloadName(app.left)).toBe('orders.json');

    app.left.sourceName = 'orders';
    expect(app.downloadName(app.left)).toBe('orders.json');
  });

  it('proposes the opened file name (without extension) when saving', async () => {
    const app = await create();
    app.onTextChange('{"a":1}', app.left);
    app.left.sourceName = 'orders.json';
    app.openSaveDialog(app.left);
    expect(app.saveFileName).toBe('orders');
  });

  describe('saved files', () => {
    const stored = () => JSON.parse(localStorage.getItem('json-viewer-files') ?? '[]') as SavedFile[];

    async function save(app: App, panel = app.left, name = 'doc'): Promise<void> {
      app.openSaveDialog(panel);
      app.saveFileName = name;
      await app.confirmSave();
    }

    it('keeps files saved from two tabs', async () => {
      const tabA = await create();
      const tabB = await create();
      tabA.onTextChange('{"a":1}', tabA.left);
      tabB.onTextChange('{"b":2}', tabB.left);

      await save(tabA, tabA.left, 'from-a');
      await save(tabB, tabB.left, 'from-b');

      expect(stored().map(f => f.name).sort()).toEqual(['from-a', 'from-b']);
    });

    it('does not mark a pane as saved when the browser refuses to store it', async () => {
      const app = await create();
      app.onTextChange('{"a":1}', app.left);
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
      try {
        await save(app);
      } finally {
        setItem.mockRestore();
      }

      expect(app.savedFiles).toEqual([]);
      expect(app.left.currentFileId).toBeNull();
      expect(app.isDirty(app.left)).toBe(true);
    });

    it('updates the existing file when saving again', async () => {
      const app = await create();
      app.onTextChange('{"a":1}', app.left);
      await save(app, app.left, 'doc');
      const id = app.left.currentFileId;
      app.onTextChange('{"a":2}', app.left);
      await save(app, app.left, 'doc');

      expect(app.left.currentFileId).toBe(id);
      expect(stored()).toHaveLength(1);
      expect(stored()[0].content).toBe('{"a":2}');
    });

    it('deletes a file and can undo the delete', async () => {
      const app = await create();
      app.onTextChange('{"a":1}', app.left);
      await save(app);
      const [f] = app.savedFiles;

      await app.deleteFile(f.id, new MouseEvent('click'));
      expect(stored()).toEqual([]);
      expect(app.left.currentFileId).toBeNull();

      await app.restoreFile(f, [app.left]);
      expect(stored().map(x => x.id)).toEqual([f.id]);
      expect(app.left.currentFileId).toBe(f.id);
    });

    it('renames a file in storage', async () => {
      const app = await create();
      app.onTextChange('{"a":1}', app.left);
      await save(app, app.left, 'old');
      app.renameValue = 'new';
      await app.confirmRename(app.savedFiles[0].id);

      expect(app.savedFiles[0].name).toBe('new');
      expect(stored()[0].name).toBe('new');
    });
  });

  describe('session', () => {
    it('restores unsaved text, modes and the compare view after a reload', async () => {
      const first = await create();
      first.onTextChange('{"draft":1}', first.left);
      first.onTextChange('{"draft":2}', first.right);
      first.right.mode = 'tree';
      first.left.mode = 'table';
      first.viewMode = 'compare';
      await first.persistSession();

      const second = await create();
      expect(second.left.jsonText).toBe('{"draft":1}');
      expect(second.right.parsedJson).toEqual({ draft: 2 });
      expect(second.right.mode).toBe('tree');
      expect(second.left.mode).toBe('table');
      expect(second.viewMode).toBe('compare');
    });

    it('stores only a reference for a pane that mirrors a saved file', async () => {
      const first = await create();
      const f = file('1', 'order', '{"a":1}');
      first.savedFiles = [f];
      localStorage.setItem('json-viewer-files', JSON.stringify([f]));
      first.openFileIn(f, first.left);
      await first.persistSession();

      const stored = JSON.parse(localStorage.getItem('json-viewer-session')!);
      expect(stored.left.text).toBeNull();
      expect(stored.left.fileId).toBe('1');

      const second = await create();
      expect(second.left.jsonText).toBe('{"a":1}');
      expect(second.left.currentFileId).toBe('1');
    });

    it('keeps edits made to a saved file that have not been saved yet', async () => {
      const first = await create();
      const f = file('1', 'order', '{"a":1}');
      first.savedFiles = [f];
      localStorage.setItem('json-viewer-files', JSON.stringify([f]));
      first.openFileIn(f, first.left);
      first.onTextChange('{"a":99}', first.left);
      await first.persistSession();

      expect((await create()).left.jsonText).toBe('{"a":99}');
    });

    it('saves the session at once when the page is hidden', async () => {
      const app = await create();
      app.onTextChange('{"last":"edit"}', app.left);
      app.ngDoCheck(); // schedules the delayed save
      window.dispatchEvent(new Event('pagehide'));
      expect(JSON.parse(localStorage.getItem('json-viewer-session')!).left.text).toBe('{"last":"edit"}');
    });

    it('keeps the session in IndexedDB when it is available, and moves an old one over', async () => {
      const { IDBFactory, IDBTransaction } = await import('fake-indexeddb');
      const g = globalThis as any;
      const original = { indexedDB: g.indexedDB, IDBTransaction: g.IDBTransaction };
      g.indexedDB = new IDBFactory();
      g.IDBTransaction = IDBTransaction;
      try {
        localStorage.setItem(
          'json-viewer-session',
          JSON.stringify({
            version: 1,
            left: { text: '{"old":1}', fileId: null, sourceName: null, mode: 'editor' },
            right: { text: null, fileId: null, sourceName: null, mode: 'editor' },
            viewMode: 'edit',
            active: 'left',
          }),
        );
        const first = await create();
        expect(first.left.jsonText).toBe('{"old":1}');
        expect(localStorage.getItem('json-viewer-session')).toBeNull();

        first.onTextChange('{"new":2}', first.left);
        await first.persistSession();
        expect(localStorage.getItem('json-viewer-session')).toBeNull();

        expect((await create()).left.jsonText).toBe('{"new":2}');
      } finally {
        g.indexedDB = original.indexedDB;
        g.IDBTransaction = original.IDBTransaction;
      }
    });

    it('ignores a corrupt session and falls back to the most recent saved files', async () => {
      localStorage.setItem('json-viewer-session', '{not json');
      localStorage.setItem('json-viewer-files', JSON.stringify([file('1', 'one', '{"n":1}'), file('2', 'two', '{"n":2}')]));
      const app = await create();
      expect(app.left.parsedJson).toEqual({ n: 1 });
      expect(app.right.parsedJson).toEqual({ n: 2 });
    });
  });

  describe('share links', () => {
    let copied: string[];
    beforeEach(() => {
      copied = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (t: string) => void copied.push(t) },
      });
    });

    it('copies a link containing both panes and the view', async () => {
      const app = await create();
      app.onTextChange('{"left":1}', app.left);
      app.onTextChange('{"right":2}', app.right);
      app.viewMode = 'compare';

      await app.shareLink();

      expect(copied).toHaveLength(1);
      expect(copied[0]).toContain('#s=');
      const hash = copied[0].slice(copied[0].indexOf('#'));

      const other = await create();
      expect(await other.openSharedHash(hash)).toBe(true);
      expect(other.left.parsedJson).toEqual({ left: 1 });
      expect(other.right.parsedJson).toEqual({ right: 2 });
      expect(other.viewMode).toBe('compare');
    });

    it('opens a share link found in the address bar at startup, over the restored session', async () => {
      const first = await create();
      first.onTextChange('{"session":1}', first.left);
      await first.persistSession();

      const payload = await encodeShare({ left: '{"shared":1}', right: '', view: 'edit' });
      history.replaceState(null, '', location.pathname + SHARE_HASH_PREFIX + payload);
      try {
        const app = await create();
        expect(app.left.parsedJson).toEqual({ shared: 1 });
        expect(location.hash).toBe(''); // consumed, so a reload shows the session
      } finally {
        history.replaceState(null, '', location.pathname);
      }
    });

    it('does not create a link when there is nothing to share', async () => {
      const app = await create();
      await app.shareLink();
      expect(copied).toEqual([]);
    });

    it('ignores other hashes, and leaves the panes alone when a link is broken', async () => {
      const app = await create();
      app.onTextChange('{"keep":1}', app.left);

      expect(await app.openSharedHash('#something-else')).toBe(false);
      expect(await app.openSharedHash('#s=garbage')).toBe(true); // recognised, but could not be opened
      expect(app.left.parsedJson).toEqual({ keep: 1 });
    });
  });
});
