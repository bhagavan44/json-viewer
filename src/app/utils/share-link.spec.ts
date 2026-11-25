import { decodeShare, encodeShare, ShareLinkError, SharedState } from './share-link';

const STATE: SharedState = {
  left: '{\n  "name": "Priya",\n  "emoji": "🙂",\n  "big": 1234567890123456789\n}',
  right: '{"name":"Priya","status":"done"}',
  view: 'compare',
};

describe('share links', () => {
  it('round-trips both documents and the view, including non-ASCII text', async () => {
    const payload = await encodeShare(STATE, false);
    expect(payload.startsWith('r.')).toBe(true);
    expect(payload).toMatch(/^r\.[A-Za-z0-9_-]+$/); // safe to put in a URL hash
    expect(await decodeShare(payload)).toEqual(STATE);
  });

  it('round-trips through compression where the engine supports it', async () => {
    if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined')
      return;
    const payload = await encodeShare(STATE, true);
    expect(payload.startsWith('z.')).toBe(true);
    expect(await decodeShare(payload)).toEqual(STATE);
  });

  it('compresses repetitive documents well', async () => {
    if (typeof CompressionStream === 'undefined') return;
    const big: SharedState = {
      left: JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ id: i, kind: 'row' }))),
      right: '',
      view: 'edit',
    };
    const compressed = await encodeShare(big, true);
    const plain = await encodeShare(big, false);
    expect(compressed.length).toBeLessThan(plain.length / 3);
  });

  it('rejects garbage and links from other formats', async () => {
    await expect(decodeShare('nonsense')).rejects.toThrow(/valid share link/);
    await expect(decodeShare('x.AAAA')).rejects.toThrow(/valid share link/);
    await expect(decodeShare('r.' + btoa('{"v":2}'))).rejects.toThrow(/valid share link/);
    await expect(decodeShare('r.' + btoa('{"v":1,"l":1,"r":""}'))).rejects.toThrow(
      /valid share link/,
    );
  });

  it('refuses a small link that inflates past the size limit (decompression bomb)', async () => {
    if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined')
      return;
    const bomb = await encodeShare(
      { left: 'a'.repeat(11 * 1024 * 1024), right: '', view: 'edit' },
      true,
    );
    expect(bomb.length).toBeLessThan(40_000); // tiny on the wire
    await expect(decodeShare(bomb)).rejects.toThrow(/more than the allowed size/);
  });

  it('turns browser-internal decoding errors into a plain message', async () => {
    for (const damaged of ['z.not-real-data', 'r.@@@@', 'r.' + btoa('not json at all')]) {
      const error = await decodeShare(damaged).catch((e) => e);
      expect(error).toBeInstanceOf(ShareLinkError);
      expect(error.message).toMatch(/damaged or incomplete|valid share link/);
      expect(error.message).not.toMatch(/atob|Failed to execute|JSON/);
    }
  });
});
