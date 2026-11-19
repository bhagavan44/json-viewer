import {
  JsonWorkerMessage,
  JsonWorkerReply,
  JsonWorkerRequest,
  JsonWorkerResponse,
} from './json-worker-handler';

/** The reply type for a request's `op`. */
export type ReplyFor<R extends JsonWorkerRequest> = Extract<JsonWorkerReply, { op: R['op'] }>;

interface Pending {
  op: JsonWorkerRequest['op'];
  resolve: (reply: JsonWorkerReply | null) => void;
  reject: (error: Error) => void;
}

/**
 * Sends requests to the JSON worker and matches replies by id. Per operation the latest
 * request wins: an older one still running resolves with `null` as soon as a newer one is sent.
 * If the worker fails, pending requests reject and `available` turns false, so callers can
 * fall back to doing the work themselves.
 */
export class JsonWorkerClient {
  private worker: Worker | null = null;
  private failed = false;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(private readonly createWorker: () => Worker) {}

  get available(): boolean {
    return !this.failed;
  }

  run<R extends JsonWorkerRequest>(request: R): Promise<ReplyFor<R> | null> {
    if (this.failed) return Promise.reject(new Error('The JSON worker is not available'));
    for (const [id, p] of this.pending) {
      if (p.op !== request.op) continue;
      this.pending.delete(id);
      p.resolve(null);
    }
    let worker: Worker;
    try {
      worker = this.worker ??= this.start();
    } catch (e) {
      this.failed = true;
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    const id = this.nextId++;
    return new Promise<ReplyFor<R> | null>((resolve, reject) => {
      this.pending.set(id, {
        op: request.op,
        resolve: resolve as (reply: JsonWorkerReply | null) => void,
        reject,
      });
      const message: JsonWorkerMessage = { id, request };
      worker.postMessage(message);
    });
  }

  /** Stops the worker; pending requests resolve with `null`. */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.resolve(null);
    this.pending.clear();
  }

  private start(): Worker {
    const worker = this.createWorker();
    worker.addEventListener('message', (e: MessageEvent<JsonWorkerResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return; // superseded
      this.pending.delete(e.data.id);
      const reply = e.data.reply;
      if (reply.op === 'error') p.reject(new Error(reply.message));
      else p.resolve(reply);
    });
    worker.addEventListener('error', (e) => {
      e.preventDefault();
      this.fail(new Error(e.message || 'The JSON worker failed'));
    });
    worker.addEventListener('messageerror', () => this.fail(new Error('Unreadable worker reply')));
    return worker;
  }

  private fail(error: Error): void {
    this.failed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }
}
