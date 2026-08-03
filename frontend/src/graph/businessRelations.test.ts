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

  it("groups numeric confidence into business-readable bands", () => {
    expect(confidenceBand(0.92)).toBe("明确");
    expect(confidenceBand(0.71)).toBe("较可信");
    expect(confidenceBand(0.40)).toBe("可能有关");
  });
});
