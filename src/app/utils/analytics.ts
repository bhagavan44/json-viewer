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
 * Custom domains that are served by Vercel, in addition to every `*.vercel.app` host. Vercel
 * serves the analytics script (`/_vercel/insights/script.js`) only there, so on any other host
 * the request would 404 and log a console error on every page load.
 */
export const VERCEL_ANALYTICS_HOSTS: readonly string[] = ['json.mvtech.dev'];

/**
 * True when the page is served from a host that can deliver the Vercel analytics script: a
 * `*.vercel.app` deployment or one of {@link VERCEL_ANALYTICS_HOSTS}. Case-insensitive.
 */
export function isVercelHost(
  hostname: string,
  extraHosts: readonly string[] = VERCEL_ANALYTICS_HOSTS,
): boolean {
  const host = hostname.toLowerCase();
  return host.endsWith('.vercel.app') || extraHosts.some((h) => h.toLowerCase() === host);
}

/**
 * Starts anonymous page-view analytics (Vercel Web Analytics). Call it in production builds only.
 * It does nothing unless the page is served from Vercel (see {@link isVercelHost}), so a build
 * hosted elsewhere (nginx, GitHub Pages, a static server) makes no request for the script. It also
 * skips localhost and loopback addresses, so the end-to-end tests (which serve a production build
 * on localhost) never report.
 */
export function startAnalytics(hostname: string = location.hostname): void {
  if (isLocalHost(hostname) || !isVercelHost(hostname)) return;
  inject({ beforeSend: stripUrlHash });
}
