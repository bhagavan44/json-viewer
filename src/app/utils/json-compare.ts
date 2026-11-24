import { DiffResult, diffJson } from './json-diff';
import { valueAtPath } from './json-locate';
import { JsonPathError, looksLikeJsonPath, queryJsonPath } from './json-path';

/** Tree paths to leave out of a comparison, per side. */
export interface IgnoredPaths {
  left: Set<string>;
  right: Set<string>;
}

export interface CompareOptions {
  matchArrays: boolean;
  /** JSONPath expressions (comma-separated) whose values are left out, e.g. `$..updatedAt`. */
  ignoreText: string;
}

export interface CompareOutcome {
  result: DiffResult;
  /** Why `ignoreText` could not be used, if it could not (nothing is ignored then). */
  ignoreError: string | null;
}

/** Splits comma-separated JSONPath expressions, ignoring commas inside brackets, parentheses and quotes. */
export function splitJsonPaths(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') current += c + (text[++i] ?? '');
      else {
        if (c === quote) quote = null;
        current += c;
      }
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Why `ignoreText` cannot be used, judged from the text alone (no documents needed), so it can
 * be shown at once. `resolveIgnoredPaths` can still find errors that need evaluating the paths.
 */
export function ignoreTextError(ignoreText: string): string | null {
  const bad = splitJsonPaths(ignoreText).find((expr) => !looksLikeJsonPath(expr));
  return bad === undefined ? null : `"${bad}" is not a JSONPath (start it with $)`;
}

/** The tree paths that `ignoreText` selects in each document, or why it cannot be used. */
export function resolveIgnoredPaths(
  a: unknown,
  b: unknown,
  ignoreText: string,
): { ignore?: IgnoredPaths; error: string | null } {
  const expressions = splitJsonPaths(ignoreText);
  if (!expressions.length) return { error: null };
  const error = ignoreTextError(ignoreText);
  if (error) return { error };
  const ignore: IgnoredPaths = { left: new Set(), right: new Set() };
  for (const expr of expressions) {
    try {
      for (const m of queryJsonPath(a, expr)) ignore.left.add(m.path);
      for (const m of queryJsonPath(b, expr)) ignore.right.add(m.path);
    } catch (e) {
      return { error: `${expr}: ${e instanceof JsonPathError ? e.message : 'invalid path'}` };
    }
  }
  return { ignore, error: null };
}

/** Compares two parsed documents the way Compare does, leaving out the ignored paths. */
export function compareDocuments(a: unknown, b: unknown, options: CompareOptions): CompareOutcome {
  const { ignore, error } = resolveIgnoredPaths(a, b, options.ignoreText);
  return {
    result: diffJson(a, b, { matchArrays: options.matchArrays, ignore }),
    ignoreError: error,
  };
}

/**
 * The diff without the changed values, to send between threads: lossless numbers inside
 * the values would not survive the copy. `withDiffValues()` puts them back.
 */
export function withoutDiffValues(result: DiffResult): DiffResult {
  return {
    ...result,
    changes: result.changes.map(({ before: _b, after: _a, ...entry }) => entry),
  };
}

/** Fills in each change's values by looking its paths up in the two documents. */
export function withDiffValues(result: DiffResult, a: unknown, b: unknown): DiffResult {
  return {
    ...result,
    changes: result.changes.map((entry) => {
      const filled = { ...entry };
      if (entry.kind !== 'add') filled.before = valueAtPath(a, entry.path);
      if (entry.kind !== 'del') filled.after = valueAtPath(b, entry.rightPath ?? entry.path);
      return filled;
    }),
  };
}
