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
    is_foreign_key: false,
  },
  {
    name: "name",
    type: "VARCHAR",
    is_name: true,
    is_class_name: false,
    is_primary_key: false,
    is_foreign_key: false,
  },
  {
    name: "class_name",
    type: "VARCHAR",
    is_name: false,
    is_class_name: true,
    is_primary_key: false,
    is_foreign_key: false,
  },
  {
    name: "work_center",
    type: "TEXT",
    is_name: false,
    is_class_name: false,
    is_primary_key: false,
    is_foreign_key: true,
  },
  {
    name: "description",
    type: "TEXT",
    is_name: false,
    is_class_name: false,
    is_primary_key: false,
    is_foreign_key: false,
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
    expect(
      screen.queryByRole("checkbox", { name: "字段 work_center" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "字段 description" })).toBeVisible();

    const primaryContext = screen.getByRole("region", {
      name: "assembly_process 主要判断信息",
    });
    expect(primaryContext).toHaveTextContent("节点名称（自动使用）");
    expect(primaryContext).toHaveTextContent("对象类型由系统自动识别");
    expect(primaryContext).not.toHaveTextContent("class_name");
    expect(primaryContext).not.toHaveTextContent("名称 · name");

    for (const type of screen.getAllByText(/^(INTEGER|VARCHAR|TEXT)$/)) {
      expect(type).not.toBeVisible();
    }
    expect(screen.getByText("主键")).not.toBeVisible();
    expect(screen.getByText("外键")).not.toBeVisible();

    await user.click(screen.getByText("技术信息"));

    for (const type of screen.getAllByText(/^(INTEGER|VARCHAR|TEXT)$/)) {
      expect(type).toBeVisible();
    }
    expect(screen.getByText("主键")).toBeVisible();
    expect(screen.getByText("外键")).toBeVisible();
    expect(screen.getByText("主键").closest("details")).not.toBeNull();
    expect(screen.getByText("外键").closest("details")).not.toBeNull();
  });

  it("puts the semantic dataset name first in the checkbox accessible name", () => {
    render(
      <BusinessDatasetCard
        tableName="assembly_process"
        summary={summary}
        disabled={false}
      />,
    );

    expect(screen.getByRole("checkbox", {
      name: "选择业务数据 装配工艺数据（来源 assembly_process）",
    })).toBeVisible();
  });

  it("collapses and restores the complete field details without changing the table selection", async () => {
    const user = userEvent.setup();
    render(
      <BusinessDatasetCard
        tableName="assembly_process"
        summary={summary}
        disabled={false}
      />,
    );

    expect(screen.getByRole("button", { name: "收缩字段" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "字段 description" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "收缩字段" }));

    expect(screen.getByRole("button", { name: "展开字段" })).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: "字段 description" })).not.toBeInTheDocument();
    expect(screen.queryByText("主要判断信息")).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: "选择业务数据 装配工艺数据（来源 assembly_process）",
      }),
    ).toBeChecked();

    await user.click(screen.getByRole("button", { name: "展开字段" }));

    expect(screen.getByRole("checkbox", { name: "字段 description" })).toBeVisible();
    expect(screen.getByText("主要判断信息")).toBeVisible();
  });
});
