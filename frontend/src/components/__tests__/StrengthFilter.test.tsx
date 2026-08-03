import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import StrengthFilter from "../StrengthFilter";
import { useAnalysisStore } from "../../store/analysis";

describe("StrengthFilter", () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      confidenceThreshold: 0,
    });
  });

  it("renders the slider with initial value 0.00", () => {
    render(<StrengthFilter />);
    const slider = screen.getByLabelText("关系可信程度");
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveValue("0");

    const output = screen.getByText("0.00");
    expect(output).toBeInTheDocument();
  });

  it("renders weak/strong relationship labels", () => {
    render(<StrengthFilter />);
    expect(screen.getByText("弱关系")).toBeInTheDocument();
    expect(screen.getByText("强关系")).toBeInTheDocument();
  });

  it("updates store value when slider changes", () => {
    render(<StrengthFilter />);
    const slider = screen.getByLabelText("关系可信程度");

    fireEvent.change(slider, { target: { value: "0.75" } });

    expect(useAnalysisStore.getState().confidenceThreshold).toBe(0.75);
  });

  it("displays current threshold from store", () => {
    useAnalysisStore.setState({ confidenceThreshold: 0.42 });

    render(<StrengthFilter />);
    expect(screen.getByText("0.42")).toBeInTheDocument();
  });

  it("handles boundary value 1.00", () => {
    render(<StrengthFilter />);
    const slider = screen.getByLabelText("关系可信程度");

    fireEvent.change(slider, { target: { value: "1" } });

    expect(useAnalysisStore.getState().confidenceThreshold).toBe(1);
    expect(screen.getByText("1.00")).toBeInTheDocument();
  });

  it("has correct range attributes", () => {
    render(<StrengthFilter />);
    const slider = screen.getByLabelText("关系可信程度");

    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "1");
    expect(slider).toHaveAttribute("step", "0.01");
  });
});
