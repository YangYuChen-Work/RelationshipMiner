import type { EntityNodeData } from "../api/analysis";

const UNNAMED_OBJECT = "未命名对象";
const NON_MEANINGFUL_LITERALS = new Set([
  "0",
  "1",
  "true",
  "false",
  "null",
  "undefined",
  "nan",
  "infinity",
  "+infinity",
  "-infinity",
]);
const STATUS_ONLY_TOKENS = new Set([
  "status",
  "state",
  "active",
  "inactive",
  "enabled",
  "disabled",
  "pending",
  "processing",
  "processed",
  "approved",
  "rejected",
  "accepted",
  "declined",
  "queued",
  "running",
  "paused",
  "stopped",
  "started",
  "finished",
  "complete",
  "completed",
  "failed",
  "failure",
  "success",
  "successful",
  "error",
  "ready",
  "draft",
  "deleted",
  "archived",
  "open",
  "closed",
  "cancelled",
  "canceled",
  "new",
  "unknown",
  "valid",
  "invalid",
  "review",
  "reviewing",
  "reviewed",
  "approval",
  "awaiting",
  "scheduled",
  "published",
  "unpublished",
  "locked",
  "unlocked",
  "verified",
  "unverified",
  "passed",
  "pass",
  "in",
  "progress",
  "not",
  "done",
  "todo",
  "hold",
  "on",
  "off",
  "状态",
  "启用",
  "禁用",
  "正常",
  "异常",
  "完成",
  "已完成",
  "失败",
  "待处理",
  "处理中",
  "已处理",
  "批准",
  "已批准",
  "拒绝",
  "已拒绝",
  "接受",
  "已接受",
  "待审核",
  "审核中",
  "已审核",
  "待审批",
  "审批中",
  "已审批",
  "草稿",
  "已删除",
  "已归档",
  "开放",
  "关闭",
  "已取消",
  "排队中",
  "运行中",
  "已停止",
  "暂停",
  "新建",
  "未知",
  "有效",
  "无效",
  "已发布",
  "未发布",
  "已锁定",
  "未锁定",
  "已验证",
  "未验证",
  "通过",
  "未通过",
]);

export interface BusinessEntityPresentation {
  primary: string;
  secondary: string;
  accessibleLabel: string;
  searchText: string;
  isDuplicate: boolean;
}

function isStatusOnlyText(normalized: string): boolean {
  const tokens = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  let hasStatusToken = false;
  const containsOnlyStatusParts = tokens.every((token) => {
    if (STATUS_ONLY_TOKENS.has(token)) {
      hasStatusToken = true;
      return true;
    }
    return /^\d+$/u.test(token);
  });
  return hasStatusToken && containsOnlyStatusParts;
}

function normalizedText(value: unknown): string | null {
  const text = typeof value === "string"
    ? value.trim()
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "";
  if (!text) return null;
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  return NON_MEANINGFUL_LITERALS.has(normalized) || isStatusOnlyText(normalized)
    ? null
    : text;
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
