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
