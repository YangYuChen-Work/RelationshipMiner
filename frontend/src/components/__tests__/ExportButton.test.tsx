import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import ExportButton from "../ExportButton";
import { useAnalysisStore } from "../../store/analysis";

describe("ExportButton", () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      taskId: null,
      graph: null,
    });
    vi.restoreAllMocks();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("renders disabled button when no taskId", () => {
    render(<ExportButton />);
    const btn = screen.getByText("导出 JSON");
    expect(btn).toBeDisabled();
  });

  it("renders enabled button when taskId is set", () => {
    useAnalysisStore.setState({ taskId: "task-123" });

    render(<ExportButton />);
    const btn = screen.getByText("导出 JSON");
    expect(btn).not.toBeDisabled();
  });

  it("calls export API on click", async () => {
    useAnalysisStore.setState({ taskId: "task-123" });

    const mockBlob = new Blob(['{"test": true}'], { type: "application/json" });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    } as Response);

    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test");
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL");

    render(<ExportButton />);
    const btn = screen.getByText("导出 JSON");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/export/task-123");
    });

    expect(createObjectURLSpy).toHaveBeenCalledWith(mockBlob);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:test");
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it("shows error message when export fails", async () => {
    useAnalysisStore.setState({ taskId: "task-123" });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ detail: "导出服务暂不可用" }),
    } as Response);

    render(<ExportButton />);
    const btn = screen.getByText("导出 JSON");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText("导出服务暂不可用")).toBeInTheDocument();
    });
  });

  it("shows loading state during export", async () => {
    useAnalysisStore.setState({ taskId: "task-123" });

    let resolvePromise!: (value: Response) => void;
    const promise = new Promise<Response>((resolve) => {
      resolvePromise = resolve;
    });

    vi.spyOn(globalThis, "fetch").mockReturnValueOnce(promise);

    render(<ExportButton />);
    const btn = screen.getByText("导出 JSON");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText("导出中...")).toBeInTheDocument();
    });

    await act(async () => {
      resolvePromise({
        ok: true,
        blob: () => Promise.resolve(new Blob(["{}"])),
      } as Response);
    });
  });
});
