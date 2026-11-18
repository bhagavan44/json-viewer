import { Component, EventEmitter, Input, Output } from '@angular/core';

/** The "Save JSON" dialog. The parent owns the name and does the saving. */
@Component({
  selector: 'app-save-dialog',
  standalone: false,
  templateUrl: './save-dialog.component.html',
  styleUrl: './save-dialog.component.scss',
})
export class SaveDialogComponent {
  /** The file name being edited. Bind with [(name)]. */
  @Input() name = '';
  @Output() nameChange = new EventEmitter<string>();
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
  /** The dice button: the parent replaces the name with a random one. */
  @Output() randomName = new EventEmitter<void>();
}
