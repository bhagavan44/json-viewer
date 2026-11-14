import { LosslessNumber, stringifyJson } from './json-parse';
import { childPath, jsonTypeOf, summarizeValue } from './json-utils';

/** An array in the document that can be shown as a table. */
export interface JsonTable {
  /**
   * Tree-style path; `[*]` stands for "every item", so `$.orders[*].lines` holds the
   * lines of all orders together.
   */
  path: string;
  /** Rows: objects (one column per key) or scalars (a single "value" column). */
  rows: unknown[];
  kind: 'records' | 'values';
}

export const VALUE_COLUMN = 'value';
const MAX_TABLES = 100;
const MAX_COLUMNS = 200;

const isRecord = (v: unknown) => jsonTypeOf(v) === 'object';
const isScalar = (v: unknown) => {
  const t = jsonTypeOf(v);
  return t !== 'object' && t !== 'array';
};

/** Every array of records (or of scalars) in the document, shallowest first. */
export function findTables(doc: unknown): JsonTable[] {
  const tables: JsonTable[] = [];
  // Breadth-first over paths; each entry holds every value found at that path.
  const queue: { path: string; values: unknown[] }[] = [{ path: '$', values: [doc] }];
  while (queue.length && tables.length < MAX_TABLES) {
    const { path, values } = queue.shift()!;
    const rows = values.filter(Array.isArray).flat();
    const objects = values.filter(isRecord) as Record<string, unknown>[];

    if (rows.length) {
      if (rows.every(isRecord)) tables.push({ path, rows, kind: 'records' });
      else if (rows.every(isScalar)) tables.push({ path, rows, kind: 'values' });
      queue.push({ path: `${path}[*]`, values: rows });
    }
    if (objects.length) {
      const keys = new Set<string>();
      for (const o of objects) for (const k of Object.keys(o)) keys.add(k);
      for (const k of keys) {
        const children = objects.filter((o) => Object.hasOwn(o, k)).map((o) => o[k]);
        if (children.some((c) => !isScalar(c))) queue.push({ path: childPath(path, k, false), values: children });
      }
    }
  }
  return tables;
}

/** Column names: the keys of all rows, in the order they first appear. */
export function tableColumns(table: JsonTable): string[] {
  if (table.kind === 'values') return [VALUE_COLUMN];
  const keys = new Set<string>();
  for (const row of table.rows as Record<string, unknown>[]) {
    for (const k of Object.keys(row)) {
      keys.add(k);
      if (keys.size >= MAX_COLUMNS) return [...keys];
    }
  }
  return [...keys];
}

/** The value of `column` in `row`, or undefined when the row has no such key. */
export function cellValue(table: JsonTable, row: unknown, column: string): unknown {
  if (table.kind === 'values') return row;
  return Object.hasOwn(row as object, column) ? (row as any)[column] : undefined;
}

/** Display text for a cell: strings unquoted, containers summarized, missing keys empty. */
export function cellText(value: unknown): string {
  if (value === undefined) return '';
  const type = jsonTypeOf(value);
  if (type === 'string') return value as string;
  if (type === 'object' || type === 'array') return summarizeValue(value);
  return String(value);
}

/** Sort order: missing last, then numbers numerically, then everything else as text. */
export function compareCells(a: unknown, b: unknown): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  const na = typeof a === 'number' || a instanceof LosslessNumber;
  const nb = typeof b === 'number' || b instanceof LosslessNumber;
  if (na && nb) {
    const diff = Number(a) - Number(b);
    // Big numbers that are equal as doubles: compare their digits.
    return diff !== 0 ? diff : String(a).localeCompare(String(b), undefined, { numeric: true });
  }
  if (na !== nb) return na ? -1 : 1;
  return cellText(a).localeCompare(cellText(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * RFC 4180 CSV. Containers are written as JSON. Text that a spreadsheet would run as
 * a formula (starting with =, +, @, tab or CR) is prefixed with an apostrophe.
 */
export function toCsv(table: JsonTable, rows: unknown[], columns: string[]): string {
  const field = (value: unknown): string => {
    if (value === undefined || value === null) return '';
    const type = jsonTypeOf(value);
    let text = type === 'object' || type === 'array' ? stringifyJson(value) : String(value);
    if (type === 'string' && /^[=+@\t\r]/.test(text)) text = "'" + text;
    return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map(field).join(',')];
  for (const row of rows) lines.push(columns.map((c) => field(cellValue(table, row, c))).join(','));
  return lines.join('\r\n') + '\r\n';
}
