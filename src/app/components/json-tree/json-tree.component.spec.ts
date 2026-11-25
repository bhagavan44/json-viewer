import { ScrollingModule } from '@angular/cdk/scrolling';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { JsonTreeNodeComponent } from '../json-tree-node/json-tree-node.component';
import { JsonTreeComponent, TreeEdit } from './json-tree.component';

const DOC = { id: 1, user: { name: 'Priya', tags: ['a', 'b'] }, items: [{ qty: 1 }, { qty: 2 }] };

describe('JsonTreeComponent', () => {
  // jsdom has no layout or scrolling; the CDK viewport calls scrollTo when the selection moves.
  beforeAll(() => {
    (Element.prototype as any).scrollTo ??= () => undefined;
  });

  function create(inputs: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({
      declarations: [JsonTreeComponent, JsonTreeNodeComponent],
      imports: [FormsModule, ScrollingModule],
      schemas: [NO_ERRORS_SCHEMA],
    });
    const fixture = TestBed.createComponent(JsonTreeComponent);
    fixture.componentRef.setInput('data', DOC);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return { fixture, tree: fixture.componentInstance };
  }

  const labels = (tree: JsonTreeComponent) =>
    tree.rows.map((r) => (r.closing ? '}' : (r.node.key ?? '$') + '@' + r.depth));

  it('starts with only the root open and flattens to a single row of children', () => {
    const { tree } = create();
    expect(labels(tree)).toEqual(['$@0', 'id@1', 'user@1', 'items@1', '}']);
  });

  it('toggling a node adds and removes its rows, including the closing bracket', () => {
    const { tree } = create();
    const user = tree.rows.find((r) => r.node.key === 'user')!.node;

    tree.ctx.toggle(user);
    expect(labels(tree)).toEqual([
      '$@0',
      'id@1',
      'user@1',
      'name@2',
      'tags@2',
      '}',
      'items@1',
      '}',
    ]);

    tree.ctx.toggle(user);
    expect(tree.rows).toHaveLength(5);
  });

  it('search expands to matches, and filter mode keeps only matches and their ancestors', () => {
    const { tree } = create();
    tree.query = 'priya';
    tree.onQueryChange();
    expect(tree.matchPaths).toEqual(['$.user.name']);
    expect(tree.rows.some((r) => r.node.key === 'name')).toBe(true);

    tree.toggleFilter();
    const keys = tree.rows.filter((r) => !r.closing).map((r) => r.node.key ?? '$');
    expect(keys).toEqual(['$', 'user', 'name']);
  });

  it('only shows branches containing a difference when "changes only" is on', () => {
    const { fixture, tree } = create({ diffMarks: { '$.items[1].qty': 'chg' }, changesOnly: true });
    fixture.detectChanges();
    const keys = tree.rows.filter((r) => !r.closing).map((r) => r.node.key ?? '$');
    expect(keys).toEqual(['$', 'items', '1', 'qty']);
  });

  it('opens the branches that lead to a difference when comparing', () => {
    const { tree } = create({ diffMarks: { '$.items[1].qty': 'chg' } });
    const keys = tree.rows.filter((r) => !r.closing).map((r) => r.node.key ?? '$');
    expect(keys).toContain('qty');
    expect(keys).not.toContain('name'); // unchanged branch stays closed
  });

  it('moves the selection with the arrow keys and expands with ArrowRight', () => {
    const { tree } = create();
    const press = (key: string) => tree.onKeydown(new KeyboardEvent('keydown', { key }));

    press('ArrowDown'); // $
    press('ArrowDown'); // id
    press('ArrowDown'); // user
    expect(tree.ctx.selectedPath()).toBe('$.user');

    press('ArrowRight'); // expand
    expect(tree.rows.some((r) => r.node.key === 'name')).toBe(true);
    press('ArrowRight'); // into first child
    expect(tree.ctx.selectedPath()).toBe('$.user.name');

    press('ArrowLeft'); // up to parent
    expect(tree.ctx.selectedPath()).toBe('$.user');
    press('ArrowLeft'); // collapse
    expect(tree.rows.some((r) => r.node.key === 'name')).toBe(false);
  });

  it('marks strings that hold JSON and asks the app to unwrap the selected one', () => {
    const { tree } = create({ data: { body: '{"sku":"A"}', note: 'plain {x}' } });
    const [body, note] = tree.rootNodes[0].children;
    expect(body.embedsJson).toBe(true);
    expect(note.embedsJson).toBe(false);

    const emitted: string[] = [];
    tree.unwrap.subscribe((p) => emitted.push(p));
    tree.ctx.select(note);
    expect(tree.selectedEmbedsJson).toBe(false);
    tree.ctx.select(body);
    expect(tree.selectedEmbedsJson).toBe(true);
    tree.unwrapSelected();
    expect(emitted).toEqual(['$.body']);
  });

  it('treats text starting with $ as a JSONPath: matches whole nodes and reveals them', () => {
    const { tree } = create();
    tree.query = '$.items[?(@.qty > 1)]';
    tree.onQueryChange();

    expect(tree.ctx.pathMode).toBe(true);
    expect(tree.ctx.query).toBe(''); // nothing to highlight inside the text
    expect(tree.matchPaths).toEqual(['$.items[1]']);
    expect(tree.queryError).toBeNull();
    expect(tree.rows.some((r) => r.node.path === '$.items[1]')).toBe(true); // ancestors opened

    tree.toggleFilter();
    const keys = tree.rows.filter((r) => !r.closing).map((r) => r.node.key ?? '$');
    expect(keys).toEqual(['$', 'items', '1']);
  });

  it('keeps plain searches for text that merely contains a dollar sign', () => {
    const { tree } = create({ data: { price: '$5.00', other: 'x' } });
    tree.query = '$5';
    tree.onQueryChange();
    expect(tree.ctx.pathMode).toBe(false);
    expect(tree.matchPaths).toEqual(['$.price']);
  });

  it('explains an invalid JSONPath instead of showing stale matches', () => {
    const { tree } = create();
    tree.query = '$.items[';
    tree.onQueryChange();
    expect(tree.queryError).toBeTruthy();
    expect(tree.matchPaths).toEqual([]);

    tree.toggleFilter();
    expect(tree.rows).toHaveLength(0);
    expect(tree.emptyMessage).toMatch(/^Invalid path:/);
  });

  it('reveals a requested path once, and reports only the selections the user makes', async () => {
    const { fixture, tree } = create();
    const selected: string[] = [];
    let handled = 0;
    tree.selectionChange.subscribe((p) => selected.push(p));
    tree.revealHandled.subscribe(() => handled++);

    fixture.componentRef.setInput('reveal', { path: '$.user.tags[1]' });
    fixture.detectChanges();
    await Promise.resolve();
    expect(tree.ctx.selectedPath()).toBe('$.user.tags[1]');
    expect(tree.rows.some((r) => r.node.path === '$.user.tags[1]')).toBe(true); // ancestors opened
    expect(handled).toBe(1);
    expect(selected).toEqual([]); // the owner asked for it, so it is not reported back

    tree.ctx.select(tree.rows.find((r) => r.node.key === 'id')!.node);
    expect(selected).toEqual(['$.id']);
  });

  it('can mark only the node itself, for schema errors', () => {
    const { tree } = create({ diffMarks: { $: 'del', '$.user.name': 'del' }, inheritMarks: false });
    const marked = (key: string) =>
      tree.rows.find((r) => !r.closing && r.node.key === key)!.node.mark;
    expect(tree.rootNodes[0].mark).toBe('del');
    expect(marked('id')).toBeNull(); // not painted by the root's mark
    expect(tree.rootNodes[0].children[1].hasChange).toBe(true); // "user" leads to an error, so it opens
    expect(marked('name')).toBe('del');
  });

  describe('lazy nodes', () => {
    const BIG = { items: Array.from({ length: 100_000 }, (_, i) => ({ id: i, tags: ['x'] })) };

    it('creates nodes only for the rows that are open', () => {
      const { tree } = create({ data: BIG });
      const items = tree.rootNodes[0].children[0];
      expect(labels(tree)).toEqual(['$@0', 'items@1', '}']);
      expect(items.size).toBe(100_000);
      expect(items.loadedChildren).toHaveLength(0);

      tree.ctx.toggle(items);
      expect(items.loadedChildren).toHaveLength(100_000);
      expect(items.children.every((c) => c.loadedChildren.length === 0)).toBe(true);
    });

    it('creates only the chain to a search match, a difference or a revealed path', async () => {
      const { fixture, tree } = create({ data: BIG });
      const items = tree.rootNodes[0].children[0];

      tree.query = '$.items[99999].id';
      tree.onQueryChange();
      expect(tree.matchPaths).toEqual(['$.items[99999].id']);
      expect(items.children[99999].loadedChildren).toHaveLength(2);
      expect(items.children[5].loadedChildren).toHaveLength(0);
      tree.clearQuery();

      fixture.componentRef.setInput('diffMarks', { '$.items[7].tags[0]': 'chg' });
      fixture.detectChanges();
      const rebuilt = tree.rootNodes[0].children[0];
      expect(rebuilt.children[7].hasChange).toBe(true);
      expect(rebuilt.children[8].hasChange).toBe(false);
      expect(rebuilt.children[8].loadedChildren).toHaveLength(0);

      fixture.componentRef.setInput('reveal', { path: '$.items[42].tags[0]' });
      fixture.detectChanges();
      await Promise.resolve();
      expect(tree.ctx.selectedPath()).toBe('$.items[42].tags[0]');
      expect(rebuilt.children[41].loadedChildren).toHaveLength(0);
    });

    it('collapse all closes nodes that were opened before a rebuild', () => {
      const { fixture, tree } = create();
      tree.ctx.toggle(tree.rows.find((r) => r.node.key === 'user')!.node);
      fixture.componentRef.setInput('data', { ...DOC });
      fixture.componentRef.setInput('collapseAllTrigger', 1);
      fixture.detectChanges();
      tree.ctx.toggle(tree.rootNodes[0]);
      expect(labels(tree)).toEqual(['$@0', 'id@1', 'user@1', 'items@1', '}']);
    });
  });

  describe('editing', () => {
    function selectKey(tree: JsonTreeComponent, key: string) {
      tree.ctx.select(tree.rows.find((r) => !r.closing && r.node.key === key)!.node);
    }

    it('edits a value with its type, and explains input it cannot read', () => {
      const { tree } = create();
      const edits: TreeEdit[] = [];
      tree.edit.subscribe((e) => edits.push(e));
      selectKey(tree, 'id');
      tree.startEdit();
      expect(tree.form).toMatchObject({ mode: 'edit', type: 'number', text: '1' });

      tree.form!.text = 'abc';
      tree.applyForm();
      expect(tree.form!.error).toBe('Not a number');
      expect(edits).toEqual([]);

      tree.form!.type = 'string';
      tree.applyForm();
      expect(edits).toEqual([{ kind: 'set', path: '$.id', value: 'abc' }]);
      expect(tree.form).toBeNull();
    });

    it('renames only to a free key, and adds members and items', () => {
      const { tree } = create();
      const edits: TreeEdit[] = [];
      tree.edit.subscribe((e) => edits.push(e));
      selectKey(tree, 'id');
      tree.startRename();
      tree.form!.key = 'user';
      tree.applyForm();
      expect(tree.form!.error).toBe('"user" already exists here');
      tree.form!.key = 'orderId';
      tree.applyForm();

      selectKey(tree, 'items');
      expect(tree.canRename).toBe(true);
      tree.startAdd();
      tree.form!.type = 'json';
      tree.form!.text = '{"qty": 3}';
      tree.applyForm();
      expect(edits).toEqual([
        { kind: 'rename', path: '$.id', key: 'orderId' },
        { kind: 'add', path: '$.items', key: null, value: { qty: 3 } },
      ]);
    });

    it('uses F2 to edit or rename and Delete to delete, never the root', () => {
      const { tree } = create();
      const edits: TreeEdit[] = [];
      tree.edit.subscribe((e) => edits.push(e));
      const press = (key: string) => tree.onKeydown(new KeyboardEvent('keydown', { key }));

      tree.ctx.select(tree.rootNodes[0]);
      expect(tree.canDelete).toBe(false);
      press('Delete');
      expect(edits).toEqual([]);

      selectKey(tree, 'user');
      press('F2');
      expect(tree.form!.mode).toBe('rename'); // an object member: rename
      tree.cancelForm();
      selectKey(tree, 'id');
      press('F2');
      expect(tree.form!.mode).toBe('edit'); // a value: edit
      tree.cancelForm();
      press('Delete');
      expect(edits).toEqual([{ kind: 'delete', path: '$.id' }]);
    });
  });
});
