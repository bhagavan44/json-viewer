// Loads AppModule so the test build compiles each component with its NgModule scope.
import './app/app-module';

// Node 25+ has its own localStorage and sessionStorage globals, which hide jsdom's. Use jsdom's.
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
  }
}
