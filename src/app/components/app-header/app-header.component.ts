import { Component, EventEmitter, Input, Output } from '@angular/core';

export type ViewMode = 'edit' | 'compare';

/** The top toolbar: logo, Workspace / Compare switch and the global actions. */
@Component({
  selector: 'app-header',
  standalone: false,
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.scss',
})
export class AppHeaderComponent {
  @Input() viewMode: ViewMode = 'edit';
  @Output() viewModeChange = new EventEmitter<ViewMode>();
  @Input() dark = true;
  @Input() filesOpen = false;
  /** Shown as a badge on the Files button. */
  @Input() fileCount = 0;

  /** Copy a share link; `true` hides sensitive values first. */
  @Output() share = new EventEmitter<boolean>();
  @Output() openPalette = new EventEmitter<void>();
  @Output() toggleFiles = new EventEmitter<void>();
  @Output() toggleTheme = new EventEmitter<void>();
}
