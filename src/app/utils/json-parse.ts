/**
 * A number whose exact text cannot survive a round trip through a JS double
 * (e.g. a 64-bit ID such as 1234567890123456789). It keeps the source digits so
 * the tree, diff, format, minify and copy all show and emit the original value.
 */
export class LosslessNumber {
  constructor(readonly raw: string) {}

  toString(): string {
    return this.raw;
  }

  valueOf(): number {
    return Number(this.raw);
  }

  /** `JSON.rawJSON` (Chrome 114+, Firefox 135+, Safari 18.4+) emits the digits verbatim. */
  toJSON(): unknown {
    const rawJSON = (JSON as any).rawJSON as ((text: string) => unknown) | undefined;
    return rawJSON ? rawJSON(this.raw) : Number(this.raw);
  }
}

/** True when the number's text would change if it went through a double. */
function needsRaw(source: string): boolean {
  if (/^-?\d+$/.test(source)) return !Number.isSafeInteger(Number(source));
  const mantissa = source
    .replace(/^-/, '')
    .replace(/[eE].*$/, '')
    .replace('.', '')
    .replace(/^0+/, '');
  return mantissa.length > 15;
}

/** Cheap pre-check so ordinary documents keep the faster reviver-free parse. */
const MAY_HAVE_LONG_NUMBER = /[\d.]{16,}/;

/**
 * Like JSON.parse, but numbers that a double cannot represent exactly come back
 * as LosslessNumber. Uses the "source text access" reviver argument; engines
 * without it fall back to ordinary numbers.
 */
export function parseJson(text: string): any {
  if (!MAY_HAVE_LONG_NUMBER.test(text)) return JSON.parse(text);
  const reviver = (_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' && context?.source !== undefined && needsRaw(context.source)
      ? new LosslessNumber(context.source)
      : value;
  return JSON.parse(text, reviver as any);
}

/**
 * Like JSON.stringify, but always writes lossless numbers with their exact digits,
 * also in browsers without `JSON.rawJSON` (where `toJSON` has to fall back to a double).
 */
export function stringifyJson(value: unknown, indent?: number): string {
  if ((JSON as any).rawJSON) return JSON.stringify(value, null, indent);
  // The replacer sees the holder (`this`), so it can spot a LosslessNumber before its
  // `toJSON` runs. It is written as a marked string and unquoted afterwards.
  const nonce = Math.random().toString(36).slice(2);
  let found = false;
  const text = JSON.stringify(
    value,
    function (this: any, key: string, v: unknown) {
      const original = this[key];
      if (original instanceof LosslessNumber) {
        found = true;
        return `${nonce}:${original.raw}`;
      }
      return v;
    },
    indent,
  );
  return found ? text.replace(new RegExp(`"${nonce}:([-+.\\deE]+)"`, 'g'), '$1') : text;
}
