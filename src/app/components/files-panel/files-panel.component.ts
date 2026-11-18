import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { SavedFile } from '../../utils/file-store';
import { byteLength, formatBytes } from '../../utils/json-utils';

export type PaneSide = 'left' | 'right';

/**
 * The saved-files sidebar (a drawer on narrow screens). The parent owns the files, the search
 * query and the rename state, and does the storing.
 */
@Component({
  selector: 'app-files-panel',
  standalone: false,
  templateUrl: './files-panel.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './files-panel.component.scss',
})
export class FilesPanelComponent {
  @Input() open = false;
  /** The files to list, already filtered by `query`. */
  @Input() files: SavedFile[] = [];
  /** How many files are saved in total, shown in the header. */
  @Input() total = 0;
  /** The search text. Bind with [(query)]. */
  @Input() query = '';
  @Output() queryChange = new EventEmitter<string>();
  /** Ids of the files open in each pane, for the L / R badges. */
  @Input() leftFileId: string | null = null;
  @Input() rightFileId: string | null = null;
  /** The file being renamed, and its new name. Bind the name with [(renameValue)]. */
  @Input() renamingId: string | null = null;
  @Input() renameValue = '';
  @Output() renameValueChange = new EventEmitter<string>();

  @Output() closed = new EventEmitter<void>();
  /** A click on a file: open it in the active pane. */
  @Output() fileOpen = new EventEmitter<SavedFile>();
  @Output() fileOpenIn = new EventEmitter<{ file: SavedFile; side: PaneSide }>();
  @Output() renameStart = new EventEmitter<SavedFile>();
  @Output() renameConfirm = new EventEmitter<string>();
  @Output() renameCancel = new EventEmitter<void>();
  @Output() fileDelete = new EventEmitter<SavedFile>();

  // The list is re-rendered often; this keeps large files from being re-encoded each time.
  private sizes = new WeakMap<SavedFile, string>();

  fileSize(file: SavedFile): string {
    let size = this.sizes.get(file);
    if (size === undefined) this.sizes.set(file, (size = formatBytes(byteLength(file.content))));
    return size;
  }

  formatDate(ts: number): string {
    const d = new Date(ts);
    return (
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    );
  }
}
