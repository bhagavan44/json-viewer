import { AfterViewInit, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';

export interface PaletteCommand {
  id: string;
  group: string;
  label: string;
  /** Right-aligned secondary text, e.g. the pane the command applies to. */
  hint?: string;
  run: () => void;
}

@Component({
  selector: 'app-command-palette',
  standalone: false,
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.scss',
})
export class CommandPaletteComponent implements AfterViewInit {
  @Input() set commands(value: PaletteCommand[]) {
    this.all = value;
    this.filter();
  }
  @Output() closed = new EventEmitter<void>();
  @ViewChild('searchInput', { static: true }) searchInput!: ElementRef<HTMLInputElement>;

  query = '';
  results: PaletteCommand[] = [];
  active = 0;

  private all: PaletteCommand[] = [];

  ngAfterViewInit(): void {
    this.searchInput.nativeElement.focus();
  }

  filter(): void {
    const tokens = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    this.results = this.all.filter((c) => {
      const haystack = `${c.group} ${c.label}`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
    this.active = 0;
  }

  move(delta: number, event: Event): void {
    event.preventDefault();
    if (!this.results.length) return;
    this.active = (this.active + delta + this.results.length) % this.results.length;
    setTimeout(() => document.getElementById('palette-opt-' + this.active)?.scrollIntoView({ block: 'nearest' }));
  }

  runActive(): void {
    const command = this.results[this.active];
    if (command) this.run(command);
  }

  run(command: PaletteCommand): void {
    this.closed.emit();
    command.run();
  }

  close(event?: Event): void {
    event?.stopPropagation();
    this.closed.emit();
  }
}
