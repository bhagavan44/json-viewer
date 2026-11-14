import { LosslessNumber, stringifyJson } from './json-parse';

export type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function jsonTypeOf(value: any): JsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof LosslessNumber) return 'number';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  return 'object';
}

/** Builds a JSONPath-style path: `$`, `$.customer`, `$.items[1]`, `$["a b"]`. */
export function childPath(parent: string, key: string | number, parentIsArray: boolean): string {
  if (parentIsArray) return `${parent}[${key}]`;
  const k = String(key);
  return IDENTIFIER.test(k) ? `${parent}.${k}` : `${parent}[${JSON.stringify(k)}]`;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Short single-line preview of any JSON value, for lists. */
export function summarizeValue(value: any, max = 36): string {
  const type = jsonTypeOf(value);
  if (type === 'array') return `[${value.length} item${value.length === 1 ? '' : 's'}]`;
  if (type === 'object') return `{${Object.keys(value).length} key${Object.keys(value).length === 1 ? '' : 's'}}`;
  const text = stringifyJson(value);
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
