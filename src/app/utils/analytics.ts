import { inject } from '@vercel/analytics';

/**
 * Share links keep the whole document in the URL hash (`#s=...`). Drop the hash from the page URL
 * before an analytics event is sent, so a document can never leave the browser through analytics.
 */
export function stripUrlHash<T extends { url: string }>(event: T): T {
  const hash = event.url.indexOf('#');
  return hash === -1 ? event : { ...event, url: event.url.slice(0, hash) };
}

/** Starts anonymous page-view analytics (Vercel Web Analytics). Call it in production builds only. */
export function startAnalytics(): void {
  inject({ beforeSend: stripUrlHash });
}
