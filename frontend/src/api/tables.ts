/** API 层 — 数据库表与字段查询。 */

export interface TableInfo {
  name: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  is_class_name: boolean;
}

export interface TableColumnsResponse {
  table_name: string;
  columns: ColumnInfo[];
}

const BASE = "/api";

export async function fetchTables(): Promise<TableInfo[]> {
  const res = await fetch(`${BASE}/tables`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail?.detail || "获取表列表失败");
  }
  return res.json();
}

export async function fetchTableColumns(
  tableName: string
): Promise<TableColumnsResponse> {
  const res = await fetch(`${BASE}/tables/${tableName}/fields`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail?.detail || "获取字段列表失败");
  }
  return res.json();
}
