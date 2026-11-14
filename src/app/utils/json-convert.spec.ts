import { toCSharp } from './json-convert';
import { parseJson } from './json-parse';

describe('toCSharp', () => {
  it('declares classes with JSON names, merged array items and nullable members', () => {
    const cs = toCSharp({
      order_id: 'SO-1',
      lines: [{ sku: 'A', qty: 1, note: 'gift' }, { sku: 'B', qty: 2 }],
      paid: true,
      coupon: null,
    });
    expect(cs).toBe(
      [
        'using System;',
        'using System.Collections.Generic;',
        'using System.Text.Json.Serialization;',
        '',
        'public class Root',
        '{',
        '    [JsonPropertyName("order_id")]',
        '    public string OrderId { get; set; }',
        '',
        '    [JsonPropertyName("lines")]',
        '    public List<RootLine> Lines { get; set; }',
        '',
        '    [JsonPropertyName("paid")]',
        '    public bool Paid { get; set; }',
        '',
        '    [JsonPropertyName("coupon")]',
        '    public object? Coupon { get; set; }',
        '}',
        '',
        'public class RootLine',
        '{',
        '    [JsonPropertyName("sku")]',
        '    public string Sku { get; set; }',
        '',
        '    [JsonPropertyName("qty")]',
        '    public int Qty { get; set; }',
        '',
        '    [JsonPropertyName("note")]',
        '    public string? Note { get; set; }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('picks number, Guid and DateTime types', () => {
    const cs = toCSharp(
      parseJson(
        '{"small": 7, "big": 3000000000, "huge": 12345678901234567890123, "price": 9.99,' +
          ' "id": "0f8fad5b-d9cb-469f-a165-70867728950e", "at": "2026-10-23T07:00:00Z", "day": "2026-10-23", "word": "x"}',
      ),
    );
    for (const line of [
      'public int Small',
      'public long Big',
      'public decimal Huge',
      'public decimal Price',
      'public Guid Id',
      'public DateTime At',
      'public DateTime Day',
      'public string Word',
    ]) {
      expect(cs).toContain(line);
    }
  });

  it('wraps a root array and keeps member names valid', () => {
    const cs = toCSharp([{ Root: 1, '2nd': 'x', 'first-name': 'a', first_name: 'b' }]);
    expect(cs).toContain('// Deserialize the document as: List<RootItem>');
    expect(cs).toContain('public int Root { get; set; }'); // "Root" is fine inside RootItem
    expect(cs).toContain('public string _2nd { get; set; }');
    expect(cs).toContain('public string FirstName { get; set; }');
    expect(cs).toContain('public string FirstName2 { get; set; }');
  });

  it('renames a member that would share its class name, and handles mixed types', () => {
    const cs = toCSharp({ root: 1, mixed: [1, 'a'] });
    expect(cs).toContain('public int RootValue { get; set; }');
    expect(cs).toContain('public List<object?> Mixed { get; set; }');
  });
});
