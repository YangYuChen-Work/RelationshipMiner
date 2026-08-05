import { beforeEach, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import NaturalLanguageSelectionPanel from "../NaturalLanguageSelectionPanel";
import { useAnalysisStore } from "../../store/analysis";

beforeEach(() => {
  useAnalysisStore.setState({
    naturalLanguage: {
      input: "",
      status: "idle",
      activeRequestId: null,
      reasonCode: null,
      guidance: null,
      suggestedQuestions: [],
    },
  });
});

it("disables an empty natural-language selection request", () => {
  render(<NaturalLanguageSelectionPanel />);
  expect(screen.getByRole("button", { name: "AI \u81ea\u52a8\u9009\u53d6" })).toBeDisabled();
});

it("shows safe unavailable guidance without changing selections", () => {
  const selectedTables = new Map();
  useAnalysisStore.setState({
    selectedTables,
    naturalLanguage: {
      input: "\u8ba2\u5355",
      status: "unavailable",
      activeRequestId: null,
      reasonCode: "MODEL_UNAVAILABLE",
      guidance: "\u5f53\u524d\u65e0\u6cd5\u5b8c\u6210\u81ea\u52a8\u9009\u53d6\uff0c\u5df2\u6709\u9009\u62e9\u672a\u53d1\u751f\u53d8\u5316\uff1b\u53ef\u7a0d\u540e\u91cd\u8bd5\u6216\u5207\u6362\u5230\u624b\u52a8\u9009\u53d6\u3002",
      suggestedQuestions: [],
    },
  });
  render(<NaturalLanguageSelectionPanel />);
  expect(screen.getByText("\u5f53\u524d\u65e0\u6cd5\u5b8c\u6210\u81ea\u52a8\u9009\u53d6\uff0c\u5df2\u6709\u9009\u62e9\u672a\u53d1\u751f\u53d8\u5316\uff1b\u53ef\u7a0d\u540e\u91cd\u8bd5\u6216\u5207\u6362\u5230\u624b\u52a8\u9009\u53d6\u3002")).toBeVisible();
  expect(useAnalysisStore.getState().selectedTables).toBe(selectedTables);
});
