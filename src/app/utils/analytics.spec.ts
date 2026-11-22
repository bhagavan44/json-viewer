import { inject } from '@vercel/analytics';
import { isLocalHost, startAnalytics, stripUrlHash } from './analytics';

vi.mock('@vercel/analytics', () => ({ inject: vi.fn() }));

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

  it('recognises localhost and loopback addresses', () => {
    for (const host of [
      'localhost',
      'app.localhost',
      '127.0.0.1',
      '127.0.0.2',
      '127.255.255.254',
      '0.0.0.0',
      '[::1]',
    ]) {
      expect(isLocalHost(host), host).toBe(true);
    }
  });

  it('does not treat LAN or public hosts as local', () => {
    for (const host of [
      'json-viewer.vercel.app',
      'example.com',
      'notlocalhost.com',
      '127.example.com',
      '128.0.0.1',
      '192.168.1.20',
      '10.0.0.5',
      '::1',
    ]) {
      expect(isLocalHost(host), host).toBe(false);
    }
  });

  describe('startAnalytics', () => {
    beforeEach(() => vi.mocked(inject).mockClear());

    it('injects the script on a public host and strips the URL hash from events', () => {
      startAnalytics('json-viewer.vercel.app');
      expect(inject).toHaveBeenCalledTimes(1);
      expect(inject).toHaveBeenCalledWith({ beforeSend: stripUrlHash });
    });

    it('injects the script on a LAN address', () => {
      startAnalytics('192.168.1.20');
      expect(inject).toHaveBeenCalledTimes(1);
    });

    it('does not inject the script on localhost or a loopback address', () => {
      for (const host of ['localhost', '127.0.0.1', '127.0.0.2', '0.0.0.0', '[::1]']) {
        startAnalytics(host);
      }
      expect(inject).not.toHaveBeenCalled();
    });

    it('uses the current page hostname by default', () => {
      // jsdom serves the test page from localhost.
      startAnalytics();
      expect(inject).not.toHaveBeenCalled();
    });
  });
});
