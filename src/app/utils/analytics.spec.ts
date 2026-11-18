import { stripUrlHash } from './analytics';

describe('analytics', () => {
  it('removes the URL hash, where share links keep the document', () => {
    const event = { type: 'pageview' as const, url: 'https://example.com/?a=1#s=abc123' };
    expect(stripUrlHash(event)).toEqual({ type: 'pageview', url: 'https://example.com/?a=1' });
  });

  it('removes an empty hash marker', () => {
    expect(stripUrlHash({ url: 'https://example.com/#' }).url).toBe('https://example.com/');
  });

  it('leaves a URL without a hash unchanged', () => {
    const event = { url: 'https://example.com/path?x=1' };
    expect(stripUrlHash(event)).toBe(event);
  });
});
