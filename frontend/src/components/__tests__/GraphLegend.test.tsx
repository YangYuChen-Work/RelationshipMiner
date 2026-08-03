import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import GraphLegend from "../GraphLegend";
import { tableColor } from "../../graph/scene";
import { useAnalysisStore } from "../../store/analysis";

describe("GraphLegend", () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      graph: {
        table_nodes: [
          { id: "assembly_process", display_name: "装配工艺（旧快照）", entity_count: 4 },
          { id: "inspection_standard", display_name: "检验标准（旧快照）", entity_count: 3 },
        ],
        entity_nodes: [],
        table_edges: [],
        entity_edges: [],
      },
      tableSummaries: new Map([
        ["assembly_process", {
          table_name: "assembly_process",
          semantic_name: "装配工艺数据",
          row_count: 4,
          name_samples: [],
          status: "inferred" as const,
        }],
        ["inspection_standard", {
          table_name: "inspection_standard",
          semantic_name: "检验标准数据",
          row_count: 3,
          name_samples: [],
          status: "inferred" as const,
        }],
      ]),
    });
  });

  it("labels solid source colors with semantic names and subdues raw table names", () => {
    render(<GraphLegend />);

    const legend = screen.getByRole("group", { name: "数据来源图例" });
    expect(legend).toHaveTextContent("装配工艺数据");
    expect(legend).toHaveTextContent("检验标准数据");
    expect(screen.getByText("来源：assembly_process")).toHaveClass("text-slate-500");
    expect(screen.getByText("来源：inspection_standard")).toHaveClass("text-slate-500");
    expect(screen.getByLabelText("装配工艺数据颜色")).toHaveStyle({
      backgroundColor: tableColor("assembly_process"),
    });
    expect(screen.getByLabelText("检验标准数据颜色")).toHaveStyle({
      backgroundColor: tableColor("inspection_standard"),
    });
  });

  it("falls back to the snapshot display name when no semantic summary exists", () => {
    useAnalysisStore.setState({ tableSummaries: new Map() });

    render(<GraphLegend />);

    expect(screen.getByText("装配工艺（旧快照）")).toBeInTheDocument();
    expect(screen.getByText("检验标准（旧快照）")).toBeInTheDocument();
  });
});
