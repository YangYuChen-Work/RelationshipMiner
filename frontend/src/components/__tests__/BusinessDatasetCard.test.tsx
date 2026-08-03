import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BusinessDatasetCard from "../BusinessDatasetCard";
import { useAnalysisStore } from "../../store/analysis";

const columns = [
  {
    name: "id",
    type: "INTEGER",
    is_name: false,
    is_class_name: false,
    is_primary_key: true,
  },
  {
    name: "name",
    type: "VARCHAR",
    is_name: true,
    is_class_name: false,
    is_primary_key: false,
  },
  {
    name: "class_name",
    type: "VARCHAR",
    is_name: false,
    is_class_name: true,
    is_primary_key: false,
  },
  {
    name: "work_center",
    type: "TEXT",
    is_name: false,
    is_class_name: false,
    is_primary_key: false,
  },
];

const summary = {
  table_name: "assembly_process",
  semantic_name: "装配工艺数据",
  row_count: 128,
  name_samples: ["通信卫星总装", "高增益天线装配"],
  status: "inferred" as const,
};

describe("BusinessDatasetCard", () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      phase: "select",
      errorMessage: null,
      selectedTables: new Map([
        [
          "assembly_process",
          {
            name: "assembly_process",
            columns,
            selectedFields: new Set(),
          },
        ],
      ]),
      pendingTables: new Set(),
      tableErrors: new Map(),
    });
  });

  it("presents business context and keeps database metadata behind technical information", async () => {
    const user = userEvent.setup();
    render(
      <BusinessDatasetCard
        tableName="assembly_process"
        summary={summary}
        disabled={false}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "装配工艺数据" }),
    ).toBeVisible();
    expect(screen.getByText("assembly_process")).toBeVisible();
    expect(screen.getByText("128 个对象")).toBeVisible();
    expect(screen.getByText("通信卫星总装")).toBeVisible();
    expect(screen.getByText("高增益天线装配")).toBeVisible();
    expect(screen.getByText("辅助判断依据")).toBeVisible();
    expect(
      screen.getByText("系统将使用名称和对象类型判断关系。"),
    ).toBeVisible();

    expect(
      screen.queryByRole("checkbox", { name: "字段 class_name" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "字段 work_center" })).toBeVisible();

    for (const type of screen.getAllByText(/^(INTEGER|VARCHAR|TEXT)$/)) {
      expect(type).not.toBeVisible();
    }

    await user.click(screen.getByText("技术信息"));

    for (const type of screen.getAllByText(/^(INTEGER|VARCHAR|TEXT)$/)) {
      expect(type).toBeVisible();
    }
  });
});
