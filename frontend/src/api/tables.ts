/** API 层 — 数据库表与字段查询。 */

export interface TableInfo {
  name: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  is_name: boolean;
  is_class_name: boolean;
  is_primary_key: boolean;
}

export interface TableBusinessSummary {
  table_name: string;
  semantic_name: string;
  row_count: number;
  name_samples: string[];
  status: "inferred" | "fallback";
}

export interface TableColumnsResponse {
  table_name: string;
  columns: ColumnInfo[];
}

const BASE = "/api";

async function apiErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const defaultMessage = `${fallback} (HTTP ${response.status})`;
  const contentType =
    response.headers?.get?.("content-type")?.toLowerCase() ?? "application/json";
  if (!contentType.includes("application/json")) {
    return defaultMessage;
  }

  try {
    const payload = await response.json();
    const detail = payload?.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
    if (detail && typeof detail === "object") {
      if (typeof detail.message === "string" && detail.message.trim()) {
        return detail.message;
      }
      if (typeof detail.detail === "string" && detail.detail.trim()) {
        return detail.detail;
      }
    }
  } catch {
    // Preserve the useful HTTP fallback for malformed JSON error bodies.
  }
  return defaultMessage;
}

export async function fetchTables(): Promise<TableInfo[]> {
  const res = await fetch(`${BASE}/tables`);
  if (!res.ok) {
    throw new Error(await apiErrorMessage(res, "获取表列表失败"));
  }
  return res.json();
}

export async function fetchTableSummaries(): Promise<TableBusinessSummary[]> {
  const res = await fetch(`${BASE}/table-summaries`);
  if (!res.ok) {
    throw new Error(await apiErrorMessage(res, "获取业务数据摘要失败"));
  }
  return res.json();
}

export async function fetchTableColumns(
  tableName: string
): Promise<TableColumnsResponse> {
  const res = await fetch(`${BASE}/tables/${tableName}/fields`);
  if (!res.ok) {
    throw new Error(await apiErrorMessage(res, "获取字段列表失败"));
  }
  return res.json();
}
