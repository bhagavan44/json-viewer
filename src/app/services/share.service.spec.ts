import { SHARE_MAX_CHARS, ShareLinkError, SharedState } from '../utils/share-link';
import { ShareService } from './share.service';

const STATE: SharedState = { left: '{"left":1}', right: '{"right":2}', view: 'compare' };

/** Text that compresses badly, so its link is long. */
function noise(length: number): string {
  let seed = 1;
  let text = '';
  while (text.length < length) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    text += seed.toString(36);
  }
  return text;
}

describe('ShareService', () => {
  let service: ShareService;
  let copied: string[];
  const useClipboard = (writeText: (text: string) => Promise<void>) =>
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

  beforeEach(() => {
    service = new ShareService();
    copied = [];
    useClipboard(async (text) => void copied.push(text));
  });
  afterEach(() => {
    service.ngOnDestroy();
    history.replaceState(null, '', location.pathname);
  });

  it('copies a link to this page that reads back as the same documents and view', async () => {
    expect(await service.copyLink(STATE)).toEqual({ status: 'copied', long: false });
    expect(copied).toHaveLength(1);
    expect(copied[0].startsWith(`${location.origin}${location.pathname}#s=`)).toBe(true);

    const hash = copied[0].slice(copied[0].indexOf('#'));
    expect(service.isShareLink(hash)).toBe(true);
    expect(await service.read(hash)).toEqual(STATE);
  });

  it('says when a link is long, and copies nothing when it is too large', async () => {
    const long = await service.copyLink({ left: noise(20_000), right: '', view: 'edit' });
    expect(long).toEqual({ status: 'copied', long: true });

    copied = [];
    const huge = await service.copyLink({
      left: noise(SHARE_MAX_CHARS * 2),
      right: '',
      view: 'edit',
    });
    expect(huge).toEqual({ status: 'too-large' });
    expect(copied).toEqual([]);
  });

  it('reports a clipboard that refuses the link', async () => {
    useClipboard(() => Promise.reject(new Error('denied')));
    expect(await service.copyLink(STATE)).toEqual({ status: 'denied' });
  });

  it('recognises only share links, and rejects a broken one with a plain message', async () => {
    expect(service.isShareLink('')).toBe(false);
    expect(service.isShareLink('#section')).toBe(false);
    expect(service.isShareLink('#s=garbage')).toBe(true);
    await expect(service.read('#s=garbage')).rejects.toBeInstanceOf(ShareLinkError);
  });

  it('drops the hash but keeps the rest of the address', () => {
    history.replaceState(null, '', `${location.pathname}?x=1#s=abc`);
    service.clearHash();
    expect(location.hash).toBe('');
    expect(location.search).toBe('?x=1');
  });

  it('reports hash changes until it is destroyed', () => {
    const seen: string[] = [];
    service.watch((hash) => seen.push(hash));
    history.replaceState(null, '', `${location.pathname}#s=one`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(seen).toEqual(['#s=one']);

    service.ngOnDestroy();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(seen).toEqual(['#s=one']);
  });
});
