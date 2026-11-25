import { jsonTypeOf } from './json-utils';

/** What was hidden, for telling the user. */
export interface RedactResult {
  value: unknown;
  /** Number of values replaced. */
  count: number;
  /** Kinds found, e.g. "passwords and secrets", each listed once. */
  kinds: string[];
}

export const MASK = '***';

/** Key names (lower-cased, without separators) that hold secrets wherever they appear. */
const SECRET_PARTS = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'apikey',
  'accesskey',
  'privatekey',
  'authorization',
  'credential',
  'cookie',
  'sessionid',
  'signature',
];
/** Key names that are secrets only as the whole name (too short to search for inside others). */
const SECRET_NAMES = new Set(['pwd', 'pin', 'auth', 'otp', 'cvv', 'cvc', 'cvv2', 'ssn']);
const PERSONAL_PARTS = [
  'cardnumber',
  'creditcard',
  'iban',
  'accountnumber',
  'routingnumber',
  'socialsecurity',
  'taxid',
  'passportnumber',
];

const EMAIL = /^([^\s@])[^\s@]*(@[^\s@]+\.[^\s@]+)$/;
const JWT = /^(Bearer\s+)?eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
const BEARER = /^(Bearer|Basic)\s+\S{8,}$/i;
const CARD = /^\d(?:[ -]?\d){12,18}$/;

/** Luhn checksum, so only plausible card numbers are treated as cards. */
function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function keyKind(key: string): string | null {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (SECRET_NAMES.has(k) || SECRET_PARTS.some((p) => k.includes(p)))
    return 'passwords and secrets';
  if (PERSONAL_PARTS.some((p) => k.includes(p))) return 'account and card numbers';
  return null;
}

/** A masked version of a sensitive-looking string, or null when it looks harmless. */
function maskString(s: string): { masked: string; kind: string } | null {
  const t = s.trim();
  if (JWT.test(t)) return { masked: MASK, kind: 'tokens' };
  if (BEARER.test(t)) return { masked: t.split(/\s+/)[0] + ' ' + MASK, kind: 'tokens' };
  const email = EMAIL.exec(t);
  if (email) return { masked: `${email[1]}${MASK}${email[2]}`, kind: 'email addresses' };
  if (CARD.test(t)) {
    const digits = t.replace(/\D/g, '');
    if (luhn(digits))
      return { masked: `${MASK} ${digits.slice(-4)}`, kind: 'account and card numbers' };
  }
  return null;
}

/**
 * Hides sensitive values: everything under keys such as "password", "token" or
 * "cardNumber", and strings that look like tokens, emails or card numbers anywhere.
 * Emails keep their first letter and domain, cards their last four digits, so the
 * redacted document is still useful for debugging. The input is not changed.
 */
export function redact(value: unknown): RedactResult {
  let count = 0;
  const kinds: string[] = [];
  const note = (kind: string) => {
    count++;
    if (!kinds.includes(kind)) kinds.push(kind);
  };

  /** Masks every scalar inside a value that sits under a sensitive key. */
  const maskAll = (v: any, kind: string): any => {
    const t = jsonTypeOf(v);
    if (t === 'array') return v.map((x: any) => maskAll(x, kind));
    if (t === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskAll(x, kind)]));
    if (v === null || v === '') return v; // nothing to hide
    note(kind);
    return MASK;
  };

  const visit = (v: any): any => {
    const t = jsonTypeOf(v);
    if (t === 'string') {
      const m = maskString(v);
      if (!m) return v;
      note(m.kind);
      return m.masked;
    }
    if (t === 'array') return v.map(visit);
    if (t === 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => {
          const kind = keyKind(k);
          return [k, kind ? maskAll(x, kind) : visit(x)];
        }),
      );
    }
    return v;
  };

  return { value: visit(value), count, kinds };
}

/** "3 values (passwords and secrets, email addresses)" */
export function describeRedaction(r: RedactResult): string {
  return `${r.count} value${r.count === 1 ? '' : 's'} (${r.kinds.join(', ')})`;
}
