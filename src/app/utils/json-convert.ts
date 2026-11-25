import { jsonTypeOf } from './json-utils';

const PLAIN_YAML = /^[A-Za-z_][\w ./@+-]*$/;
const YAML_RESERVED = /^(true|false|null|yes|no|on|off|y|n|~)$/i;

function yamlScalar(value: any): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    const safe = PLAIN_YAML.test(value) && !YAML_RESERVED.test(value) && !/\s$/.test(value);
    return safe ? value : JSON.stringify(value);
  }
  return String(value);
}

function yamlKey(key: string): string {
  return PLAIN_YAML.test(key) && !YAML_RESERVED.test(key) && !/\s$/.test(key)
    ? key
    : JSON.stringify(key);
}

function isNonEmptyContainer(v: any): boolean {
  const t = jsonTypeOf(v);
  return (t === 'array' && v.length > 0) || (t === 'object' && Object.keys(v).length > 0);
}

export function toYaml(value: any, indent = 0): string {
  const pad = '  '.repeat(indent);
  const type = jsonTypeOf(value);
  if (type === 'array') {
    if (!value.length) return pad + '[]';
    return value
      .map((item: any) =>
        isNonEmptyContainer(item)
          ? `${pad}- ${toYaml(item, indent + 1).trimStart()}`
          : `${pad}- ${emptyOrScalar(item)}`,
      )
      .join('\n');
  }
  if (type === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return pad + '{}';
    return entries
      .map(([k, v]) =>
        isNonEmptyContainer(v)
          ? `${pad}${yamlKey(k)}:\n${toYaml(v, indent + 1)}`
          : `${pad}${yamlKey(k)}: ${emptyOrScalar(v)}`,
      )
      .join('\n');
  }
  return pad + yamlScalar(value);
}

function emptyOrScalar(v: any): string {
  const t = jsonTypeOf(v);
  if (t === 'array') return '[]';
  if (t === 'object') return '{}';
  return yamlScalar(v);
}

// ── TypeScript ──────────────────────────────────────────────────────────────
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function pascal(key: string): string {
  const name = key
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
  if (!name) return 'Value';
  return /^\d/.test(name) ? '_' + name : name;
}

function singular(name: string): string {
  if (name.endsWith('ies') && name.length > 3) return name.slice(0, -3) + 'y';
  if (name.endsWith('s') && !name.endsWith('ss') && name.length > 1) return name.slice(0, -1);
  return name + 'Item';
}

/**
 * Infers TypeScript declarations from a JSON value. Array elements are merged,
 * so keys missing from some elements become optional and mixed types become unions.
 */
export function toTypeScript(value: any, rootName = 'Root'): string {
  const decls = new Map<string, string>();
  const used = new Set<string>();

  const uniqueName = (base: string): string => {
    let name = base;
    for (let i = 2; used.has(name); i++) name = base + i;
    used.add(name);
    return name;
  };

  const declare = (objects: any[], base: string): string => {
    const name = uniqueName(base);
    decls.set(name, ''); // reserve the slot so the parent is listed before its children
    const keys = [...new Set(objects.flatMap((o) => Object.keys(o)))];
    const lines = keys.map((key) => {
      const having = objects.filter((o) => Object.hasOwn(o, key));
      const optional = having.length < objects.length ? '?' : '';
      const prop = IDENTIFIER.test(key) ? key : JSON.stringify(key);
      return `  ${prop}${optional}: ${infer(
        having.map((o) => o[key]),
        name + pascal(key),
      )};`;
    });
    decls.set(
      name,
      lines.length ? `interface ${name} {\n${lines.join('\n')}\n}` : `interface ${name} {}`,
    );
    return name;
  };

  const infer = (values: any[], name: string): string => {
    const parts = new Set<string>();
    const objects: any[] = [];
    const arrays: any[][] = [];
    for (const v of values) {
      const t = jsonTypeOf(v);
      if (t === 'object') objects.push(v);
      else if (t === 'array') arrays.push(v);
      else parts.add(t);
    }
    if (objects.length) parts.add(declare(objects, name));
    if (arrays.length) {
      const items = arrays.flat();
      const inner = items.length ? infer(items, singular(name)) : 'unknown';
      parts.add(inner.includes(' | ') ? `(${inner})[]` : `${inner}[]`);
    }
    return [...parts].join(' | ') || 'unknown';
  };

  const top = infer([value], rootName);
  const out = [...decls.values()];
  if (top !== rootName || !decls.has(rootName)) out.unshift(`type ${rootName} = ${top};`);
  return out.join('\n\n');
}

// ── C# ──────────────────────────────────────────────────────────────────────

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const INT32 = 2n ** 31n;
const INT64 = 2n ** 63n;

/** int, long or decimal, whichever holds every value. */
function numberType(values: any[]): string {
  let type = 'int';
  for (const v of values) {
    const text = String(v);
    if (!/^-?\d+$/.test(text)) return 'decimal';
    const n = BigInt(text);
    if (n < -INT64 || n >= INT64) return 'decimal';
    if (n < -INT32 || n >= INT32) type = 'long';
  }
  return type;
}

/**
 * Infers C# classes (System.Text.Json) from a JSON value. Array elements are
 * merged: keys missing from some elements, or holding null, become nullable.
 * Strings that are all GUIDs or ISO dates become Guid or DateTime; whole numbers
 * become int or long, others decimal.
 */
export function toCSharp(value: any, rootName = 'Root'): string {
  const classes = new Map<string, string>();
  const used = new Set<string>();
  const uniqueName = (base: string): string => {
    let name = base;
    for (let i = 2; used.has(name); i++) name = base + i;
    used.add(name);
    return name;
  };

  const declare = (objects: any[], base: string): string => {
    const name = uniqueName(base);
    classes.set(name, ''); // reserve the slot so the parent is listed before its children
    const keys = [...new Set(objects.flatMap((o) => Object.keys(o)))];
    const props = new Set<string>();
    const lines = keys.map((key) => {
      const having = objects.filter((o) => Object.hasOwn(o, key));
      let prop = pascal(key);
      if (prop === name) prop += 'Value'; // a member cannot share its class's name
      for (let i = 2, base = prop; props.has(prop); i++) prop = base + i;
      props.add(prop);
      const { type, nullable } = infer(
        having.map((o) => o[key]),
        name + pascal(key),
      );
      const optional = nullable || having.length < objects.length ? '?' : '';
      return `    [JsonPropertyName(${JSON.stringify(key)})]\n    public ${type}${optional} ${prop} { get; set; }`;
    });
    classes.set(name, `public class ${name}\n{\n${lines.join('\n\n')}\n}`);
    return name;
  };

  const infer = (values: any[], name: string): { type: string; nullable: boolean } => {
    const present = values.filter((v) => v !== null);
    const nullable = present.length < values.length;
    const kinds = new Set(present.map((v) => jsonTypeOf(v)));
    if (kinds.size !== 1) return { type: 'object', nullable: true };
    switch ([...kinds][0]) {
      case 'string':
        if (present.every((s) => GUID.test(s))) return { type: 'Guid', nullable };
        if (present.every((s) => ISO_DATE.test(s))) return { type: 'DateTime', nullable };
        return { type: 'string', nullable };
      case 'number':
        return { type: numberType(present), nullable };
      case 'boolean':
        return { type: 'bool', nullable };
      case 'object':
        return { type: declare(present, name), nullable };
      default: {
        const items = present.flat();
        const inner = items.length
          ? infer(items, singular(name))
          : { type: 'object', nullable: true };
        return { type: `List<${inner.type}${inner.nullable ? '?' : ''}>`, nullable };
      }
    }
  };

  const top = infer([value], rootName);
  const out = [
    'using System;',
    'using System.Collections.Generic;',
    'using System.Text.Json.Serialization;',
  ];
  if (top.type !== rootName)
    out.push('', `// Deserialize the document as: ${top.type}${top.nullable ? '?' : ''}`);
  for (const decl of classes.values()) out.push('', decl);
  return out.join('\n') + '\n';
}
