import { describe, expect, it } from "vitest";
import type { TableNodeData } from "../api/analysis";
import type { TableBusinessSummary } from "../api/tables";
import { buildBusinessTablePresentationIndex } from "./businessTables";

const rawTable: TableNodeData = {
  id: "satellite_assembly_records",
  display_name: "satellite_assembly_records",
  entity_count: 3,
};

describe("buildBusinessTablePresentationIndex", () => {
  it("overlays semantic summaries on production-shaped raw table nodes", () => {
    const summaries = new Map<string, TableBusinessSummary>([[
      rawTable.id,
      {
        table_name: rawTable.id,
        semantic_name: "卫星天线装配与检验数据",
        row_count: 3,
        name_samples: [],
        status: "inferred",
      },
    ]]);

    expect(buildBusinessTablePresentationIndex([rawTable], summaries).get(rawTable.id))
      .toBe("卫星天线装配与检验数据");
  });

  it("never falls back to a raw table identifier", () => {
    expect(buildBusinessTablePresentationIndex([rawTable], new Map()).get(rawTable.id))
      .toBe("业务数据集");
  });

  it("keeps an existing legacy semantic display name", () => {
    const legacy = { ...rawTable, display_name: "历史装配数据" };
    expect(buildBusinessTablePresentationIndex([legacy], new Map()).get(rawTable.id))
      .toBe("历史装配数据");
  });
});
