import type { TableNodeData } from "../api/analysis";
import type { TableBusinessSummary } from "../api/tables";

const GENERIC_DATASET_NAME = "业务数据集";
const TECHNICAL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.:$-]*$/u;

function semanticText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function legacySemanticName(table: TableNodeData): string | null {
  const displayName = semanticText(table.display_name);
  if (!displayName || displayName === table.id || TECHNICAL_IDENTIFIER.test(displayName)) {
    return null;
  }
  return displayName;
}

export function buildBusinessTablePresentationIndex(
  tables: readonly TableNodeData[],
  summaries: ReadonlyMap<string, TableBusinessSummary>,
): Map<string, string> {
  const unresolved = tables
    .filter((table) =>
      !semanticText(summaries.get(table.id)?.semantic_name) &&
      !legacySemanticName(table)
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const fallbackNames = new Map(unresolved.map((table, index) => [
    table.id,
    unresolved.length === 1
      ? GENERIC_DATASET_NAME
      : `${GENERIC_DATASET_NAME} ${index + 1}`,
  ]));

  return new Map(tables.map((table) => [
    table.id,
    semanticText(summaries.get(table.id)?.semantic_name) ??
      legacySemanticName(table) ??
      fallbackNames.get(table.id) ??
      GENERIC_DATASET_NAME,
  ]));
}
