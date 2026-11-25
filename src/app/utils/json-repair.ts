import { parseJson, stringifyJson } from './json-parse';
import { unescapeJsonText } from './json-unwrap';

/** What a repair changed, for telling the user. */
export interface RepairResult {
  /** Strict JSON text. */
  text: string;
  /** Kinds of fixes applied, e.g. "removed comments", each listed once, in order of first use. */
  fixes: string[];
}

const CLOSE_QUOTE: Record<string, string> = {
  '"': '"',
  "'": "'",
  '“': '”',
  '”': '”',
  '‘': '’',
  '’': '’',
};
const LITERALS: Record<string, string> = {
  true: 'true',
  false: 'false',
  null: 'null',
  True: 'true',
  False: 'false',
  None: 'null',
  undefined: 'null',
  NaN: 'null',
  Infinity: 'null',
};

/**
 * Turns "almost JSON" into JSON: comments, trailing commas, single or curly quotes,
 * unquoted keys, missing commas between values, Python/JavaScript literals
 * (True, None, undefined, NaN) and JSON5 numbers (+1, .5, 5., 0x1F).
 * Returns null when the result still does not parse, so a repair never guesses wildly.
 */
export function repairJson(input: string): RepairResult | null {
  const fixes: string[] = [];
  const note = (fix: string) => fixes.includes(fix) || fixes.push(fix);
  let out = '';
  let i = 0;
  const n = input.length;
  /** Containers currently open, and whether the last thing written in each was a value. */
  const stack: ('{' | '[')[] = [];
  let afterValue = false;
  /** In an object, the next string or word is a key (not a value). */
  let expectKey = false;

  const beginValue = () => {
    if (afterValue && stack.length) {
      out += ',';
      note('added missing commas');
    }
  };
  const endValue = () => {
    afterValue = true;
    expectKey = false;
  };
  /** In an object, a string or word right after a value starts the next member: add the comma. */
  const startMemberIfNeeded = () => {
    if (afterValue && stack[stack.length - 1] === '{') {
      out += ',';
      note('added missing commas');
      afterValue = false;
      expectKey = true;
    }
  };

  while (i < n) {
    const c = input[i];

    // Whitespace (including a BOM and non-breaking spaces from copied text).
    if (/\s|\uFEFF/.test(c)) {
      if (c === '﻿' || c === ' ') note('removed invisible characters');
      else out += c;
      i++;
      continue;
    }

    // Comments.
    if (c === '/' && input[i + 1] === '/') {
      while (i < n && input[i] !== '\n') i++;
      note('removed comments');
      continue;
    }
    if (c === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2);
      if (end < 0) return null;
      i = end + 2;
      note('removed comments');
      continue;
    }
    if (c === '#' && (i === 0 || /\n\s*$/.test(input.slice(Math.max(0, i - 80), i)))) {
      while (i < n && input[i] !== '\n') i++;
      note('removed comments');
      continue;
    }

    // Strings (double, single or curly quotes).
    if (c in CLOSE_QUOTE) {
      startMemberIfNeeded();
      const close = CLOSE_QUOTE[c];
      if (c !== '"') note(c === "'" ? 'replaced single quotes' : 'replaced curly quotes');
      let j = i + 1;
      let body = '';
      while (j < n && input[j] !== close && !(c === '“' && input[j] === '"')) {
        if (input[j] === '\\' && j + 1 < n) {
          // Keep escapes, except \' which is not valid JSON.
          body += input[j + 1] === "'" ? "'" : input[j] + input[j + 1];
          j += 2;
        } else if (input[j] === '\n') {
          body += '\\n';
          note('escaped line breaks in strings');
          j++;
        } else {
          body += input[j] === '"' && c !== '"' ? '\\"' : input[j];
          j++;
        }
      }
      if (j >= n) return null; // unterminated string
      if (!expectKey) beginValue();
      out += `"${body}"`;
      i = j + 1;
      if (expectKey) expectKey = false;
      else endValue();
      continue;
    }

    switch (c) {
      case '{':
      case '[':
        beginValue();
        stack.push(c);
        out += c;
        afterValue = false;
        expectKey = c === '{';
        i++;
        continue;
      case '}':
      case ']': {
        if (stack.pop() !== (c === '}' ? '{' : '[')) return null;
        out = out.replace(/,(\s*)$/, (_, ws) => {
          note('removed trailing commas');
          return ws;
        });
        out += c;
        i++;
        endValue();
        continue;
      }
      case ',':
        // Drop doubled commas (`[1,,2]`) instead of inventing values.
        if (!afterValue) {
          note('removed extra commas');
          i++;
          continue;
        }
        out += c;
        afterValue = false;
        expectKey = stack[stack.length - 1] === '{';
        i++;
        continue;
      case ':':
        out += c;
        afterValue = false;
        expectKey = false;
        i++;
        continue;
    }

    // Numbers, including JSON5 forms.
    const num = /^[+-]?(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(
      input.slice(i, i + 400),
    );
    if (num && !expectKey) {
      const text = num[0];
      const sign = text[0] === '-' ? '-' : '';
      let body = text.replace(/^[+-]/, '');
      if (text[0] === '+') note('fixed number formats');
      if (/^0[xX]/.test(body)) {
        body = BigInt(body).toString();
        note('fixed number formats');
      } else {
        if (body.startsWith('.')) body = '0' + body;
        if (/\.(?!\d)/.test(body)) body = body.replace('.', '');
        if (/^0\d/.test(body)) body = body.replace(/^0+(?=\d)/, '');
        if (body !== text.replace(/^[+-]/, '')) note('fixed number formats');
      }
      beginValue();
      out += sign + body;
      i += text.length;
      endValue();
      continue;
    }

    // Words: literals as values, identifiers as keys.
    const word = /^[A-Za-z_$][\w$]*/.exec(input.slice(i, i + 200));
    if (word) {
      startMemberIfNeeded();
      const w = word[0];
      if (expectKey) {
        out += `"${w}"`;
        note('quoted keys');
        expectKey = false;
      } else if (w in LITERALS) {
        if (LITERALS[w] !== w) note('replaced non-JSON literals');
        beginValue();
        out += LITERALS[w];
        endValue();
      } else {
        return null;
      }
      i += w.length;
      continue;
    }

    return null;
  }

  if (stack.length || !fixes.length) return null;
  try {
    parseJson(out);
  } catch {
    return null;
  }
  return { text: out, fixes };
}

/**
 * Reads JSON Lines (NDJSON): one JSON value per line. Returns the values as an
 * array, or null when the text is not JSON Lines (fewer than two values, or a
 * line that is not JSON).
 */
export function parseJsonLines(text: string): unknown[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const values: unknown[] = [];
  for (const line of lines) {
    try {
      values.push(parseJson(line));
    } catch {
      return null;
    }
  }
  return values;
}

/** One JSON value per line, for exporting an array as JSON Lines. */
export function toJsonLines(values: unknown[]): string {
  return values.map((v) => stringifyJson(v)).join('\n') + '\n';
}

function base64ToText(b64: string): string | null {
  const normal = b64.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normal) || normal.length % 4 === 1) return null;
  try {
    const binary = atob(normal + '='.repeat((4 - (normal.length % 4)) % 4));
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(binary, (ch) => ch.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}

function parseObject(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const v = parseJson(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Seconds since 1970 → ISO date, for the standard JWT time claims. */
const TIME_CLAIMS = ['exp', 'iat', 'nbf', 'auth_time'];

/**
 * Decodes a JWT (`header.payload.signature`, optionally after "Bearer ") into a
 * document. The signature is shown but not verified. Returns null for other text.
 */
export function decodeJwt(text: string): Record<string, unknown> | null {
  const token = text.trim().replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (
    parts.length !== 3 ||
    parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p)) ||
    !parts[0] ||
    !parts[1]
  )
    return null;
  const header = parseObject(base64ToText(parts[0]));
  const payload = parseObject(base64ToText(parts[1]));
  if (!header || !payload || typeof header['alg'] !== 'string') return null;
  const doc: Record<string, unknown> = { header, payload, signature: parts[2] };
  const times: Record<string, string> = {};
  for (const claim of TIME_CLAIMS) {
    const seconds = Number(payload[claim]);
    if (typeof payload[claim] === 'number' && Number.isFinite(seconds))
      times[claim] = new Date(seconds * 1000).toISOString();
  }
  if (Object.keys(times).length) doc['times'] = times;
  return doc;
}

/** Decodes Base64 (or Base64URL) text that holds JSON. Returns the JSON text, or null. */
export function decodeBase64Json(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 8) return null;
  const decoded = base64ToText(trimmed);
  if (decoded === null || !/^\s*[[{]/.test(decoded)) return null;
  try {
    parseJson(decoded);
    return decoded;
  } catch {
    return null;
  }
}

/** A way to turn text that is not valid JSON into JSON. */
export interface TextFix {
  /** Short button text, e.g. "Repair". */
  button: string;
  /** Command palette label, e.g. "Repair JSON". */
  label: string;
  /** What the fix will do, for a tooltip. */
  detail: string;
  /** The resulting JSON text. */
  text: string;
}

/** Above this size, invalid text is not analysed for a fix on every edit. */
export const MAX_FIX_CHARS = 5_000_000;

/**
 * The first fix that applies to `text` (which failed to parse): escaped JSON,
 * a JWT, Base64-encoded JSON, JSON Lines, then a general repair. Null if none does.
 */
export function findTextFix(text: string): TextFix | null {
  if (!text.trim() || text.length > MAX_FIX_CHARS) return null;
  const pretty = (value: unknown) => stringifyJson(value, 2);

  const unescaped = unescapeJsonText(text);
  if (unescaped !== null) {
    return {
      button: 'Unescape',
      label: 'Unescape JSON (\\" → ")',
      detail: 'This looks like escaped JSON. Unescape it.',
      text: pretty(parseJson(unescaped)),
    };
  }
  const jwt = decodeJwt(text);
  if (jwt) {
    return {
      button: 'Decode JWT',
      label: 'Decode JWT',
      detail: 'Show the token’s header and payload. The signature is not verified.',
      text: pretty(jwt),
    };
  }
  const base64 = decodeBase64Json(text);
  if (base64 !== null) {
    return {
      button: 'Decode Base64',
      label: 'Decode Base64',
      detail: 'This is Base64-encoded JSON. Decode it.',
      text: pretty(parseJson(base64)),
    };
  }
  const lines = parseJsonLines(text);
  if (lines) {
    return {
      button: 'To array',
      label: 'Convert JSON Lines to an array',
      detail: `This looks like JSON Lines. Turn its ${lines.length} lines into one array.`,
      text: pretty(lines),
    };
  }
  const repair = repairJson(text);
  if (repair) {
    const what = repair.fixes.join(', ');
    return {
      button: 'Repair',
      label: 'Repair JSON',
      detail: `Repair: ${what[0].toUpperCase()}${what.slice(1)}.`,
      text: repair.text,
    };
  }
  return null;
}
