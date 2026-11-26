import { SavedFile } from './file-store';
import { PaneState, SessionState, readSession, toSession } from './session';

const file: SavedFile = { id: '1', name: 'order', content: '{"a":1}', savedAt: 100 };

const pane = (over: Partial<PaneState> = {}): PaneState => ({
  jsonText: '',
  currentFileId: null,
  sourceName: null,
  mode: 'editor',
  ...over,
});

const state = (over: Partial<SessionState> = {}): SessionState => ({
  left: pane(),
  right: pane(),
  viewMode: 'edit',
  active: 'left',
  matchArrays: true,
  ignoreText: '',
  savedFiles: [file],
  ...over,
});

describe('session', () => {
  describe('toSession', () => {
    it('keeps unsaved text, the modes and the view', () => {
      const session = toSession(
        state({
          left: pane({ jsonText: '{"draft":1}', sourceName: 'draft.json', mode: 'tree' }),
          viewMode: 'compare',
          active: 'right',
          matchArrays: false,
          ignoreText: '$..id',
        }),
        1000,
      );
      expect(session).toEqual({
        version: 1,
        left: { text: '{"draft":1}', fileId: null, sourceName: 'draft.json', mode: 'tree' },
        right: { text: '', fileId: null, sourceName: null, mode: 'editor' },
        viewMode: 'compare',
        active: 'right',
        matchArrays: false,
        ignoreText: '$..id',
      });
    });

    it('stores only the id of a pane that mirrors a saved file', () => {
      const session = toSession(
        state({ left: pane({ jsonText: file.content, currentFileId: '1' }) }),
        1000,
      );
      expect(session.left).toEqual({ text: null, fileId: '1', sourceName: null, mode: 'editor' });
    });

    it('keeps edits to a saved file that have not been saved yet', () => {
      const session = toSession(
        state({ left: pane({ jsonText: '{"a":2}', currentFileId: '1' }) }),
        1000,
      );
      expect(session.left.text).toBe('{"a":2}');
    });

    it('leaves out text longer than the limit', () => {
      const session = toSession(state({ left: pane({ jsonText: 'x'.repeat(11) }) }), 10);
      expect(session.left.text).toBeNull();
    });
  });

  describe('readSession', () => {
    it('round-trips a stored session', () => {
      const original = state({
        left: pane({ jsonText: file.content, currentFileId: '1', mode: 'table' }),
        right: pane({ jsonText: '{"b":2}', sourceName: 'b.json' }),
        viewMode: 'compare',
        active: 'right',
        matchArrays: false,
        ignoreText: '$..at',
      });
      const { savedFiles, ...rest } = original;
      expect(readSession(toSession(original, 1000), savedFiles)).toEqual(rest);
    });

    it('rejects a missing, corrupt or unknown session', () => {
      expect(readSession(null, [])).toBeNull();
      expect(readSession('{not json', [])).toBeNull();
      expect(readSession({ version: 2, left: {}, right: {} }, [])).toBeNull();
      expect(readSession({ version: 1, left: {} }, [])).toBeNull();
    });

    it('drops a file that no longer exists, and falls back to defaults for unknown values', () => {
      const restored = readSession(
        {
          version: 1,
          left: { text: null, fileId: 'gone', sourceName: 7, mode: 'chart' },
          right: { text: '{}', fileId: null, sourceName: null, mode: 'tree' },
          viewMode: 'split',
          active: 'middle',
        },
        [file],
      );
      expect(restored).toEqual({
        left: pane(),
        right: pane({ jsonText: '{}', mode: 'tree' }),
        viewMode: 'edit',
        active: 'left',
        matchArrays: true,
        ignoreText: '',
      });
    });
  });
});
