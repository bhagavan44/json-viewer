import { Component, Input } from '@angular/core';
import { JsonNode, TreeContext, TreeRow } from '../json-tree/json-tree.component';
import { escapeHtml } from '../../utils/json-utils';

const MAX_STRING = 120;

@Component({
  selector: 'app-json-tree-node',
  standalone: false,
  templateUrl: './json-tree-node.component.html',
  styleUrl: './json-tree-node.component.scss',
})
export class JsonTreeNodeComponent {
  /**
   * The line to render. The tree builds new rows on every refresh, so a changed row object is
   * what tells this OnPush component that its node (collapsed, match, …) may have changed.
   */
  @Input() row!: TreeRow;
  @Input() ctx!: TreeContext;

  get node(): JsonNode {
    return this.row.node;
  }

  get depth(): number {
    return this.row.depth;
  }

  /** Renders the closing bracket line of an expanded container instead of the node itself. */
  get closing(): boolean {
    return this.row.closing;
  }

  get isContainer(): boolean {
    return this.node.type === 'object' || this.node.type === 'array';
  }

  get openBracket(): string {
    return this.node.type === 'object' ? '{' : '[';
  }

  get closeBracket(): string {
    return this.node.type === 'object' ? '}' : ']';
  }

  get markSymbol(): string {
    return { add: '+', del: '−', chg: '~' }[this.node.mark ?? 'chg'];
  }

  get keyHtml(): string {
    const key = this.node.key ?? '';
    return this.node.inArray ? this.highlight(key) : `"${this.highlight(key)}"`;
  }

  get valueHtml(): string {
    const { type, value } = this.node;
    if (type === 'string') {
      const text = value.length > MAX_STRING ? value.substring(0, MAX_STRING) + '…' : value;
      return `"${this.highlight(text)}"`;
    }
    return this.highlight(String(value));
  }

  /** Escapes text and wraps search hits in <mark>. */
  private highlight(text: string): string {
    const q = this.ctx?.query.toLowerCase();
    if (!q) return escapeHtml(text);
    const lower = text.toLowerCase();
    let out = '';
    let i = 0;
    for (;;) {
      const hit = lower.indexOf(q, i);
      if (hit < 0) return out + escapeHtml(text.slice(i));
      out +=
        escapeHtml(text.slice(i, hit)) +
        '<mark>' +
        escapeHtml(text.slice(hit, hit + q.length)) +
        '</mark>';
      i = hit + q.length;
    }
  }

  onUnwrapClick(event: MouseEvent): void {
    event.stopPropagation();
    this.ctx.unwrap(this.node);
  }

  onRowClick(): void {
    this.ctx.select(this.node);
    if (this.isContainer) this.ctx.toggle(this.node);
  }
}
