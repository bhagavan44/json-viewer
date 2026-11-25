import { childPath } from './json-utils';

/** Where a value sits in the JSON text (character offsets; `end` is exclusive). */
export interface TextSpan {
  path: string;
  /** Start of the value. */
  start: number;
  end: number;
  /** Start of the member's key (`"name": ...`), or the value start for array items and the root. */
  keyStart: number;
}

const WS = /\s/;

/**
 * Walks valid JSON text and reports each value's span after its children
 * (innermost first). The visitor returns true to stop early.
 */
function walk(text: string, visit: (span: TextSpan) => boolean | void): void {
  let i = 0;
  let stopped = false;
  const ws = () => {
    while (i < text.length && WS.test(text[i])) i++;
  };
  const string = (): string => {
    const start = i;
    i++; // opening quote
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++; // closing quote
    return text.slice(start, i);
  };
  const value = (path: string, keyStart: number): void => {
    ws();
    const start = i;
    const c = text[i];
    if (c === '{') {
      i++;
      ws();
      while (!stopped && text[i] !== '}') {
        const kStart = i;
        const key = JSON.parse(string()) as string;
        ws();
        i++; // colon
        value(childPath(path, key, false), kStart);
        ws();
        if (text[i] === ',') i++;
        ws();
      }
      i++;
    } else if (c === '[') {
      i++;
      ws();
      for (let index = 0; !stopped && text[i] !== ']'; index++) {
        ws();
        value(childPath(path, index, true), -1);
        ws();
        if (text[i] === ',') i++;
        ws();
      }
      i++;
    } else if (c === '"') {
      string();
    } else {
      while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
    }
    if (!stopped && visit({ path, start, end: i, keyStart: keyStart < 0 ? start : keyStart }))
      stopped = true;
  };
  value('$', -1);
}

/** The path of the innermost value (or member key) at `offset` in valid JSON text. */
export function pathAtOffset(text: string, offset: number): string | null {
  let found: string | null = null;
  walk(text, (span) => {
    if (span.keyStart <= offset && offset <= span.end) {
      found = span.path;
      return true;
    }
    return false;
  });
  return found;
}

/** The span of the value at `path` in valid JSON text, or null when there is none. */
export function spanOfPath(text: string, path: string): TextSpan | null {
  let found: TextSpan | null = null;
  walk(text, (span) => {
    if (span.path === path) {
      found = span;
      return true;
    }
    return false;
  });
  return found;
}

/** One step of a path, for a breadcrumb: `$`, `orders`, `[1]`, `qty`. */
export interface PathSegment {
  label: string;
  /** The path up to and including this step. */
  path: string;
}

/** Splits a tree path (`$.orders[1]["unit price"]`) into breadcrumb steps. */
export function pathSegments(path: string): PathSegment[] {
  const segments: PathSegment[] = [{ label: '$', path: '$' }];
  const step = /\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/y;
  step.lastIndex = 1;
  for (let m = step.exec(path); m; m = step.exec(path)) {
    const label = m[1] ?? (m[2] !== undefined ? `[${m[2]}]` : (JSON.parse(m[3]) as string));
    segments.push({ label, path: path.slice(0, step.lastIndex) });
    if (step.lastIndex >= path.length) break;
  }
  return segments;
}

/** The value at a tree path in a parsed document (undefined when nothing is there). */
export function valueAtPath(doc: unknown, path: string): unknown {
  let value: any = doc;
  for (const step of pathSegments(path).slice(1)) {
    const m = /^\[(\d+)\]$/.exec(step.label);
    value = m && Array.isArray(value) ? value[Number(m[1])] : value?.[step.label];
  }
  return value;
}
