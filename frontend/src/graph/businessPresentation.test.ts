import { describe, expect, it } from "vitest";
import type { EntityNodeData } from "../api/analysis";
import {
  buildBusinessPresentationIndex,
  businessName,
} from "./businessPresentation";

function entity(
  id: string,
  displayName: string,
  displayCode: string | null = null,
  dimensions: Record<string, unknown> = {},
  displayNameSource?: "name",
): EntityNodeData {
  return {
    id,
    table_id: "technical_table",
    display_name: displayName,
    display_code: displayCode,
    display_name_source: displayNameSource,
    class_name: "com.example.TechnicalClass",
    dimensions,
  };
}

describe("businessName", () => {
  it("uses legacy dimensions.name before a meaningful existing display name", () => {
    expect(businessName(entity("internal:42", "Old display", null, {
      name: "  通信天线装配  ",
    }))).toBe("通信天线装配");
  });

  it.each([
    ["blank", "", {}],
    ["zero", "0", {}],
    ["one", "1", {}],
    ["boolean text", "true", {}],
    ["boolean value", "Old display", { name: true }],
    ["status text", "active", { status: "active" }],
    ["status-only", "0", { status: "active" }],
  ])("uses the unnamed fallback for non-meaningful %s snapshots", (_case, displayName, dimensions) => {
    const legacy = entity("internal:42", displayName, null, dimensions);
    if (_case === "boolean value") legacy.display_name = "false";

    expect(businessName(legacy)).toBe("未命名对象");
  });

  it("never promotes class, table, ID, or arbitrary auxiliary values to primary", () => {
    const technical = entity("technical_table:42", "0", null, {
      item_code: "AUX-001",
      status: "ready",
    });

    const primary = businessName(technical);
    expect(primary).toBe("未命名对象");
    expect(primary).not.toContain("TechnicalClass");
    expect(primary).not.toContain("technical_table");
    expect(primary).not.toContain("42");
    expect(primary).not.toContain("AUX-001");
  });

  it.each([
    ["array", ["Array Name"]],
    ["object", { label: "Object Name" }],
    ["boolean", true],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
  ])("falls through invalid %s dimensions.name values", (_case, name) => {
    expect(businessName(entity("legacy", "Valid fallback name", null, {
      name,
    }))).toBe("Valid fallback name");
  });

  it.each([
    "processing",
    "approved",
    "rejected",
    "pending_review",
    "status: approved",
    "处理中",
    "已批准",
    "已拒绝",
  ])("rejects the common status-only name %s", (statusName) => {
    expect(businessName(entity("legacy", statusName))).toBe("未命名对象");
  });

  it.each([
    "Processing Station",
    "Approved Supplier Assembly",
    "张三",
  ])("keeps the valid human business name %s", (name) => {
    expect(businessName(entity("legacy", "Fallback", null, { name }))).toBe(name);
  });

  it.each([
    "状态已批准",
    "已通过",
    "状态处理中",
    "未通过",
    "当前状态已拒绝",
  ])("rejects the unseparated Chinese status-only name %s", (statusName) => {
    expect(businessName(entity("legacy", statusName))).toBe("未命名对象");
  });

  it.each([
    "已通过检验的通信天线",
    "未通过滤波器",
    "状态处理中继设备",
    "当前状态已拒绝原因分析",
  ])("keeps a business name containing the status-like substring %s", (name) => {
    expect(businessName(entity("legacy", "Fallback", null, { name }))).toBe(name);
  });

  it.each([
    ["正常", "正常"],
    ["已完成", "已完成"],
    ["numeric zero", 0],
    ["numeric one", 1],
  ])("keeps the explicit legacy dimensions.name %s", (_case, name) => {
    expect(businessName(entity("legacy", "legacy inferred status", null, {
      name,
    }))).toBe(String(name));
  });

  it.each(["正常", "已完成", "0", "1"])(
    "keeps the current backend name %s when its source is explicit",
    (name) => {
      expect(businessName(entity("current", name, null, {}, "name"))).toBe(name);
    },
  );
});

describe("buildBusinessPresentationIndex", () => {
  it("shows a business code only for duplicate names", () => {
    const index = buildBusinessPresentationIndex([
      entity("a", "通信天线装配", "GY0000203"),
      entity("b", "通信天线装配", "GY0000204"),
      entity("c", "电性能测试", "TEST-001"),
    ], new Map([["a", 2], ["b", 1], ["c", 0]]));

    expect(index.get("a")).toMatchObject({
      primary: "通信天线装配",
      secondary: "GY0000203",
      accessibleLabel: "通信天线装配；GY0000203；2 个关系",
      searchText: "通信天线装配 gy0000203",
      isDuplicate: true,
    });
    expect(index.get("c")).toMatchObject({
      primary: "电性能测试",
      secondary: "",
      accessibleLabel: "电性能测试；0 个关系",
      searchText: "电性能测试",
      isDuplicate: false,
    });
  });

  it("normalizes duplicate comparison with NFKC, whitespace, and locale case folding", () => {
    const index = buildBusinessPresentationIndex([
      entity("a", "ＡＢＣ   Assembly", "CODE-A"),
      entity("b", " abc assembly ", "CODE-B"),
    ], new Map());

    expect(index.get("a")?.isDuplicate).toBe(true);
    expect(index.get("b")?.isDuplicate).toBe(true);
  });

  it("assigns no-code ordinals by stable entity ID across input ordering", () => {
    const entities = [
      entity("z", "同一工序"),
      entity("a", "同一工序"),
    ];

    const first = buildBusinessPresentationIndex(entities, new Map());
    const reordered = buildBusinessPresentationIndex([...entities].reverse(), new Map());

    expect(first.get("a")?.secondary).toBe("同名 1");
    expect(first.get("z")?.secondary).toBe("同名 2");
    expect(reordered.get("a")?.secondary).toBe("同名 1");
    expect(reordered.get("z")?.secondary).toBe("同名 2");
  });

  it("keeps complete-snapshot duplicate labels stable when a filtered subset is consumed", () => {
    const completeSnapshot = [
      entity("visible", "重复对象"),
      entity("filtered", "重复对象"),
      entity("unique", "唯一对象"),
    ];
    const presentations = buildBusinessPresentationIndex(
      completeSnapshot,
      new Map([["visible", 1], ["filtered", 0], ["unique", 1]]),
    );
    const visibleIds = new Set(["visible", "unique"]);
    const visiblePresentations = [...presentations]
      .filter(([id]) => visibleIds.has(id));

    expect(Object.fromEntries(visiblePresentations)).toMatchObject({
      visible: { isDuplicate: true, secondary: "同名 2" },
      unique: { isDuplicate: false, secondary: "" },
    });
  });
});
