import { JsonWorkerClient } from './json-worker-client';
import { JsonWorkerMessage, handleJsonRequest } from './json-worker-handler';

/** Runs the handler in-process; replies arrive asynchronously, like a real worker's. */
class FakeWorker extends EventTarget {
  sent: JsonWorkerMessage[] = [];
  terminated = false;
  /** When false, messages are held until `flush()`. */
  auto = true;

  postMessage(message: JsonWorkerMessage): void {
    this.sent.push(message);
    if (this.auto) this.flush();
  }

  flush(): void {
    for (const { id, request } of this.sent.splice(0)) {
      const data = { id, reply: handleJsonRequest(structuredClone(request)) };
      setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data })));
    }
  }

  crash(): void {
    this.dispatchEvent(new ErrorEvent('error', { message: 'boom', cancelable: true }));
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('JsonWorkerClient', () => {
  let worker: FakeWorker;
  let created: number;
  let client: JsonWorkerClient;

  beforeEach(() => {
    worker = new FakeWorker();
    created = 0;
    client = new JsonWorkerClient(() => {
      created++;
      return worker as unknown as Worker;
    });
  });

  it('starts the worker on the first request and resolves with its reply', async () => {
    expect(created).toBe(0);
    const reply = await client.run({ op: 'validate', doc: '1', schema: '{"type":"number"}' });
    expect(reply?.result?.errors).toEqual([]);
    await client.run({ op: 'validate', doc: '1', schema: '{}' });
    expect(created).toBe(1);
  });

  it('lets the latest request of the same kind win', async () => {
    worker.auto = false;
    const first = client.run({ op: 'validate', doc: '1', schema: '{}' });
    const diff = client.run({
      op: 'diff',
      left: '1',
      right: '2',
      matchArrays: true,
      ignoreText: '',
    });
    const second = client.run({ op: 'validate', doc: '"x"', schema: '{"type":"number"}' });
    expect(await first).toBeNull();
    worker.flush();
    expect((await second)?.result?.errors).toHaveLength(1);
    expect((await diff)?.result.changed).toBe(1);
  });

  it('rejects an error reply', async () => {
    await expect(client.run({ op: 'validate', doc: '{', schema: '{}' })).rejects.toThrow();
    expect(client.available).toBe(true);
  });

  it('rejects pending requests and stays unavailable after the worker fails', async () => {
    worker.auto = false;
    const pending = client.run({ op: 'validate', doc: '1', schema: '{}' });
    worker.crash();
    await expect(pending).rejects.toThrow('boom');
    expect(worker.terminated).toBe(true);
    expect(client.available).toBe(false);
    await expect(client.run({ op: 'validate', doc: '1', schema: '{}' })).rejects.toThrow();
  });

  it('is unavailable when the worker cannot be created', async () => {
    const broken = new JsonWorkerClient(() => {
      throw new Error('no workers here');
    });
    await expect(broken.run({ op: 'validate', doc: '1', schema: '{}' })).rejects.toThrow(
      'no workers here',
    );
    expect(broken.available).toBe(false);
  });

  it('resolves pending requests with null when disposed', async () => {
    worker.auto = false;
    const pending = client.run({ op: 'validate', doc: '1', schema: '{}' });
    client.dispose();
    expect(await pending).toBeNull();
    expect(worker.terminated).toBe(true);
  });
});
