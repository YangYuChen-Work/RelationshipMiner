import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AnalysisLauncher from "../AnalysisLauncher";
import { useAnalysisStore } from "../../store/analysis";

const selectedTable = {
  name: "users",
  columns: [
    {
      name: "id",
      type: "int",
      is_name: false,
      is_class_name: false,
      is_primary_key: true,
      is_foreign_key: false,
    },
  ],
  selectedFields: new Set(["id"]),
};

describe("AnalysisLauncher", () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      phase: "select",
      errorMessage: null,
      selectedTables: new Map([["users", selectedTable]]),
      pendingTables: new Set(),
    });
  });

  it("disables launch and explains when a selected table is still loading", () => {
    // This fails if an already-loaded table makes launch available while another selection is pending.
    useAnalysisStore.setState({ pendingTables: new Set(["orders"]) });

    render(<AnalysisLauncher />);

    expect(screen.getByRole("button", { name: "生成业务关系图" })).toBeDisabled();
    expect(screen.getByText(/正在加载所选表字段/)).toBeVisible();
  });
});
