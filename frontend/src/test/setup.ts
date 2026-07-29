import "@testing-library/jest-dom/vitest";

// jsdom polyfills
if (typeof ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom intentionally omits Canvas 2D. Component and integration tests that
// exercise drawing replace this with a recording context; status-only renders
// can safely observe an unavailable context without noisy environment errors.
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  writable: true,
  value: () => null,
});
