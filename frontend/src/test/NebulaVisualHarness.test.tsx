import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { mountReusableReactRoot } from "./mountReusableReactRoot";

describe("mountReusableReactRoot", () => {
  it("reuses the React root when the visual harness module is re-evaluated", () => {
    const container = document.createElement("div");
    const render = vi.fn<(node: ReactNode) => void>();
    const createHarnessRoot = vi.fn(() => ({ render }));

    mountReusableReactRoot(container, "first render", createHarnessRoot);
    mountReusableReactRoot(container, "second render", createHarnessRoot);

    expect(createHarnessRoot).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(2);
  });
});
