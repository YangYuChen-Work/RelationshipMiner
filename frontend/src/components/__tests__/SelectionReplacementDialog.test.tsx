import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SelectionReplacementDialog from "../SelectionReplacementDialog";

const table = (fields: string[]) => ({ name: "orders", columns: [], selectedFields: new Set(fields) });

it("shows table and field differences and supports confirmation, cancellation, and undo", async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const onUndo = vi.fn();
  const current = new Map([["orders", table(["status"])]])
  const proposed = new Map([["refunds", { ...table(["amount"]), name: "refunds" }]])
  render(<SelectionReplacementDialog current={current} proposed={proposed} onConfirm={onConfirm} onCancel={onCancel} onUndo={onUndo} />);
  expect(screen.getByRole("dialog")).toHaveTextContent("orders");
  expect(screen.getByRole("dialog")).toHaveTextContent("refunds");
  await user.click(screen.getByRole("button", { name: "\u53d6\u6d88" }));
  await user.click(screen.getByRole("button", { name: "\u786e\u8ba4\u5e94\u7528" }));
  await user.click(screen.getByRole("button", { name: "\u64a4\u9500\u4e0a\u6b21\u66ff\u6362" }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(onUndo).toHaveBeenCalledOnce();
});
