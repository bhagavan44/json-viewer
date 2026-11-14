import { LosslessNumber } from './json-parse';
import { childPath, jsonTypeOf, summarizeValue } from './json-utils';

/** One way the document breaks the schema. */
export interface SchemaError {
  /** Tree-style path of the value at fault (`$.items[2].qty`). */
  path: string;
  message: string;
}

export interface ValidationResult {
  errors: SchemaError[];
  /** True when validation stopped at MAX_ERRORS. */
  truncated: boolean;
  /** Keywords present in the schema that this validator does not check. */
  unsupported: string[];
}

export class SchemaLoadError extends Error {}

const MAX_ERRORS = 500;

const FORMATS: Record<string, RegExp> = {
  'date-time': /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  uri: /^[a-z][a-z0-9+.-]*:[^\s]*$/i,
  ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/,
};

/** Keywords that only annotate, or that this validator applies. Anything else is reported as unsupported. */
const KNOWN = new Set([
  '$schema', '$id', '$comment', '$defs', 'definitions', '$ref', '$anchor',
  'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly', 'nullable',
  'type', 'enum', 'const', 'format',
  'properties', 'required', 'additionalProperties', 'patternProperties', 'propertyNames',
  'minProperties', 'maxProperties', 'dependentRequired',
  'items', 'prefixItems', 'additionalItems', 'minItems', 'maxItems', 'uniqueItems', 'contains',
  'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
  'contentMediaType', 'contentEncoding',
]);

const num = (v: unknown) => Number(v instanceof LosslessNumber ? v.raw : v);
const isInteger = (v: unknown) => (v instanceof LosslessNumber ? /^-?\d+$/.test(v.raw) : Number.isInteger(v));

/** JSON equality for enum, const and uniqueItems (key order ignored, numbers by value). */
function equal(a: unknown, b: unknown): boolean {
  const ta = jsonTypeOf(a);
  if (ta !== jsonTypeOf(b)) return false;
  if (ta === 'number') return num(a) === num(b);
  if (ta === 'array') return (a as unknown[]).length === (b as unknown[]).length && (a as unknown[]).every((x, i) => equal(x, (b as unknown[])[i]));
  if (ta === 'object') {
    const ka = Object.keys(a as object);
    return ka.length === Object.keys(b as object).length && ka.every((k) => Object.hasOwn(b as object, k) && equal((a as any)[k], (b as any)[k]));
  }
  return a === b;
}

const show = (v: unknown) => summarizeValue(v, 40);
const typeName = (v: unknown) => (jsonTypeOf(v) === 'number' && isInteger(v) ? 'integer' : jsonTypeOf(v));

function regex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'u');
  } catch {
    throw new SchemaLoadError(`Invalid pattern ${JSON.stringify(pattern)}`);
  }
}

/** Resolves a local reference such as `#/$defs/address` (JSON Pointer). */
function resolveRef(root: any, ref: string): any {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) throw new SchemaLoadError(`Only local references are supported (found "${ref}")`);
  let target = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    if (target === null || typeof target !== 'object' || !Object.hasOwn(target, key)) {
      throw new SchemaLoadError(`Reference "${ref}" does not point to anything in the schema`);
    }
    target = target[key];
  }
  return target;
}

/**
 * Validates `doc` against a JSON Schema (draft 7 to 2020-12; local `$ref` only).
 * Formats are checked for date-time, date, time, email, uuid, uri and ipv4.
 * Throws SchemaLoadError when the schema itself cannot be used.
 */
export function validateSchema(doc: unknown, schema: unknown): ValidationResult {
  if (typeof schema !== 'boolean' && jsonTypeOf(schema) !== 'object') {
    throw new SchemaLoadError('A schema must be an object (or true/false)');
  }
  const errors: SchemaError[] = [];
  const unsupported = new Set<string>();
  let truncated = false;

  /** Collects errors into `out`; returns true when the value is valid. */
  const check = (value: any, s: any, path: string, out: SchemaError[], depth: number): boolean => {
    if (depth > 200) throw new SchemaLoadError('The schema refers to itself without end');
    if (out.length >= MAX_ERRORS) {
      truncated = true;
      return false;
    }
    if (s === true || s === undefined) return true;
    if (s === false) {
      out.push({ path, message: 'No value is allowed here' });
      return false;
    }
    const before = out.length;
    const fail = (message: string, at = path) => out.push({ path: at, message });
    for (const k of Object.keys(s)) if (!KNOWN.has(k)) unsupported.add(k);

    if (typeof s.$ref === 'string') check(value, resolveRef(schema, s.$ref), path, out, depth + 1);

    const type = typeName(value);
    if (s.type !== undefined) {
      const allowed: string[] = Array.isArray(s.type) ? s.type : [s.type];
      if (s.nullable === true) allowed.push('null'); // OpenAPI 3.0
      const ok = allowed.includes(type) || (type === 'integer' && allowed.includes('number'));
      if (!ok) {
        fail(`Expected ${allowed.join(' or ')}, found ${type}`);
        return false; // other keywords would only repeat the problem
      }
    }
    if (s.enum !== undefined && !(s.enum as unknown[]).some((e) => equal(value, e))) {
      fail(`Must be one of ${(s.enum as unknown[]).map(show).join(', ')}; found ${show(value)}`);
    }
    if (Object.hasOwn(s, 'const') && !equal(value, s.const)) fail(`Must be ${show(s.const)}; found ${show(value)}`);

    if (type === 'string') {
      const length = [...value].length;
      if (typeof s.minLength === 'number' && length < s.minLength) fail(`Must be at least ${s.minLength} characters (has ${length})`);
      if (typeof s.maxLength === 'number' && length > s.maxLength) fail(`Must be at most ${s.maxLength} characters (has ${length})`);
      if (typeof s.pattern === 'string') {
        if (!regex(s.pattern).test(value)) fail(`Must match the pattern ${s.pattern}`);
      }
      if (typeof s.format === 'string' && FORMATS[s.format] && !FORMATS[s.format].test(value)) {
        fail(`Must be a valid ${s.format}; found ${show(value)}`);
      }
    }

    if (type === 'number' || type === 'integer') {
      const n = num(value);
      if (typeof s.minimum === 'number' && n < s.minimum) fail(`Must be ≥ ${s.minimum}; found ${String(value)}`);
      if (typeof s.maximum === 'number' && n > s.maximum) fail(`Must be ≤ ${s.maximum}; found ${String(value)}`);
      // Draft 4 used booleans for the exclusive bounds.
      const exMin = s.exclusiveMinimum === true ? s.minimum : s.exclusiveMinimum;
      const exMax = s.exclusiveMaximum === true ? s.maximum : s.exclusiveMaximum;
      if (typeof exMin === 'number' && n <= exMin) fail(`Must be > ${exMin}; found ${String(value)}`);
      if (typeof exMax === 'number' && n >= exMax) fail(`Must be < ${exMax}; found ${String(value)}`);
      if (typeof s.multipleOf === 'number' && s.multipleOf > 0) {
        const q = n / s.multipleOf;
        if (Math.abs(q - Math.round(q)) > 1e-9) fail(`Must be a multiple of ${s.multipleOf}; found ${String(value)}`);
      }
    }

    if (type === 'array') {
      const items = value as unknown[];
      if (typeof s.minItems === 'number' && items.length < s.minItems) fail(`Must have at least ${s.minItems} items (has ${items.length})`);
      if (typeof s.maxItems === 'number' && items.length > s.maxItems) fail(`Must have at most ${s.maxItems} items (has ${items.length})`);
      // prefixItems (2020-12) or an items array (draft 7) describe positions; items/additionalItems the rest.
      const tuple: unknown[] | null = Array.isArray(s.prefixItems) ? s.prefixItems : Array.isArray(s.items) ? s.items : null;
      const rest = tuple ? (Array.isArray(s.items) ? s.additionalItems : s.items) : s.items;
      items.forEach((item, i) => {
        const itemSchema = tuple && i < tuple.length ? tuple[i] : rest;
        if (itemSchema !== undefined) check(item, itemSchema, childPath(path, i, true), out, depth + 1);
      });
      if (s.uniqueItems === true) {
        for (let i = 1; i < items.length; i++) {
          const j = items.slice(0, i).findIndex((x) => equal(x, items[i]));
          if (j >= 0) {
            fail(`Duplicate of item [${j}]`, childPath(path, i, true));
            break;
          }
        }
      }
      if (s.contains !== undefined && !items.some((item, i) => check(item, s.contains, childPath(path, i, true), [], depth + 1))) {
        fail('Must contain at least one matching item');
      }
    }

    if (type === 'object') {
      const keys = Object.keys(value);
      if (typeof s.minProperties === 'number' && keys.length < s.minProperties) fail(`Must have at least ${s.minProperties} properties`);
      if (typeof s.maxProperties === 'number' && keys.length > s.maxProperties) fail(`Must have at most ${s.maxProperties} properties`);
      for (const key of Array.isArray(s.required) ? s.required : []) {
        if (!Object.hasOwn(value, key)) fail(`Missing required property "${key}"`);
      }
      if (s.dependentRequired && typeof s.dependentRequired === 'object') {
        for (const [key, needs] of Object.entries(s.dependentRequired as Record<string, string[]>)) {
          if (!Object.hasOwn(value, key)) continue;
          for (const need of needs) if (!Object.hasOwn(value, need)) fail(`"${key}" requires "${need}"`);
        }
      }
      const props = (s.properties ?? {}) as Record<string, unknown>;
      const patterns = Object.entries((s.patternProperties ?? {}) as Record<string, unknown>).map(([p, ps]) => [regex(p), ps] as const);
      for (const key of keys) {
        const at = childPath(path, key, false);
        let matched = false;
        if (Object.hasOwn(props, key)) {
          matched = true;
          check(value[key], props[key], at, out, depth + 1);
        }
        for (const [re, ps] of patterns) {
          if (re.test(key)) {
            matched = true;
            check(value[key], ps, at, out, depth + 1);
          }
        }
        if (!matched && s.additionalProperties !== undefined) {
          if (s.additionalProperties === false) fail(`Property "${key}" is not allowed`, at);
          else check(value[key], s.additionalProperties, at, out, depth + 1);
        }
        if (s.propertyNames !== undefined && !check(key, s.propertyNames, at, [], depth + 1)) fail(`Property name "${key}" is not allowed`, at);
      }
    }

    // Combinators: the branches are tried on their own; only the summary is reported.
    if (Array.isArray(s.allOf)) for (const sub of s.allOf) check(value, sub, path, out, depth + 1);
    if (Array.isArray(s.anyOf) && !s.anyOf.some((sub: unknown) => check(value, sub, path, [], depth + 1))) {
      fail(`Does not match any of the ${s.anyOf.length} allowed shapes (anyOf)`);
    }
    if (Array.isArray(s.oneOf)) {
      const matches = s.oneOf.filter((sub: unknown) => check(value, sub, path, [], depth + 1)).length;
      if (matches !== 1) fail(matches ? `Matches ${matches} of the oneOf shapes; exactly one is allowed` : `Does not match any of the ${s.oneOf.length} oneOf shapes`);
    }
    if (s.not !== undefined && check(value, s.not, path, [], depth + 1)) fail('Must not match the "not" schema');
    if (s.if !== undefined) {
      const branch = check(value, s.if, path, [], depth + 1) ? s.then : s.else;
      if (branch !== undefined) check(value, branch, path, out, depth + 1);
    }

    return out.length === before;
  };

  check(doc, schema, '$', errors, 0);
  return { errors: errors.slice(0, MAX_ERRORS), truncated, unsupported: [...unsupported] };
}

/** True when a document looks like a JSON Schema (to suggest validating against it). */
export function looksLikeSchema(value: unknown): boolean {
  if (jsonTypeOf(value) !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v['$schema'] === 'string' || (v['type'] === 'object' && jsonTypeOf(v['properties']) === 'object');
}
