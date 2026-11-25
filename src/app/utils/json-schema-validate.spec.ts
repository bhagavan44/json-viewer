import { parseJson } from './json-parse';
import { toJsonSchema } from './json-schema';
import { SchemaLoadError, validateDocument, validateSchema } from './json-schema-validate';

const ORDER_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['id', 'status', 'lines'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^SO-\\d+$' },
    status: { enum: ['new', 'shipped'] },
    email: { type: 'string', format: 'email' },
    total: { type: 'number', minimum: 0, exclusiveMaximum: 1000 },
    lines: { type: 'array', minItems: 1, items: { $ref: '#/$defs/line' } },
  },
  $defs: {
    line: {
      type: 'object',
      required: ['sku', 'qty'],
      properties: { sku: { type: 'string', minLength: 1 }, qty: { type: 'integer', minimum: 1 } },
    },
  },
};

const errors = (doc: unknown, schema: unknown = ORDER_SCHEMA) => validateSchema(doc, schema).errors.map((e) => `${e.path}: ${e.message}`);

describe('validateSchema', () => {
  it('accepts a valid document', () => {
    expect(errors({ id: 'SO-1', status: 'new', total: 10.5, lines: [{ sku: 'A', qty: 2 }] })).toEqual([]);
  });

  it('reports each problem at the path of the value at fault', () => {
    expect(
      errors({ id: 'X-1', status: 'lost', email: 'nope', total: 1000, lines: [{ sku: '', qty: 1.5 }, { qty: 0 }], extra: true }),
    ).toEqual([
      '$.id: Must match the pattern ^SO-\\d+$',
      '$.status: Must be one of "new", "shipped"; found "lost"',
      '$.email: Must be a valid email; found "nope"',
      '$.total: Must be < 1000; found 1000',
      '$.lines[0].sku: Must be at least 1 characters (has 0)',
      '$.lines[0].qty: Expected integer, found number',
      '$.lines[1]: Missing required property "sku"',
      '$.lines[1].qty: Must be ≥ 1; found 0',
      '$.extra: Property "extra" is not allowed',
    ]);
  });

  it('reports missing required properties and wrong types once', () => {
    expect(errors({ lines: 'none' })).toEqual([
      '$: Missing required property "id"',
      '$: Missing required property "status"',
      '$.lines: Expected array, found string',
    ]);
  });

  it('handles anyOf, oneOf, not, if/then/else and const', () => {
    const s = {
      oneOf: [{ type: 'integer' }, { type: 'number', minimum: 5 }],
      not: { const: 7 },
      if: { minimum: 100 },
      then: { multipleOf: 10 },
    };
    expect(errors(3, s)).toEqual([]);
    expect(errors(6, s)).toEqual(['$: Matches 2 of the oneOf shapes; exactly one is allowed']);
    expect(errors(7.5, s)).toEqual([]);
    expect(errors(7, s)).toEqual(['$: Matches 2 of the oneOf shapes; exactly one is allowed', '$: Must not match the "not" schema']);
    expect(errors(105, s)).toEqual(['$: Matches 2 of the oneOf shapes; exactly one is allowed', '$: Must be a multiple of 10; found 105']);
    expect(errors('x', { anyOf: [{ type: 'number' }, { type: 'boolean' }] })).toEqual(['$: Does not match any of the 2 allowed shapes (anyOf)']);
  });

  it('checks tuples, uniqueItems, contains and patternProperties', () => {
    expect(errors([1, 'a', 'b'], { prefixItems: [{ type: 'integer' }], items: { type: 'integer' } })).toEqual([
      '$[1]: Expected integer, found string',
      '$[2]: Expected integer, found string',
    ]);
    expect(errors([{ a: 1 }, { a: 1 }], { uniqueItems: true })).toEqual(['$[1]: Duplicate of item [0]']);
    expect(errors([1, 2], { contains: { const: 3 } })).toEqual(['$: Must contain at least one matching item']);
    expect(errors({ x_1: 1, y: 2 }, { patternProperties: { '^x_': { type: 'string' } }, additionalProperties: false })).toEqual([
      '$.x_1: Expected string, found integer',
      '$.y: Property "y" is not allowed',
    ]);
  });

  it('compares big numbers exactly and accepts integers as numbers', () => {
    const doc = parseJson('{"id": 9007199254740993, "n": 2}');
    // eslint-disable-next-line no-loss-of-precision -- the literal is deliberately beyond 2^53
    expect(errors(doc, { properties: { id: { type: 'integer', const: 9007199254740993 }, n: { type: 'number' } } })).toEqual([]);
  });

  it('accepts what toJsonSchema infers from the same document', () => {
    const doc = { id: 1, tags: ['a'], at: '2026-10-23T07:00:00Z', items: [{ sku: 'A' }, { sku: 'B', note: null }] };
    expect(errors(doc, toJsonSchema(doc))).toEqual([]);
  });

  it('lists keywords it does not check', () => {
    expect(validateSchema(1, { type: 'integer', dependentSchemas: {}, unevaluatedProperties: false }).unsupported).toEqual([
      'dependentSchemas',
      'unevaluatedProperties',
    ]);
  });

  it('explains a schema it cannot use', () => {
    expect(() => validateSchema(1, [1])).toThrow(SchemaLoadError);
    expect(() => validateSchema(1, { $ref: 'http://example.com/s.json' })).toThrow(/Only local references/);
    expect(() => validateSchema(1, { $ref: '#/$defs/missing' })).toThrow(/does not point/);
    expect(() => validateSchema('a', { pattern: '(' })).toThrow(/Invalid pattern/);
    expect(() => validateSchema(1, { $ref: '#' })).toThrow(/without end/);
  });

  it('stops after 500 errors', () => {
    const r = validateSchema(Array.from({ length: 600 }, () => 'x'), { items: { type: 'number' } });
    expect(r.errors).toHaveLength(500);
    expect(r.truncated).toBe(true);
  });
});

describe('validateDocument', () => {
  it('returns the result, or why the schema cannot be used', () => {
    expect(validateDocument(1, { type: 'string' }).result!.errors).toHaveLength(1);
    expect(validateDocument(1, { $ref: '#/nope' }).schemaError).toMatch(/^Reference/);
  });
});

describe('toJsonSchema with keys named like Object.prototype members', () => {
  it('does not treat "constructor" as present on every object', () => {
    const schema = toJsonSchema([{ constructor: 'x' }, { other: 1 }]) as any;
    expect(schema.items.required).toBeUndefined();
    expect(schema.items.properties.constructor).toEqual({ type: 'string' });
  });
});
