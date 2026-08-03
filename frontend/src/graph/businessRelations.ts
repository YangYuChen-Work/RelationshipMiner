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
const GENERIC_LABELS = new Set([
  "",
  "相关",
  "关联",
  "关系",
  "business_relationship",
  "semantic_relationship",
  "relationship",
  "relation",
  "语义关联",
  "关联关系",
]);

function normalizedBusinessLabel(value: string | null | undefined): string | null {
  const candidate = value?.trim() ?? "";
  const normalized = candidate.toLocaleLowerCase();
  if (GENERIC_LABELS.has(normalized)) return null;
  const known = KNOWN_BUSINESS_LABELS[normalized];
  if (known) return known;
  const limited = Array.from(candidate).slice(0, 12).join("");
  return limited.length >= 2 && /[\u3400-\u9fff]/u.test(limited)
    ? limited
    : null;
}

export function businessRelationLabel(relation: RelationLabelInput): string {
  return normalizedBusinessLabel(relation.display_label) ??
    KNOWN_BUSINESS_LABELS[relation.relation_type.trim().toLocaleLowerCase()] ??
    normalizedBusinessLabel(relation.relation_type) ??
    "相关";
}

export function confidenceBand(value: number): "明确" | "较可信" | "可能有关" {
  if (Number.isFinite(value) && value >= 0.85) return "明确";
  if (Number.isFinite(value) && value >= 0.6) return "较可信";
  return "可能有关";
}
