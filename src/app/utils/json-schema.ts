import { LosslessNumber } from './json-parse';
import { jsonTypeOf } from './json-utils';

export type JsonSchema = Record<string, unknown>;

const FORMATS: [string, RegExp][] = [
  ['date-time', /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?$/],
  ['date', /^\d{4}-\d{2}-\d{2}$/],
  ['uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
  ['email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
  ['uri', /^https?:\/\/[^\s]+$/i],
  ['ipv4', /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/],
];

/** The one format every string sample matches, if any. */
function commonFormat(strings: string[]): string | null {
  if (!strings.length) return null;
  for (const [name, pattern] of FORMATS) if (strings.every((s) => pattern.test(s))) return name;
  return null;
}

function isInteger(v: unknown): boolean {
  return v instanceof LosslessNumber ? /^-?\d+$/.test(v.raw) : Number.isInteger(v);
}

/**
 * Infers one schema that describes every sample: array elements and objects
 * appearing in the same position are merged, a key is `required` only when
 * every object sample has it, and mixed types become a type list.
 */
function infer(samples: unknown[]): JsonSchema {
  const strings: string[] = [];
  const arrays: unknown[][] = [];
  const objects: Record<string, unknown>[] = [];
  let numbers = 0,
    integers = 0,
    booleans = 0,
    nulls = 0;

  for (const v of samples) {
    switch (jsonTypeOf(v)) {
      case 'string':
        strings.push(v as string);
        break;
      case 'number':
        numbers++;
        if (isInteger(v)) integers++;
        break;
      case 'boolean':
        booleans++;
        break;
      case 'null':
        nulls++;
        break;
      case 'array':
        arrays.push(v as unknown[]);
        break;
      case 'object':
        objects.push(v as Record<string, unknown>);
        break;
    }
  }

  const types: string[] = [];
  const schema: JsonSchema = {};

  if (objects.length) types.push('object');
  if (arrays.length) types.push('array');
  if (strings.length) types.push('string');
  if (numbers) types.push(integers === numbers ? 'integer' : 'number');
  if (booleans) types.push('boolean');
  if (nulls) types.push('null');
  if (types.length === 1) schema['type'] = types[0];
  else if (types.length > 1) schema['type'] = types;

  if (strings.length) {
    const format = commonFormat(strings);
    if (format) schema['format'] = format;
  }

  if (arrays.length) {
    const items = arrays.flat();
    schema['items'] = items.length ? infer(items) : {};
  }

  if (objects.length) {
    const keys = [...new Set(objects.flatMap((o) => Object.keys(o)))];
    const properties: Record<string, JsonSchema> = {};
    for (const key of keys) {
      properties[key] = infer(objects.filter((o) => Object.hasOwn(o, key)).map((o) => o[key]));
    }
    schema['properties'] = properties;
    const required = keys.filter((k) => objects.every((o) => Object.hasOwn(o, k)));
    if (required.length) schema['required'] = required;
  }

  return schema;
}

/** A draft 2020-12 JSON Schema inferred from a document. */
export function toJsonSchema(value: unknown): JsonSchema {
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', ...infer([value]) };
}
