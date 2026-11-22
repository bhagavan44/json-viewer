import {
  JsonWorkerMessage,
  JsonWorkerReply,
  JsonWorkerRequest,
  JsonWorkerResponse,
} from './json-worker-handler';

/** The reply type for a request's `op`. */
export type ReplyFor<R extends JsonWorkerRequest> = Extract<JsonWorkerReply, { op: R['op'] }>;

interface Pending {
  request: JsonWorkerRequest;
  resolve: (reply: JsonWorkerReply | null) => void;
  reject: (error: Error) => void;
}

/**
 * Sends requests to the JSON worker and matches replies by id. Per operation the latest
 * request wins: an older one still running resolves with `null` as soon as a newer one is sent,
 * and the worker is restarted so it doesn't spend time finishing work nobody wants. Requests of
 * the other operations are sent again to the new worker.
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
    let superseded = false;
    for (const [id, p] of this.pending) {
      if (p.request.op !== request.op) continue;
      this.pending.delete(id);
      p.resolve(null);
      superseded = true;
    }
    if (superseded && this.worker) {
      // The worker handles one message at a time, so a replaced request would still run in full.
      this.worker.terminate();
      this.worker = null;
    }
    let worker: Worker;
    try {
      if (!this.worker) {
        worker = this.worker = this.start();
        for (const [id, p] of this.pending) this.post(worker, id, p.request);
      } else worker = this.worker;
    } catch (e) {
      this.fail(e instanceof Error ? e : new Error(String(e)));
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    const id = this.nextId++;
    return new Promise<ReplyFor<R> | null>((resolve, reject) => {
      this.pending.set(id, {
        request,
        resolve: resolve as (reply: JsonWorkerReply | null) => void,
        reject,
      });
      this.post(worker, id, request);
    });
  }

  private post(worker: Worker, id: number, request: JsonWorkerRequest): void {
    const message: JsonWorkerMessage = { id, request };
    worker.postMessage(message);
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
