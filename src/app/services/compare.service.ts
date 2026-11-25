import { Injectable, OnDestroy } from '@angular/core';
import { DiffKind, DiffResult } from '../utils/json-diff';
import type { SchemaError, ValidateOutcome, ValidationResult } from '../utils/json-schema-validate';
import type { PatchOp } from '../utils/json-patch';
import {
  CompareOptions,
  CompareOutcome,
  compareDocuments,
  ignoreTextError,
  resolveIgnoredPaths,
  withDiffValues,
} from '../utils/json-compare';
import { JsonWorkerClient } from '../utils/json-worker-client';

/**
 * Above this combined size, Compare and schema validation run in a Web Worker. Kept equal to
 * `LARGE_TEXT_CHARS` in `app.ts`.
 */
export const WORKER_MIN_CHARS = 200_000;

/** What the schema validation panel shows. */
export interface ValidationView {
  docSide: 'left' | 'right';
  schemaSide: 'left' | 'right';
  result?: ValidationResult;
  /** Why there is no result (a pane is empty or invalid, or the schema cannot be used). */
  problem?: string;
  /** The worker is still validating a large document. */
  pending?: boolean;
}

interface DiffMemo extends CompareOptions {
  left: unknown;
  right: unknown;
  result: DiffResult | null;
}

interface ValidationMemo {
  doc: unknown;
  schema: unknown;
  view: ValidationView;
}

/**
 * Compares two documents and validates a document against a schema. Results are memoized by
 * document identity, so they are cheap to read on every render. Large documents are handled in a
 * Web Worker; `onResult` is told when such a result arrives.
 */
@Injectable()
export class CompareService implements OnDestroy {
  /** The worker is still comparing the current documents. */
  diffPending = false;
  /** Why the ignored paths could not be used, if they could not. */
  ignoreError: string | null = null;

  private diffMemo: DiffMemo = {
    left: undefined,
    right: undefined,
    matchArrays: true,
    ignoreText: '',
    result: null,
  };
  private validationMemo: ValidationMemo | null = null;
  private schemaMarks: { errors: SchemaError[]; marks: Record<string, DiffKind> } | null = null;
  /** The text each parsed document came from, so the worker can be sent text instead of objects. */
  private parsedFrom = new WeakMap<object, string>();
  /** Runs Compare and schema validation of large documents off the main thread (none in tests). */
  private worker =
    typeof Worker === 'undefined'
      ? null
      : new JsonWorkerClient(
          () => new Worker(new URL('../json.worker', import.meta.url), { type: 'module' }),
        );
  private changed: () => void = () => undefined;

  /** Calls `listener` whenever a result from the worker (or a lazily loaded validator) arrives. */
  onResult(listener: () => void): void {
    this.changed = listener;
  }

  /** Records the text `doc` was parsed from, so a large document can go to the worker as text. */
  noteSource(doc: unknown, text: string): void {
    if (typeof doc === 'object' && doc !== null) this.parsedFrom.set(doc, text);
  }

  /**
   * The differences between `left` and `right`. Null while the worker compares new documents;
   * when only the options changed, the last result is kept until it replies.
   */
  diff(
    left: unknown,
    right: unknown,
    { matchArrays, ignoreText }: CompareOptions,
  ): DiffResult | null {
    const memo = this.diffMemo;
    if (
      memo.left === left &&
      memo.right === right &&
      memo.matchArrays === matchArrays &&
      memo.ignoreText === ignoreText
    )
      return memo.result;
    const next: DiffMemo = { left, right, matchArrays, ignoreText, result: null };
    this.diffMemo = next;
    const texts = this.workerTexts(left, right);
    if (texts) {
      if (memo.left === left && memo.right === right) next.result = memo.result;
      this.ignoreError = ignoreTextError(ignoreText);
      this.diffPending = true;
      void this.diffInWorker(next, texts);
    } else {
      this.diffPending = false;
      this.applyDiff(next, compareDocuments(left, right, { matchArrays, ignoreText }));
    }
    return next.result;
  }

  /** An RFC 6902 patch that turns `left` into `right`, leaving out the ignored paths. */
  async patch(left: unknown, right: unknown, ignoreText: string): Promise<PatchOp[]> {
    const { jsonPatch } = await import('../utils/json-patch');
    const { ignore } = resolveIgnoredPaths(left, right, ignoreText);
    return jsonPatch(left, right, new Set([...(ignore?.left ?? []), ...(ignore?.right ?? [])]));
  }

  /** Validates `doc` against `schema`. Pending at first: the validator loads on first use. */
  validate(doc: unknown, schema: unknown, docSide: 'left' | 'right'): ValidationView {
    const memo = this.validationMemo;
    if (memo && memo.doc === doc && memo.schema === schema && memo.view.docSide === docSide)
      return memo.view;
    const schemaSide = docSide === 'left' ? 'right' : 'left';
    const next: ValidationMemo = { doc, schema, view: { docSide, schemaSide, pending: true } };
    this.validationMemo = next;
    const texts = this.workerTexts(doc, schema);
    if (texts) void this.validateInWorker(next, texts);
    else void this.validateHere(next);
    return next.view;
  }

  /** Tree marks for schema errors: each failing path is marked as removed. */
  errorMarks(errors: SchemaError[]): Record<string, DiffKind> {
    if (this.schemaMarks?.errors !== errors) {
      const marks: Record<string, DiffKind> = {};
      for (const e of errors) marks[e.path] = 'del';
      this.schemaMarks = { errors, marks };
    }
    return this.schemaMarks.marks;
  }

  ngOnDestroy(): void {
    this.worker?.dispose();
  }

  private applyDiff(memo: DiffMemo, outcome: CompareOutcome): void {
    memo.result = outcome.result;
    this.ignoreError = outcome.ignoreError;
  }

  private async diffInWorker(memo: DiffMemo, [left, right]: [string, string]): Promise<void> {
    const { matchArrays, ignoreText } = memo;
    let outcome: CompareOutcome;
    try {
      const reply = await this.worker!.run({ op: 'diff', left, right, matchArrays, ignoreText });
      if (!reply) return; // a newer comparison replaced this one
      outcome = { ...reply, result: withDiffValues(reply.result, memo.left, memo.right) };
    } catch {
      outcome = compareDocuments(memo.left, memo.right, { matchArrays, ignoreText });
    }
    if (this.diffMemo !== memo) return;
    this.applyDiff(memo, outcome);
    this.diffPending = false;
    this.changed();
  }

  /** The texts two documents were parsed from, when together they are big enough for the worker. */
  private workerTexts(a: unknown, b: unknown): [string, string] | null {
    if (!this.worker?.available) return null;
    const textOf = (d: unknown) =>
      typeof d === 'object' && d !== null ? this.parsedFrom.get(d) : undefined;
    const first = textOf(a);
    const second = textOf(b);
    if (first === undefined || second === undefined) return null;
    return first.length + second.length > WORKER_MIN_CHARS ? [first, second] : null;
  }

  private validationView(docSide: 'left' | 'right', outcome: ValidateOutcome): ValidationView {
    const schemaSide = docSide === 'left' ? 'right' : 'left';
    return outcome.result
      ? { docSide, schemaSide, result: outcome.result }
      : { docSide, schemaSide, problem: `The schema cannot be used: ${outcome.schemaError}.` };
  }

  /** Validates on this thread (small documents); the validator loads on first use. */
  private async validateHere(memo: ValidationMemo): Promise<void> {
    const { validateDocument } = await import('../utils/json-schema-validate');
    if (this.validationMemo !== memo) return;
    memo.view = this.validationView(memo.view.docSide, validateDocument(memo.doc, memo.schema));
    this.changed();
  }

  private async validateInWorker(
    memo: ValidationMemo,
    [doc, schema]: [string, string],
  ): Promise<void> {
    let outcome: ValidateOutcome;
    try {
      const reply = await this.worker!.run({ op: 'validate', doc, schema });
      if (!reply) return; // a newer validation replaced this one
      outcome = reply;
    } catch {
      const { validateDocument } = await import('../utils/json-schema-validate');
      outcome = validateDocument(memo.doc, memo.schema);
    }
    if (this.validationMemo !== memo) return;
    memo.view = this.validationView(memo.view.docSide, outcome);
    this.changed();
  }
}
