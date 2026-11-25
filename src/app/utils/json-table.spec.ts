import { parseJson } from './json-parse';
import { cellText, cellValue, compareCells, findTables, tableColumns, toCsv } from './json-table';

const ORDERS = {
  count: 2,
  orders: [
    { id: 1, customer: { name: 'Priya' }, lines: [{ sku: 'A', qty: 1 }], tags: ['new'] },
    {
      id: 2,
      customer: { name: 'Sam' },
      lines: [
        { sku: 'B', qty: 2 },
        { sku: 'C', qty: 3, note: 'gift' },
      ],
      tags: [],
    },
  ],
};

describe('findTables', () => {
  it('finds arrays of records and of values, shallowest first, merging nested arrays', () => {
    const tables = findTables(ORDERS);
    expect(tables.map((t) => [t.path, t.kind, t.rows.length])).toEqual([
      ['$.orders', 'records', 2],
      ['$.orders[*].lines', 'records', 3],
      ['$.orders[*].tags', 'values', 1],
    ]);
  });

  it('treats a root array as a table', () => {
    expect(findTables([{ a: 1 }, { b: 2 }]).map((t) => t.path)).toEqual(['$']);
  });

  it('skips arrays that mix records and scalars, but looks inside them', () => {
    expect(findTables({ mixed: [1, { inner: [{ x: 1 }] }] }).map((t) => t.path)).toEqual([
      '$.mixed[*].inner',
    ]);
  });

  it('finds nothing in a document without arrays', () => {
    expect(findTables({ a: 1, b: { c: 'x' } })).toEqual([]);
  });
});

describe('table cells', () => {
  const [, lines] = findTables(ORDERS);

  it('uses the keys of all rows as columns', () => {
    expect(tableColumns(lines)).toEqual(['sku', 'qty', 'note']);
    expect(tableColumns(findTables(ORDERS)[2])).toEqual(['value']);
  });

  it('shows missing keys as empty and containers as summaries', () => {
    expect(cellText(cellValue(lines, lines.rows[0], 'note'))).toBe('');
    expect(cellText({ a: 1 })).toBe('{1 key}');
    expect(cellText('plain')).toBe('plain');
    expect(cellText(null)).toBe('null');
  });

  it('sorts numbers numerically, text naturally, missing values last', () => {
    expect([10, 9, undefined, 100].sort(compareCells)).toEqual([9, 10, 100, undefined]);
    expect(['item10', 'Item2', 'item1'].sort(compareCells)).toEqual(['item1', 'Item2', 'item10']);
    const big = parseJson('[9007199254740993, 9007199254740992]');
    expect([...big].sort(compareCells).map(String)).toEqual([
      '9007199254740992',
      '9007199254740993',
    ]);
  });
});

describe('toCsv', () => {
  it('writes a header and one line per row, quoting where needed', () => {
    const table = findTables([
      { name: 'A, B', qty: 1, meta: { x: 1 } },
      { name: 'say "hi"', note: 'line\nbreak' },
    ])[0];
    expect(toCsv(table, table.rows, tableColumns(table))).toBe(
      'name,qty,meta,note\r\n' + '"A, B",1,"{""x"":1}",\r\n' + '"say ""hi""",,,"line\nbreak"\r\n',
    );
  });

  it('defuses spreadsheet formulas and keeps big numbers exact', () => {
    const table = findTables(
      parseJson('[{"f":"=SUM(A1)","id":1234567890123456789,"neg":"-5"}]'),
    )[0];
    expect(toCsv(table, table.rows, tableColumns(table))).toBe(
      "f,id,neg\r\n'=SUM(A1),1234567890123456789,-5\r\n",
    );
  });
});
