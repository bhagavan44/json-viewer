import { FileStore } from '../utils/file-store';
import { SessionState } from '../utils/session';
import { SESSION_SAVE_DELAY_MS, SessionService } from './session.service';

function memoryStore(stored: unknown = null): FileStore & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    maxSessionText: 1000,
    load: async () => [],
    put: async () => undefined,
    delete: async () => undefined,
    watch: () => () => undefined,
    loadSession: async () => stored,
    saveSession: async (session) => void saved.push(session),
  };
}

const state = (jsonText = ''): SessionState => ({
  left: { jsonText, currentFileId: null, sourceName: null, mode: 'editor' },
  right: { jsonText: '', currentFileId: null, sourceName: null, mode: 'editor' },
  viewMode: 'edit',
  active: 'left',
  matchArrays: true,
  ignoreText: '',
  savedFiles: [],
});

describe('SessionService', () => {
  let service: SessionService;
  beforeEach(() => {
    vi.useFakeTimers();
    service = new SessionService();
  });
  afterEach(() => {
    service.ngOnDestroy();
    vi.useRealTimers();
  });

  it('restores a stored session, and returns null when there is none or it cannot be read', async () => {
    const store = memoryStore();
    service.start(store, () => state('{"a":1}'));
    await service.persist();

    expect((await service.restore(memoryStore(store.saved[0]), []))?.left.jsonText).toBe('{"a":1}');
    expect(await service.restore(memoryStore(), [])).toBeNull();
    const failing = { ...memoryStore(), loadSession: () => Promise.reject(new Error('blocked')) };
    expect(await service.restore(failing, [])).toBeNull();
  });

  it('saves nothing before it is started', async () => {
    const store = memoryStore();
    service.check();
    service.flush();
    await service.persist();
    await vi.runAllTimersAsync();
    expect(store.saved).toEqual([]);
  });

  it('saves once the state has been still for a moment, and only when it changed', async () => {
    const store = memoryStore();
    let current = state('{"a":1}');
    service.start(store, () => current);

    service.check();
    await vi.advanceTimersByTimeAsync(SESSION_SAVE_DELAY_MS - 1);
    expect(store.saved).toHaveLength(0);
    current = state('{"a":2}');
    service.check(); // restarts the delay
    await vi.advanceTimersByTimeAsync(SESSION_SAVE_DELAY_MS - 1);
    expect(store.saved).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.saved).toHaveLength(1);

    service.check(); // nothing changed
    await vi.runAllTimersAsync();
    expect(store.saved).toHaveLength(1);
  });

  it('saves at once when flushed, instead of after the delay', async () => {
    const store = memoryStore();
    service.start(store, () => state('{"last":1}'));
    service.check();
    service.flush();
    await vi.runAllTimersAsync();
    expect(store.saved).toHaveLength(1);
    expect((store.saved[0] as { left: { text: string } }).left.text).toBe('{"last":1}');
  });

  it('ignores a store that refuses to save', async () => {
    const store = { ...memoryStore(), saveSession: () => Promise.reject(new Error('full')) };
    service.start(store, () => state());
    await expect(service.persist()).resolves.toBeUndefined();
  });
});
