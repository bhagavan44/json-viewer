import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';

declare const require: any;

@Component({
  selector: 'app-json-editor',
  standalone: false,
  templateUrl: './json-editor.component.html',
  styleUrl: './json-editor.component.scss',
})
export class JsonEditorComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild('editorHost', { static: true }) editorHost!: ElementRef<HTMLElement>;

  @Input() code: string = '';
  @Input() theme: 'vs-dark' | 'vs' = 'vs-dark';
  @Output() codeChange = new EventEmitter<string>();
  /** Moves the cursor to a line and column (e.g. a parse error). `n` makes each request unique. */
  @Input() jumpTo: { line: number; column: number; n: number } | null = null;
  @Output() jumpHandled = new EventEmitter<void>();
  /** Ctrl/Cmd+K inside the editor, which Monaco would otherwise use as a chord prefix. */
  @Output() openPalette = new EventEmitter<void>();
  /** Selects and reveals a range of the text (character offsets). Each request is a new object. */
  @Input() select: { start: number; end: number } | null = null;
  @Output() selectHandled = new EventEmitter<void>();
  /** Where the cursor is (character offset), shortly after it stops moving. */
  @Output() cursorOffset = new EventEmitter<number>();
  private cursorTimer?: ReturnType<typeof setTimeout>;

  private editor: any = null;
  private monacoLoaded = false;
  /** Prevents circular update: external code change → setValue → onDidChangeModelContent */
  private suppressChange = false;

  ngOnInit(): void {
    this.loadMonaco();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['code'] && this.editor) {
      const current = this.editor.getValue();
      if (current !== this.code) {
        this.suppressChange = true;
        // Preserve cursor position when program updates the text
        const model = this.editor.getModel();
        const position = this.editor.getPosition();
        model.pushEditOperations(
          [],
          [{ range: model.getFullModelRange(), text: this.code }],
          () => null,
        );
        if (position) this.editor.setPosition(position);
        this.suppressChange = false;
      }
    }
    if (changes['jumpTo'] && this.jumpTo) {
      this.applyJump();
    }
    if (changes['select'] && this.select) {
      this.applySelect();
    }
    if (changes['theme'] && this.editor) {
      (window as any).monaco?.editor.setTheme(this.theme);
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.cursorTimer);
    this.editor?.dispose();
  }

  private loadMonaco(): void {
    const win = window as any;

    if (win.monaco) {
      this.initEditor();
      return;
    }

    if (win._monacoLoading) {
      // Another component is already loading Monaco; wait for the event
      window.addEventListener('monaco-ready', () => this.initEditor(), { once: true });
      return;
    }

    win._monacoLoading = true;

    const script = document.createElement('script');
    script.src = 'vs/loader.js';
    script.onload = () => {
      win.require.config({ paths: { vs: 'vs' } });
      win.require(['vs/editor/editor.main'], () => {
        win._monacoLoading = false;
        this.monacoLoaded = true;
        window.dispatchEvent(new Event('monaco-ready'));
        this.initEditor();
      });
    };
    script.onerror = () => console.error('Failed to load Monaco editor from vs/loader.js');
    document.head.appendChild(script);
  }

  private applyJump(): void {
    if (!this.editor || !this.jumpTo) return;
    const position = { lineNumber: this.jumpTo.line, column: this.jumpTo.column };
    this.editor.setPosition(position);
    this.editor.revealPositionInCenter(position);
    this.editor.focus();
    // Defer so the parent is not changed in the middle of its own change detection.
    Promise.resolve().then(() => this.jumpHandled.emit());
  }

  private applySelect(): void {
    if (!this.editor || !this.select) return;
    const model = this.editor.getModel();
    const start = model.getPositionAt(this.select.start);
    const end = model.getPositionAt(this.select.end);
    const range = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
    this.editor.setSelection(range);
    this.editor.revealRangeInCenterIfOutsideViewport(range);
    Promise.resolve().then(() => this.selectHandled.emit());
  }

  private initEditor(): void {
    const monaco = (window as any).monaco;
    if (!monaco || !this.editorHost) return;

    this.editor = monaco.editor.create(this.editorHost.nativeElement, {
      value: this.code,
      language: 'json',
      theme: this.theme,
      automaticLayout: true,
      minimap: { enabled: false },
      // File drops are handled by the app (they open the file in this pane), not inserted as text.
      dropIntoEditor: { enabled: false },
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      fontLigatures: true,
      tabSize: 2,
      formatOnPaste: true,
      formatOnType: false,
      scrollBeyondLastLine: false,
      lineNumbers: 'on',
      folding: true,
      foldingStrategy: 'indentation',
      renderLineHighlight: 'all',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true },
      wordWrap: 'on',
      scrollbar: { verticalScrollbarSize: 10, horizontal: 'hidden', alwaysConsumeMouseWheel: false },
      padding: { top: 8 },
    });

    this.editor.onDidChangeModelContent(() => {
      if (!this.suppressChange) {
        this.codeChange.emit(this.editor.getValue());
      }
    });

    this.editor.addCommand(
      (window as any).monaco.KeyMod.CtrlCmd | (window as any).monaco.KeyCode.KeyK,
      () => this.openPalette.emit(),
    );
    this.applyJump();
    this.applySelect();

    this.editor.onDidChangeCursorPosition((e: any) => {
      clearTimeout(this.cursorTimer);
      this.cursorTimer = setTimeout(() => {
        const model = this.editor?.getModel();
        if (model) this.cursorOffset.emit(model.getOffsetAt(e.position));
      }, 150);
    });

    // Format shortcut: Shift+Alt+F
    this.editor.addAction({
      id: 'format-json',
      label: 'Format JSON',
      keybindings: [(window as any).monaco.KeyMod.Shift | (window as any).monaco.KeyMod.Alt | (window as any).monaco.KeyCode.KeyF],
      run: () => this.editor.getAction('editor.action.formatDocument')?.run(),
    });
  }
}
