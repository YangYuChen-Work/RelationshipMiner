import { describe, expect, it } from "vitest";
import { businessRelationLabel, confidenceBand } from "./businessRelations";

describe("business relationship presentation", () => {
  it("prefers an explicit business label and never exposes unknown raw types", () => {
    expect(businessRelationLabel({
      display_label: "用于检验",
      relation_type: "llm_check",
    })).toBe("用于检验");
    expect(businessRelationLabel({
      display_label: undefined,
      relation_type: "",
    })).toBe("相关");
    expect(businessRelationLabel({
      display_label: undefined,
      relation_type: "unknown_internal_type",
    })).toBe("相关");
  });

  it.each([
    "owner_id关联",
    "processUses零件",
    "关联_code",
    "使",
    "一二三四五六七八九十甲乙丙",
  ])("rejects unsafe explicit legacy label %s", (displayLabel) => {
    expect(businessRelationLabel({
      display_label: displayLabel,
      relation_type: "unknown_internal_type",
    })).toBe("相关");
  });

  it("never treats an arbitrary unknown raw relation type as display text", () => {
    expect(businessRelationLabel({
      display_label: undefined,
      relation_type: "未知连接",
    })).toBe("相关");
    expect(businessRelationLabel({
      display_label: "owner_id关联",
      relation_type: "owns",
    })).toBe("拥有");
  });

  it("groups numeric confidence into business-readable bands", () => {
    expect(confidenceBand(0.92)).toBe("明确");
    expect(confidenceBand(0.71)).toBe("较可信");
    expect(confidenceBand(0.40)).toBe("可能有关");
  });
});
