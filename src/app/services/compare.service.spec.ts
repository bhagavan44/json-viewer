import { LosslessNumber, parseJson } from '../utils/json-parse';
import { JsonWorkerMessage, handleJsonRequest } from '../utils/json-worker-handler';
import { CompareService, WORKER_MIN_CHARS } from './compare.service';

const OPTIONS = { matchArrays: true, ignoreText: '' };
const SCHEMA = { type: 'object', properties: { qty: { type: 'number' } }, required: ['id'] };

describe('CompareService', () => {
  let service: CompareService;
  let results: number;
  const create = () => {
    service = new CompareService();
    results = 0;
    service.onResult(() => results++);
  };
  beforeEach(create);
  afterEach(() => service.ngOnDestroy());

  it('compares two documents and reuses the result until a document or an option changes', () => {
    const left = { a: 1, at: 1 };
    const right = { a: 2, at: 2 };
    const diff = service.diff(left, right, OPTIONS)!;
    expect(diff.changes.map((c) => c.path)).toEqual(['$.a', '$.at']);
    expect(service.diff(left, right, OPTIONS)).toBe(diff);
    expect(service.diffPending).toBe(false);

    const ignored = service.diff(left, right, { ...OPTIONS, ignoreText: '$.at' })!;
    expect(ignored.changes.map((c) => c.path)).toEqual(['$.a']);
    expect(service.ignoreError).toBeNull();

    expect(service.diff(left, { a: 1, at: 1 }, OPTIONS)!.changes).toEqual([]);
  });

  it('explains ignored paths it cannot use, and compares without them', () => {
    const diff = service.diff({ a: 1 }, { a: 2 }, { ...OPTIONS, ignoreText: 'a' })!;
    expect(diff.changed).toBe(1);
    expect(service.ignoreError).toBe('"a" is not a JSONPath (start it with $)');
  });

  it('builds a JSON Patch that skips ignored paths', async () => {
    const ops = await service.patch(
      { a: 1, at: 1, list: [1, 2] },
      { a: 2, at: 2, list: [1] },
      '$.at',
    );
    expect(ops).toEqual([
      { op: 'replace', path: '/a', value: 2 },
      { op: 'remove', path: '/list/1' },
    ]);
  });

  it('validates a document, pending until the validator loads, then reuses the result', async () => {
    const doc = { qty: 'two' };
    const view = service.validate(doc, SCHEMA, 'left');
    expect(view).toEqual({ docSide: 'left', schemaSide: 'right', pending: true });

    await vi.waitFor(() => expect(results).toBe(1));
    const done = service.validate(doc, SCHEMA, 'left');
    expect(done.result!.errors.map((e) => e.path)).toEqual(['$', '$.qty']);
    expect(service.validate(doc, SCHEMA, 'left')).toBe(done);
    expect(service.validate(doc, SCHEMA, 'right')).not.toBe(done);
  });

  it('explains a schema it cannot use', async () => {
    const doc = {};
    const schema = { $ref: '#/nowhere' };
    service.validate(doc, schema, 'right');
    await vi.waitFor(() => expect(results).toBe(1));
    expect(service.validate(doc, schema, 'right')).toMatchObject({
      docSide: 'right',
      schemaSide: 'left',
      problem: expect.stringMatching(/^The schema cannot be used: /),
    });
  });

  it('marks the paths of schema errors, and reuses the marks for the same errors', () => {
    const errors = [
      { path: '$', message: 'missing id' },
      { path: '$.qty', message: 'not a number' },
    ] as Parameters<CompareService['errorMarks']>[0];
    const marks = service.errorMarks(errors);
    expect(marks).toEqual({ $: 'del', '$.qty': 'del' });
    expect(service.errorMarks(errors)).toBe(marks);
  });

  describe('large documents', () => {
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

    const pad = 'x'.repeat(WORKER_MIN_CHARS / 2);
    /** Parses `text` and records its source, as the app does for each pane. */
    const parsed = (text: string) => {
      const doc = parseJson(text);
      service.noteSource(doc, text);
      return doc;
    };

    beforeEach(() => {
      service.ngOnDestroy();
      vi.stubGlobal('Worker', InProcessWorker);
      create();
    });
    afterEach(() => vi.unstubAllGlobals());

    it('compares in the worker, keeping every digit of the changed values', async () => {
      const left = parsed(`{"big":12345678901234567890,"pad":"${pad}"}`);
      const right = parsed(`{"big":12345678901234567891,"pad":"${pad}"}`);

      expect(service.diff(left, right, OPTIONS)).toBeNull();
      expect(service.diffPending).toBe(true);
      await vi.waitFor(() => expect(results).toBe(1));

      expect(service.diffPending).toBe(false);
      const [change] = service.diff(left, right, OPTIONS)!.changes;
      expect(change).toMatchObject({ path: '$.big', kind: 'chg' });
      expect(change.before).toBeInstanceOf(LosslessNumber);
      expect(String(change.after)).toBe('12345678901234567891');
    });

    it('validates in the worker', async () => {
      const doc = parsed(`{"qty":"two","pad":"${pad}"}`);
      const schema = parsed(`{"properties":{"qty":{"type":"number"}},"description":"${pad}"}`);

      expect(service.validate(doc, schema, 'left').pending).toBe(true);
      await vi.waitFor(() => expect(results).toBe(1));
      expect(service.validate(doc, schema, 'left').result!.errors.map((e) => e.path)).toEqual([
        '$.qty',
      ]);
    });

    it('compares small documents at once, even with a worker', () => {
      expect(service.diff(parsed('{"a":1}'), parsed('{"a":2}'), OPTIONS)!.changed).toBe(1);
      expect(service.diffPending).toBe(false);
    });
  });
});
