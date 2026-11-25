import { SavedFile } from './file-store';

export type PanelMode = 'editor' | 'tree' | 'table';

export const PANEL_MODES: PanelMode[] = ['editor', 'tree', 'table'];

/** The parts of a pane that the session remembers. */
export interface PaneState {
  jsonText: string;
  currentFileId: string | null;
  sourceName: string | null;
  mode: PanelMode;
}

/** Everything the session remembers, read from the app. */
export interface SessionState {
  left: PaneState;
  right: PaneState;
  viewMode: 'edit' | 'compare';
  active: 'left' | 'right';
  matchArrays: boolean;
  ignoreText: string;
  savedFiles: SavedFile[];
}

interface PaneSession {
  /** Unsaved text. Omitted when the pane just mirrors a saved file. */
  text: string | null;
  fileId: string | null;
  sourceName: string | null;
  mode: PanelMode;
}

/** The stored form of a session. */
export interface Session {
  version: 1;
  left: PaneSession;
  right: PaneSession;
  viewMode: 'edit' | 'compare';
  active: 'left' | 'right';
  matchArrays?: boolean;
  ignoreText?: string;
}

/** A stored session, checked and ready to apply. */
export interface RestoredSession {
  left: PaneState;
  right: PaneState;
  viewMode: 'edit' | 'compare';
  active: 'left' | 'right';
  matchArrays: boolean;
  ignoreText: string;
}

function toPaneSession(pane: PaneState, files: SavedFile[], maxText: number): PaneSession {
  const file = files.find((f) => f.id === pane.currentFileId);
  const matchesFile = !!file && file.content === pane.jsonText;
  const keepText = !matchesFile && pane.jsonText.length <= maxText;
  return {
    text: keepText ? pane.jsonText : null,
    fileId: pane.currentFileId,
    sourceName: pane.sourceName,
    mode: pane.mode,
  };
}

/**
 * The session to store. A pane that mirrors a saved file keeps only the file's id, and text
 * longer than `maxText` characters is left out.
 */
export function toSession(state: SessionState, maxText: number): Session {
  return {
    version: 1,
    left: toPaneSession(state.left, state.savedFiles, maxText),
    right: toPaneSession(state.right, state.savedFiles, maxText),
    viewMode: state.viewMode,
    active: state.active,
    matchArrays: state.matchArrays,
    ignoreText: state.ignoreText,
  };
}

function readPane(pane: PaneSession, files: SavedFile[]): PaneState {
  const file = files.find((f) => f.id === pane.fileId);
  return {
    jsonText: typeof pane.text === 'string' ? pane.text : (file?.content ?? ''),
    currentFileId: file ? file.id : null,
    sourceName: typeof pane.sourceName === 'string' ? pane.sourceName : null,
    mode: PANEL_MODES.includes(pane.mode) ? pane.mode : 'editor',
  };
}

/**
 * Checks a stored session against the saved files. Returns null when it is missing or from
 * another version; unknown values fall back to their defaults.
 */
export function readSession(stored: unknown, files: SavedFile[]): RestoredSession | null {
  const session = stored as Session | null;
  if (session?.version !== 1 || !session.left || !session.right) return null;
  return {
    left: readPane(session.left, files),
    right: readPane(session.right, files),
    viewMode: session.viewMode === 'compare' ? 'compare' : 'edit',
    active: session.active === 'right' ? 'right' : 'left',
    matchArrays: session.matchArrays !== false,
    ignoreText: typeof session.ignoreText === 'string' ? session.ignoreText : '',
  };
}

/**
 * The values whose change means the session must be saved again. Compare two of these with
 * `sameValues()`; the saved files count only by number and newest save time.
 */
export function sessionValues(state: SessionState): unknown[] {
  const { left: l, right: r, savedFiles } = state;
  return [
    l.jsonText,
    r.jsonText,
    l.currentFileId,
    r.currentFileId,
    l.sourceName,
    r.sourceName,
    l.mode,
    r.mode,
    state.viewMode,
    state.active,
    savedFiles.length + ':' + (savedFiles[0]?.savedAt ?? ''),
    state.matchArrays,
    state.ignoreText,
  ];
}

export function sameValues(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
