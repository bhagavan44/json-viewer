/**
 * Share links keep both panes in the URL hash, so nothing is stored on a server.
 * Payload: "z." + base64url(deflate-raw(json)), or "r." + base64url(json) in browsers
 * without CompressionStream.
 */
/** A failure with a message that is fine to show to the person who opened the link. */
export class ShareLinkError extends Error {}

export interface SharedState {
  left: string;
  right: string;
  view: 'edit' | 'compare';
}

/** Links longer than this may be cut off by chat apps and email clients. */
export const SHARE_WARN_CHARS = 8_000;
/** Links longer than this are refused. */
export const SHARE_MAX_CHARS = 100_000;
/** Upper bound for a decompressed link, so a small hostile link cannot inflate into gigabytes. */
export const MAX_DECODED_BYTES = 10 * 1024 * 1024;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function pipeThrough(
  bytes: Uint8Array,
  stream: unknown,
  limit = Infinity,
): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source
    .pipeThrough(stream as ReadableWritablePair<Uint8Array, Uint8Array>)
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new ShareLinkError('This link expands to more than the allowed size');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function encodeShare(
  state: SharedState,
  compress = typeof CompressionStream !== 'undefined',
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ v: 1, l: state.left, r: state.right, m: state.view }),
  );
  if (!compress) return 'r.' + toBase64Url(bytes);
  return 'z.' + toBase64Url(await pipeThrough(bytes, new CompressionStream('deflate-raw')));
}

export async function decodeShare(payload: string): Promise<SharedState> {
  try {
    const dot = payload.indexOf('.');
    const kind = payload.slice(0, dot);
    const body = payload.slice(dot + 1);
    if (dot < 0 || (kind !== 'z' && kind !== 'r') || payload.length > SHARE_MAX_CHARS * 2) {
      throw new ShareLinkError('This is not a valid share link');
    }
    let bytes = fromBase64Url(body);
    if (kind === 'z') {
      if (typeof DecompressionStream === 'undefined')
        throw new ShareLinkError('This browser cannot open compressed links');
      bytes = await pipeThrough(bytes, new DecompressionStream('deflate-raw'), MAX_DECODED_BYTES);
    } else if (bytes.length > MAX_DECODED_BYTES) {
      throw new ShareLinkError('This link expands to more than the allowed size');
    }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (data?.v !== 1 || typeof data.l !== 'string' || typeof data.r !== 'string') {
      throw new ShareLinkError('This is not a valid share link');
    }
    return { left: data.l, right: data.r, view: data.m === 'compare' ? 'compare' : 'edit' };
  } catch (e) {
    // Base64, inflate and JSON failures carry browser-internal messages; give a plain one instead.
    throw e instanceof ShareLinkError
      ? e
      : new ShareLinkError('The link looks damaged or incomplete');
  }
}

export const SHARE_HASH_PREFIX = '#s=';
