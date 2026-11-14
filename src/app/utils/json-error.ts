export interface JsonErrorLocation {
  line: number;
  column: number;
}

function offsetToLocation(text: string, offset: number): JsonErrorLocation {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clamped);
  const line = before.split('\n').length;
  const column = clamped - (before.lastIndexOf('\n') + 1) + 1;
  return { line, column };
}

/**
 * Works out where a JSON.parse failure happened. Chrome reports a character
 * offset (and, in recent versions, line and column), Firefox reports line and
 * column; "unexpected end" errors point at the end of the text.
 */
export function locateJsonError(text: string, message: string): JsonErrorLocation | null {
  let m = /line (\d+) column (\d+)/i.exec(message);
  if (m) return { line: +m[1], column: +m[2] };
  m = /position (\d+)/i.exec(message);
  if (m) return offsetToLocation(text, +m[1]);
  if (/end of (json|data)|unexpected end/i.test(message)) return offsetToLocation(text, text.length);
  return null;
}

/** Drops the location suffix, since the UI shows it separately. */
export function friendlyJsonError(message: string): string {
  return message
    .replace(/ in JSON at position \d+( \(line \d+ column \d+\))?/i, '')
    .replace(/ at line \d+ column \d+ of the JSON data/i, '')
    .trim();
}
