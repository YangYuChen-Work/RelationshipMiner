import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ProgressIndicator from "../ProgressIndicator";
import { useAnalysisStore } from "../../store/analysis";

describe("ProgressIndicator", () => {
  beforeEach(() => useAnalysisStore.setState({ phase: "analyzing", currentPhase: "semantic_judging", progressMessage: "Judging candidates", progressValue: 0.76 }));
  it("renders string phase and analysis status instead of a numeric phase counter", () => {
    render(<ProgressIndicator />);
    expect(screen.getByText("正在判断对象关系")).toBeInTheDocument();
    expect(screen.getByText("正在生成业务关系图")).toBeInTheDocument();
    expect(screen.queryByText("语义判断")).not.toBeInTheDocument();
    expect(screen.queryByText(/阶段 .*\//)).not.toBeInTheDocument();
  });

  it("keeps an unknown pipeline phase out of the business-facing heading", () => {
    useAnalysisStore.setState({
      currentPhase: "candidate_retry_queue",
      progressMessage: "Retrying candidate queue",
    });

    render(<ProgressIndicator />);

    expect(screen.getByText("正在处理业务对象关系")).toBeInTheDocument();
    const technicalDetails = screen.getByText("技术详情").closest("details");
    expect(technicalDetails).not.toHaveAttribute("open");
    expect(technicalDetails).toHaveTextContent("candidate_retry_queue");
  });
});
