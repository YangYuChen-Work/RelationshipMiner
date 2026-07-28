import { useEffect, useState } from "react";
import { isRequiredColumn, useAnalysisStore } from "../store/analysis";

interface DatabaseTableAccordionProps {
  tableName: string;
  disabled: boolean;
}

export default function DatabaseTableAccordion({
  tableName,
  disabled,
}: DatabaseTableAccordionProps) {
  const selectedTables = useAnalysisStore((s) => s.selectedTables);
  const tableErrors = useAnalysisStore((s) => s.tableErrors);
  const toggleTable = useAnalysisStore((s) => s.toggleTable);
  const toggleField = useAnalysisStore((s) => s.toggleField);
  const selectAllFields = useAnalysisStore((s) => s.selectAllFields);
  const deselectAllFields = useAnalysisStore((s) => s.deselectAllFields);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const entry = selectedTables.get(tableName);
  const isSelected = Boolean(entry);
  const error = tableErrors.get(tableName);

  useEffect(() => {
    if (!isSelected) setExpanded(false);
  }, [isSelected]);

  async function handleTableToggle() {
    if (loading) return;
    if (!isSelected) setLoading(true);
    await toggleTable(tableName);
    setLoading(false);
    if (useAnalysisStore.getState().selectedTables.has(tableName)) {
      setExpanded(true);
    }
  }

  const selectedCount = entry?.selectedFields.size ?? 0;
  const totalFields = entry?.columns.length ?? 0;
  const allSelected = totalFields > 0 && selectedCount === totalFields;

  return (
    <article
      className={`overflow-hidden rounded-xl border transition-colors ${
        isSelected ? "border-blue-300 bg-blue-50/40" : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            aria-label={`选择表 ${tableName}`}
            checked={isSelected}
            disabled={disabled || loading}
            onChange={handleTableToggle}
            className="h-4 w-4 rounded text-blue-600"
          />
          <span className="truncate font-medium text-gray-900">{tableName}</span>
          {isSelected && (
            <span className="text-xs text-gray-500">
              {selectedCount}/{totalFields} 字段
            </span>
          )}
        </label>

        {isSelected && (
          <button
            type="button"
            aria-label={
              allSelected ? `取消全选 ${tableName} 字段` : `全选 ${tableName} 字段`
            }
            onClick={() =>
              allSelected ? deselectAllFields(tableName) : selectAllFields(tableName)
            }
            className="text-xs font-medium text-blue-700 hover:underline"
          >
            {allSelected ? "取消全选" : "全选"}
          </button>
        )}

        <button
          type="button"
          aria-label={`${expanded ? "收起" : "展开"} ${tableName} 字段`}
          aria-expanded={expanded}
          disabled={!isSelected}
          onClick={() => setExpanded((current) => !current)}
          className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true">⌄</span>
        </button>
      </div>

      {error && !isSelected && (
        <div className="flex items-center justify-between gap-3 border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            aria-label={`重试 ${tableName} 字段加载`}
            onClick={handleTableToggle}
            disabled={loading}
            className="shrink-0 font-medium underline"
          >
            重试
          </button>
        </div>
      )}

      {isSelected && expanded && entry && (
        <div
          role="region"
          aria-label={`${tableName} 字段列表`}
          className="divide-y divide-gray-100 border-t border-gray-200 bg-white"
        >
          {entry.columns.map((column) => {
            const required = isRequiredColumn(column);
            return (
              <label
                key={column.name}
                className={`flex items-center gap-3 px-4 py-2.5 ${
                  required ? "bg-violet-50/50" : "cursor-pointer hover:bg-gray-50"
                }`}
              >
                <input
                  type="checkbox"
                  aria-label={`字段 ${column.name}`}
                  checked={entry.selectedFields.has(column.name)}
                  disabled={required}
                  onChange={() => toggleField(tableName, column.name)}
                  className="h-4 w-4 rounded text-blue-600"
                />
                <span className="flex-1 text-sm text-gray-800">{column.name}</span>
                <span className="font-mono text-xs text-gray-400">{column.type}</span>
                {column.is_primary_key && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                    主键
                  </span>
                )}
                {column.is_class_name && (
                  <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-800">
                    类名
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
    </article>
  );
}
