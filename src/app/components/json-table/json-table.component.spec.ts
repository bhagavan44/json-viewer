import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { JsonTableComponent } from './json-table.component';

const DOC = {
  customers: [
    { id: 3, name: 'Sam', city: 'Austin' },
    { id: 1, name: 'priya', city: 'Pune' },
    { id: 2, name: 'Ana' },
  ],
  orders: [{ id: 'o1', lines: [{ sku: 'A' }] }],
};

describe('JsonTableComponent', () => {
  function create(data: unknown = DOC) {
    TestBed.configureTestingModule({
      declarations: [JsonTableComponent],
      imports: [FormsModule, MatSnackBarModule],
      schemas: [NO_ERRORS_SCHEMA],
    });
    const fixture = TestBed.createComponent(JsonTableComponent);
    fixture.componentRef.setInput('data', data);
    fixture.detectChanges();
    return { fixture, table: fixture.componentInstance };
  }

  const names = (t: JsonTableComponent) => t.view.map((i) => t.cell(i, 'name'));

  it('shows the shallowest array and renders its rows', () => {
    const { fixture, table } = create();
    expect(table.tables.map((t) => t.path)).toEqual(['$.customers', '$.orders', '$.orders[*].lines']);
    expect(table.table!.path).toBe('$.customers');
    expect(table.columns).toEqual(['id', 'name', 'city']);
    const cells = Array.from(fixture.nativeElement.querySelectorAll('tbody tr:first-child td')).map((td: any) => td.textContent.trim());
    expect(cells).toEqual(['0', '3', 'Sam', 'Austin']);
  });

  it('sorts ascending, descending, then back to the original order', () => {
    const { table } = create();
    table.sortBy('name');
    expect(names(table)).toEqual(['Ana', 'priya', 'Sam']);
    table.sortBy('name');
    expect(names(table)).toEqual(['Sam', 'priya', 'Ana']);
    table.sortBy('name');
    expect(names(table)).toEqual(['Sam', 'priya', 'Ana']); // original order
    expect(table.sortColumn).toBeNull();
  });

  it('keeps rows without the sort key last in both directions', () => {
    const { table } = create();
    table.sortBy('city');
    expect(names(table)).toEqual(['Sam', 'priya', 'Ana']);
    table.sortBy('city');
    expect(names(table)).toEqual(['priya', 'Sam', 'Ana']);
  });

  it('filters rows on any column', () => {
    const { table } = create();
    table.query = 'pun';
    table.onQueryChange();
    expect(names(table)).toEqual(['priya']);
  });

  it('switches to another array and clears filter and sort', () => {
    const { table } = create();
    table.query = 'x';
    table.sortBy('name');
    table.selectPath('$.orders[*].lines');
    expect(table.columns).toEqual(['sku']);
    expect(table.query).toBe('');
    expect(table.sortColumn).toBeNull();
    expect(table.view).toEqual([0]);
  });

  it('keeps the chosen array and sort when the document changes', () => {
    const { fixture, table } = create();
    table.selectPath('$.orders');
    table.sortBy('id');
    fixture.componentRef.setInput('data', { ...DOC, orders: [{ id: 'o2' }, { id: 'o1' }] });
    fixture.detectChanges();
    expect(table.table!.path).toBe('$.orders');
    expect(table.view.map((i) => table.cell(i, 'id'))).toEqual(['o1', 'o2']);
  });

  it('explains when there is nothing to show as a table', () => {
    expect(create({ a: 1 }).table.state).toBe('none');
  });
});
