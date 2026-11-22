import {
  CompareOutcome,
  ValidateOutcome,
  compareDocuments,
  validateDocument,
  withoutDiffValues,
} from './json-compare';
import { parseJson } from './json-parse';

/** Work sent to the JSON worker. Documents travel as text and are parsed there. */
export type JsonWorkerRequest =
  | { op: 'diff'; left: string; right: string; matchArrays: boolean; ignoreText: string }
  | { op: 'validate'; doc: string; schema: string };

/** The worker's answer. A diff comes back without its values (see `withoutDiffValues()`). */
export type JsonWorkerReply =
  | ({ op: 'diff' } & CompareOutcome)
  | ({ op: 'validate' } & ValidateOutcome)
  | { op: 'error'; message: string };

export interface JsonWorkerMessage {
  id: number;
  request: JsonWorkerRequest;
}

export interface JsonWorkerResponse {
  id: number;
  reply: JsonWorkerReply;
}

/** Runs one request. Used by the worker, and directly by tests. */
export function handleJsonRequest(request: JsonWorkerRequest): JsonWorkerReply {
  try {
    if (request.op === 'diff') {
      const outcome = compareDocuments(parseJson(request.left), parseJson(request.right), request);
      return { op: 'diff', ...outcome, result: withoutDiffValues(outcome.result) };
    }
    return {
      op: 'validate',
      ...validateDocument(parseJson(request.doc), parseJson(request.schema)),
    };
  } catch (e) {
    return { op: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
