import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import SelectionModeToggle from "../SelectionModeToggle";

it("marks natural language as the selected tab and can change to manual", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<SelectionModeToggle mode="natural" onChange={onChange} />);

  expect(screen.getByRole("tab", { name: "\u81ea\u7136\u8bed\u8a00\u9009\u53d6" })).toHaveAttribute("aria-selected", "true");
  await user.click(screen.getByRole("tab", { name: "\u624b\u52a8\u9009\u53d6" }));
  expect(onChange).toHaveBeenCalledWith("manual");
});

it("moves the active tab with arrow, home, and end keys", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const { rerender } = render(<SelectionModeToggle mode="natural" onChange={onChange} />);
  const natural = screen.getByRole("tab", { name: "\u81ea\u7136\u8bed\u8a00\u9009\u53d6" });
  const manual = screen.getByRole("tab", { name: "\u624b\u52a8\u9009\u53d6" });

  natural.focus();
  await user.keyboard("{ArrowRight}");
  expect(onChange).toHaveBeenLastCalledWith("manual");
  expect(manual).toHaveFocus();

  rerender(<SelectionModeToggle mode="manual" onChange={onChange} />);
  await user.keyboard("{Home}");
  expect(onChange).toHaveBeenLastCalledWith("natural");
  await user.keyboard("{End}");
  expect(onChange).toHaveBeenLastCalledWith("manual");
});
