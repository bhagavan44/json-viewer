import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DiffResult } from '../../utils/json-diff';

/** The bar above the panes in Compare: counts, ignore paths, options and actions. */
@Component({
  selector: 'app-compare-bar',
  standalone: false,
  templateUrl: './compare-bar.component.html',
  styleUrl: './compare-bar.component.scss',
})
export class CompareBarComponent {
  /** The comparison, or null when the two panes can't be compared yet. */
  @Input() diff: DiffResult | null = null;
  /** The comparison is still running (in the worker); shown when `diff` is null. */
  @Input() pending = false;
  /** Why there is no comparison, shown when `diff` is null. */
  @Input() message = '';
  /** Both panes hold valid JSON. */
  @Input() ready = false;

  /** Paths to leave out (JSONPath, comma-separated). Bind with [(ignoreText)]. */
  @Input() ignoreText = '';
  @Output() ignoreTextChange = new EventEmitter<string>();
  @Input() ignoreError: string | null = null;
  /** Bind with [(matchArrays)]. */
  @Input() matchArrays = true;
  @Output() matchArraysChange = new EventEmitter<boolean>();
  /** Bind with [(changesOnly)]. */
  @Input() changesOnly = false;
  @Output() changesOnlyChange = new EventEmitter<boolean>();

  @Output() copyPatch = new EventEmitter<void>();
  @Output() swap = new EventEmitter<void>();
}
