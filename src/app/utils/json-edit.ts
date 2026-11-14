import { LosslessNumber, parseJson, stringifyJson } from './json-parse';
import { spanOfPath } from './json-locate';

/**
 * Edits to JSON text that change one value and keep the rest of the text (its
 * formatting, key order and number spellings) exactly as it was.
 * Each function returns the new text and throws EditError when the edit cannot be made.
 */

export class EditError extends Error {}

function span(text: string, path: string) {
  const s = spanOfPath(text, path);
  if (!s) throw new EditError(`Nothing at ${path}`);
  return s;
}

/** Leading whitespace of the line containing `offset`. */
function lineIndent(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))![0];
}

/** The indent unit the document uses (two spaces when it cannot tell). */
function indentUnit(text: string): string {
  const m = /\n([ \t]+)\S/.exec(text);
  return m ? m[1] : '  ';
}

/** `value` as JSON, multi-line containers indented to sit at `indent`. */
function render(text: string, value: unknown, indent: string): string {
  const multiLine = text.includes('\n');
  const unit = indentUnit(text);
  const json = multiLine ? stringifyJson(value, unit.length || 2) : stringifyJson(value);
  return json.replace(/\n/g, '\n' + indent);
}

function checked(result: string): string {
  try {
    parseJson(result);
  } catch {
    throw new EditError('The edit would make the document invalid');
  }
  return result;
}

const splice = (text: string, start: number, end: number, insert: string) => text.slice(0, start) + insert + text.slice(end);

/** Replaces the value at `path`. */
export function setValue(text: string, path: string, value: unknown): string {
  const s = span(text, path);
  return checked(splice(text, s.start, s.end, render(text, value, lineIndent(text, s.keyStart))));
}

/** Renames the object member at `path` (a path ending in a key). */
export function renameKey(text: string, path: string, newKey: string): string {
  const s = span(text, path);
  if (s.keyStart === s.start) throw new EditError('Only object members have a key to rename');
  // The key is a string literal starting at keyStart.
  let end = s.keyStart + 1;
  while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
  return checked(splice(text, s.keyStart, end + 1, JSON.stringify(newKey)));
}

/** Removes the member or array item at `path`, with its separating comma. */
export function deleteAt(text: string, path: string): string {
  if (path === '$') throw new EditError('The whole document cannot be deleted');
  const s = span(text, path);
  // Followed by a comma: remove up to the next member, which takes this one's place.
  const after = /^\s*,\s*/.exec(text.slice(s.end));
  if (after) return checked(splice(text, s.keyStart, s.end + after[0].length, ''));
  // The last member: remove the comma before it (if any) through its end.
  let i = s.keyStart - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  return checked(text[i] === ',' ? splice(text, i, s.end, '') : splice(text, s.keyStart, s.end, ''));
}

/**
 * Adds a member (`key` given) or an item (`key` null) at the end of the object or
 * array at `parentPath`, following the layout of the existing members.
 */
export function addChild(text: string, parentPath: string, key: string | null, value: unknown): string {
  const s = span(text, parentPath);
  const open = text[s.start];
  if (open !== '{' && open !== '[') throw new EditError('Only objects and arrays have children');
  if ((open === '{') !== (key !== null)) throw new EditError(open === '{' ? 'A new member needs a key' : 'Array items have no key');
  const close = s.end - 1;
  const inner = text.slice(s.start + 1, close);
  const empty = !inner.trim();
  const multiLine = text.includes('\n');

  let indent: string;
  if (!empty) {
    let last = close - 1;
    while (/\s/.test(text[last])) last--;
    const laidOut = /\n/.test(inner);
    indent = laidOut ? lineIndent(text, last) : '';
    const member = (key !== null ? JSON.stringify(key) + ': ' : '') + render(text, value, indent);
    return checked(splice(text, last + 1, last + 1, laidOut ? `,\n${indent}${member}` : `, ${member}`));
  }
  const parentIndent = lineIndent(text, s.keyStart);
  indent = multiLine ? parentIndent + indentUnit(text) : '';
  const member = (key !== null ? JSON.stringify(key) + ': ' : '') + render(text, value, indent);
  return checked(splice(text, s.start + 1, close, multiLine ? `\n${indent}${member}\n${parentIndent}` : member));
}

/** How the text typed into an edit form is read. */
export type InputType = 'string' | 'number' | 'boolean' | 'null' | 'json';

/** The input type that fits an existing value. */
export function inputTypeOf(value: unknown): InputType {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return t;
  if (t === 'number' || value instanceof LosslessNumber) return 'number';
  return 'json';
}

/** The form text that shows `value` for editing. */
export function inputTextOf(value: unknown): string {
  const type = inputTypeOf(value);
  if (type === 'string') return value as string;
  if (type === 'null') return '';
  return stringifyJson(value);
}

/** Reads typed text as a value of `type`; throws EditError with a short reason when it cannot. */
export function valueFromInput(type: InputType, text: string): unknown {
  const t = text.trim();
  switch (type) {
    case 'string':
      return text;
    case 'null':
      return null;
    case 'boolean':
      if (t === 'true' || t === 'false') return t === 'true';
      throw new EditError('Type true or false');
    case 'number':
      if (!/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(t)) throw new EditError('Not a number');
      return parseJson(t);
    case 'json':
      try {
        return parseJson(t);
      } catch {
        throw new EditError('Not valid JSON');
      }
  }
}
