import { inject } from '@vercel/analytics';

/**
 * Share links keep the whole document in the URL hash (`#s=...`). Drop the hash from the page URL
 * before an analytics event is sent, so a document can never leave the browser through analytics.
 */
export function stripUrlHash<T extends { url: string }>(event: T): T {
  const hash = event.url.indexOf('#');
  return hash === -1 ? event : { ...event, url: event.url.slice(0, hash) };
}

/**
 * True for localhost and loopback addresses: `localhost`, `*.localhost`, all of 127.0.0.0/8,
 * `0.0.0.0` and `[::1]` (`location.hostname` returns IPv6 hosts in brackets). LAN and public
 * addresses are not matched.
 */
export function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]'
  );
}

/**
 * Starts anonymous page-view analytics (Vercel Web Analytics). Call it in production builds only.
 * It does nothing on localhost or a loopback address, so the end-to-end tests (which serve a
 * production build on localhost) never report.
 */
export function startAnalytics(hostname: string = location.hostname): void {
  if (isLocalHost(hostname)) return;
  inject({ beforeSend: stripUrlHash });
}
