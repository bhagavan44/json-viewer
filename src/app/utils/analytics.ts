import { inject } from '@vercel/analytics';

/**
 * Share links keep the whole document in the URL hash (`#s=...`). Drop the hash from the page URL
 * before an analytics event is sent, so a document can never leave the browser through analytics.
 */
export function stripUrlHash<T extends { url: string }>(event: T): T {
  const hash = event.url.indexOf('#');
  return hash === -1 ? event : { ...event, url: event.url.slice(0, hash) };
}

/** True for the machine's own addresses, such as `ng serve`, `npm run e2e` or a local preview. */
export function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

/**
 * Starts anonymous page-view analytics (Vercel Web Analytics). Call it in production builds only.
 * It does nothing on a local host, so the end-to-end tests (which serve a production build on
 * localhost) and local previews never report.
 */
export function startAnalytics(hostname: string = location.hostname): void {
  if (isLocalHost(hostname)) return;
  inject({ beforeSend: stripUrlHash });
}
