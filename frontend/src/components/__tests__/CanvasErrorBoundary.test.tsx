import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import CanvasErrorBoundary from "../CanvasErrorBoundary";

it("clears its error and retries the canvas subtree", () => {
  let shouldThrow = true;
  const reset = vi.fn(() => {
    shouldThrow = false;
  });
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  function FragileCanvas() {
    if (shouldThrow) throw new Error("draw failed");
    return <canvas aria-label="recovered graph" />;
  }

  render(
    <CanvasErrorBoundary onReset={reset}>
      <FragileCanvas />
    </CanvasErrorBoundary>,
  );
  expect(screen.getByRole("alert")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "重试画布" }));

  expect(reset).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("recovered graph")).toBeInTheDocument();
  consoleError.mockRestore();
});
