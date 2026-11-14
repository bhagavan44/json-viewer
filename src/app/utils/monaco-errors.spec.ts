import { ignoreMonacoCancellations } from './monaco-errors';

describe('ignoreMonacoCancellations', () => {
  const rejection = (reason: unknown) => {
    const event = new Event('unhandledrejection', { cancelable: true }) as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: reason });
    return event;
  };

  it('drops Monaco cancellations before later listeners see them, and nothing else', () => {
    const target = new EventTarget() as Window;
    ignoreMonacoCancellations(target);
    const seen: string[] = [];
    target.addEventListener('unhandledrejection', (e) => seen.push(String((e as PromiseRejectionEvent).reason.message)));

    const canceled = Object.assign(new Error('Canceled'), { name: 'Canceled' });
    const cancelEvent = rejection(canceled);
    target.dispatchEvent(cancelEvent);
    target.dispatchEvent(rejection(new Error('Real bug')));
    target.dispatchEvent(rejection(new Error('Canceled'))); // an ordinary error that happens to say "Canceled"

    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(seen).toEqual(['Real bug', 'Canceled']);
  });
});
