import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  JsonTable,
  cellText,
  cellValue,
  compareCells,
  findTables,
  tableColumns,
  toCsv,
} from '../../utils/json-table';

/** Rows rendered at first, and added by each "Show more". */
const PAGE = 200;

/** Shows an array in the document as a sortable, filterable table, with CSV export. */
@Component({
  selector: 'app-json-table',
  standalone: false,
  templateUrl: './json-table.component.html',
  styleUrl: './json-table.component.scss',
})
export class JsonTableComponent implements OnChanges {
  @Input() data: any = null;
  @Input() error: string | null = null;
  @Input() isEmpty = false;
  /** Used to name the downloaded CSV file. */
  @Input() fileName: string | null = null;

  tables: JsonTable[] = [];
  table: JsonTable | null = null;
  columns: string[] = [];
  /** Original row indexes, after filtering and sorting. */
  view: number[] = [];
  limit = PAGE;
  query = '';
  sortColumn: string | null = null;
  sortDir: 1 | -1 = 1;

  constructor(private snackBar: MatSnackBar) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data']) {
      const previous = this.table?.path;
      this.tables = this.data === null || this.data === undefined ? [] : findTables(this.data);
      this.select(this.tables.find((t) => t.path === previous) ?? this.tables[0] ?? null, false);
    }
  }

  get state(): 'empty' | 'error' | 'none' | 'table' {
    if (this.error && !this.isEmpty) return 'error';
    if (this.isEmpty || this.data === null) return 'empty';
    return this.table ? 'table' : 'none';
  }

  selectPath(path: string): void {
    this.select(this.tables.find((t) => t.path === path) ?? null, true);
  }

  /** `reset` clears the filter and sort (a different table was picked, not new data). */
  private select(table: JsonTable | null, reset: boolean): void {
    this.table = table;
    this.columns = table ? tableColumns(table) : [];
    if (reset || (this.sortColumn !== null && !this.columns.includes(this.sortColumn))) {
      this.sortColumn = null;
      this.sortDir = 1;
    }
    if (reset) this.query = '';
    this.limit = PAGE;
    this.updateView();
  }

  label(t: JsonTable): string {
    return `${t.path} · ${t.rows.length} row${t.rows.length === 1 ? '' : 's'}`;
  }

  cell(rowIndex: number, column: string): string {
    return cellText(cellValue(this.table!, this.table!.rows[rowIndex], column));
  }

  isMissing(rowIndex: number, column: string): boolean {
    return cellValue(this.table!, this.table!.rows[rowIndex], column) === undefined;
  }

  /** Click cycles a column through ascending, descending and unsorted. */
  sortBy(column: string): void {
    if (this.sortColumn !== column) {
      this.sortColumn = column;
      this.sortDir = 1;
    } else if (this.sortDir === 1) {
      this.sortDir = -1;
    } else {
      this.sortColumn = null;
    }
    this.updateView();
  }

  ariaSort(column: string): string {
    if (this.sortColumn !== column) return 'none';
    return this.sortDir === 1 ? 'ascending' : 'descending';
  }

  onQueryChange(): void {
    this.limit = PAGE;
    this.updateView();
  }

  showMore(): void {
    this.limit += PAGE;
  }

  private updateView(): void {
    const table = this.table;
    if (!table) {
      this.view = [];
      return;
    }
    let view = table.rows.map((_, i) => i);
    const q = this.query.trim().toLowerCase();
    if (q)
      view = view.filter((i) =>
        this.columns.some((c) => this.cell(i, c).toLowerCase().includes(q)),
      );
    const col = this.sortColumn;
    if (col !== null) {
      const dir = this.sortDir;
      view.sort((a, b) => {
        const va = cellValue(table, table.rows[a], col);
        const vb = cellValue(table, table.rows[b], col);
        // Missing values stay last in both directions.
        if (va === undefined || vb === undefined) return compareCells(va, vb) || a - b;
        return dir * compareCells(va, vb) || a - b;
      });
    }
    this.view = view;
  }

  /** CSV of the rows as filtered and sorted. */
  private csv(): string {
    return toCsv(
      this.table!,
      this.view.map((i) => this.table!.rows[i]),
      this.columns,
    );
  }

  copyCsv(): void {
    navigator.clipboard
      .writeText(this.csv())
      .then(() =>
        this.snackBar.open(`Copied ${this.view.length} rows as CSV`, '', { duration: 1800 }),
      )
      .catch(() =>
        this.snackBar.open('Copy failed — clipboard access denied', '', { duration: 2500 }),
      );
  }

  downloadCsv(): void {
    const base = (this.fileName ?? 'table').replace(/\.(json|txt)$/i, '');
    const name = `${base}.csv`;
    const url = URL.createObjectURL(new Blob([this.csv()], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url));
    this.snackBar.open(`Downloaded ${name}`, '', { duration: 1800 });
  }
}
