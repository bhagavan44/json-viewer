/**
 * Monaco cancels its own pending work (e.g. a language-worker request) when an editor is
 * disposed, which can surface as an unhandled "Canceled" rejection that Angular then logs
 * as an error. These cancellations are expected, so they are dropped here. Every other
 * rejection is left alone.
 *
 * Call this before Angular starts: listeners on the window run in the order they were
 * added, so this one must come before Angular's global error listener.
 */
export function ignoreMonacoCancellations(target: Window = window): void {
  target.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    if (reason instanceof Error && reason.name === 'Canceled' && reason.message === 'Canceled') {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  });
}
