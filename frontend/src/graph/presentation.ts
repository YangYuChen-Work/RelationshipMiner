import type { EntityNodeData } from "../api/analysis";

const FIELD_TIERS: readonly [RegExp, number][] = [
  [/(^|_)(name|title|label)($|_)/i, 100],
  [/(^|_)(code|number|no|serial|model)($|_)/i, 90],
  [/(^|_)(id|identifier)($|_)/i, 80],
];

const MAX_VISIBLE_CODE_POINTS = 42;

export interface EntityPresentation {
  primary: string;
  secondary: string;
  accessibleLabel: string;
}

interface LabelCandidate {
  normalizedField: string;
  text: string;
  tier: number;
}

function usefulText(value: unknown): string | null {
  if (value == null || typeof value === "boolean") return null;
  const text = String(value).trim();
  if (!text || /^(0|1|null|undefined|true|false)$/i.test(text)) return null;
  return text;
}

function fieldTier(field: string): number {
  return FIELD_TIERS.find(([pattern]) => pattern.test(field))?.[1] ?? 0;
}

function safelyDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function idSuffix(id: string): string {
  const separator = id.lastIndexOf(":");
  return safelyDecode(separator === -1 ? id : id.slice(separator + 1));
}

function shortClassName(className: string | null): string | null {
  if (!className) return null;
  const segments = className.split(/[.$/\\]/).filter(Boolean);
  return segments.at(-1) ?? null;
}

function visibleText(text: string): string {
  return Array.from(text).slice(0, MAX_VISIBLE_CODE_POINTS).join("");
}

function labelCandidates(entity: EntityNodeData): LabelCandidate[] {
  const fields: [string, unknown][] = [
    ["display_name", entity.display_name],
    ...Object.entries(entity.dimensions),
  ];

  return fields.flatMap(([field, value]) => {
    const text = usefulText(value);
    if (text == null) return [];
    const normalizedField = field.trim().toLowerCase();
    return [{ normalizedField, text, tier: fieldTier(normalizedField) }];
  });
}

function selectPrimary(entity: EntityNodeData): string {
  const candidate = labelCandidates(entity).sort((left, right) =>
    right.tier - left.tier ||
    (left.normalizedField < right.normalizedField ? -1 : left.normalizedField > right.normalizedField ? 1 : 0) ||
    (left.text < right.text ? -1 : left.text > right.text ? 1 : 0)
  )[0];
  return candidate?.text ?? idSuffix(entity.id);
}

function selectSecondary(
  entity: EntityNodeData,
  primary: string,
  visibleDegree: number,
): string {
  const typeSources = [
    shortClassName(entity.class_name),
    usefulText(entity.table_id),
    `${visibleDegree} 个关系`,
  ];
  return typeSources.find((source) => source != null && source !== primary) ?? "";
}

export function presentEntity(
  entity: EntityNodeData,
  visibleDegree: number,
): EntityPresentation {
  const fullPrimary = selectPrimary(entity);
  const fullSecondary = selectSecondary(entity, fullPrimary, visibleDegree);
  const accessibleLabel = fullSecondary
    ? `${fullPrimary}; ${fullSecondary}`
    : fullPrimary;

  return {
    primary: visibleText(fullPrimary),
    secondary: visibleText(fullSecondary),
    accessibleLabel,
  };
}
