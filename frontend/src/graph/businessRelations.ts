import type { EntityRelationData } from "../api/analysis";

type RelationLabelInput = Pick<EntityRelationData, "relation_type"> &
  Partial<Pick<EntityRelationData, "display_label">>;

const KNOWN_BUSINESS_LABELS: Readonly<Record<string, string>> = {
  assembly_containment: "包含",
  containment: "包含",
  contains: "包含",
  "包含工序": "包含",
  "包含工步": "包含",
  foreign_key: "引用",
  "外键关联": "引用",
  unique_identifier: "对应",
  relation_table: "连接",
  "关联物料": "使用物料",
  "结构关联": "结构关联",
  uses: "使用",
  used_by: "被使用",
  owns: "拥有",
  places: "下单",
  created: "创建",
  reviews: "审核",
  "人员行为": "关联行为",
  "工艺涉及零件": "工艺涉及零件",
};
function safeExplicitBusinessLabel(value: string | null | undefined): string | null {
  const candidate = value?.trim() ?? "";
  const codePoints = Array.from(candidate);
  return codePoints.length >= 2 &&
    codePoints.length <= 12 &&
    codePoints.every((character) => /[\u3400-\u9fff]/u.test(character))
    ? candidate
    : null;
}

export function businessRelationLabel(relation: RelationLabelInput): string {
  return safeExplicitBusinessLabel(relation.display_label) ??
    KNOWN_BUSINESS_LABELS[relation.relation_type.trim().toLocaleLowerCase()] ??
    "相关";
}

export function confidenceBand(value: number): "明确" | "较可信" | "可能有关" {
  if (Number.isFinite(value) && value >= 0.85) return "明确";
  if (Number.isFinite(value) && value >= 0.6) return "较可信";
  return "可能有关";
}
