import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ProgressIndicator from "../ProgressIndicator";
import { useAnalysisStore } from "../../store/analysis";

describe("ProgressIndicator", () => {
  beforeEach(() => useAnalysisStore.setState({ phase: "analyzing", currentPhase: "semantic_judging", progressMessage: "Judging candidates", progressValue: 0.76 }));
  it("renders string phase and analysis status instead of a numeric phase counter", () => {
    render(<ProgressIndicator />);
    expect(screen.getByText("语义判断")).toBeInTheDocument();
    expect(screen.getByText("状态：分析中")).toBeInTheDocument();
    expect(screen.queryByText(/阶段 .*\//)).not.toBeInTheDocument();
  });
});
