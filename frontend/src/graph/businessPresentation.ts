import type { EntityNodeData } from "../api/analysis";

const UNNAMED_OBJECT = "未命名对象";
const NON_MEANINGFUL_TEXT = new Set([
  "0",
  "1",
  "true",
  "false",
  "null",
  "undefined",
  "active",
  "inactive",
  "enabled",
  "disabled",
  "pending",
  "complete",
  "completed",
  "failed",
  "success",
  "error",
  "ready",
  "draft",
  "deleted",
  "archived",
  "open",
  "closed",
  "启用",
  "禁用",
  "正常",
  "异常",
  "完成",
  "失败",
  "待处理",
]);

export interface BusinessEntityPresentation {
  primary: string;
  secondary: string;
  accessibleLabel: string;
  searchText: string;
  isDuplicate: boolean;
}

function normalizedText(value: unknown): string | null {
  if (value == null || typeof value === "boolean") return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  return NON_MEANINGFUL_TEXT.has(normalized) ? null : text;
}

function normalizedBusinessName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase();
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function displayCode(entity: EntityNodeData): string | null {
  return typeof entity.display_code === "string" && entity.display_code.trim()
    ? entity.display_code.trim()
    : null;
}

export function businessName(entity: EntityNodeData): string {
  return normalizedText(entity.dimensions.name) ??
    normalizedText(entity.display_name) ??
    UNNAMED_OBJECT;
}

export function buildBusinessPresentationIndex(
  entities: readonly EntityNodeData[],
  degrees: ReadonlyMap<string, number>,
): Map<string, BusinessEntityPresentation> {
  const names = new Map<string, string>();
  const duplicateGroups = new Map<string, EntityNodeData[]>();

  for (const entity of entities) {
    const name = businessName(entity);
    names.set(entity.id, name);
    const normalizedName = normalizedBusinessName(name);
    const group = duplicateGroups.get(normalizedName);
    if (group) group.push(entity);
    else duplicateGroups.set(normalizedName, [entity]);
  }

  const secondaries = new Map<string, string>();
  const duplicateIds = new Set<string>();
  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue;
    const sortedGroup = [...group].sort((left, right) =>
      compareCodeUnits(left.id, right.id)
    );
    sortedGroup.forEach((entity, index) => {
      duplicateIds.add(entity.id);
      secondaries.set(entity.id, displayCode(entity) ?? `同名 ${index + 1}`);
    });
  }

  return new Map(entities.map((entity) => {
    const primary = names.get(entity.id) ?? UNNAMED_OBJECT;
    const secondary = secondaries.get(entity.id) ?? "";
    const degree = degrees.get(entity.id) ?? 0;
    const accessibleLabel = [primary, secondary, `${degree} 个关系`]
      .filter(Boolean)
      .join("；");
    const searchText = normalizedBusinessName(
      [primary, secondary].filter(Boolean).join(" "),
    );
    return [entity.id, {
      primary,
      secondary,
      accessibleLabel,
      searchText,
      isDuplicate: duplicateIds.has(entity.id),
    }] as const;
  }));
}
