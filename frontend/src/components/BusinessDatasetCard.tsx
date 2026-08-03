import type { TableBusinessSummary } from "../api/tables";
import { isAuxiliaryColumn, useAnalysisStore } from "../store/analysis";

interface BusinessDatasetCardProps {
  tableName: string;
  summary?: TableBusinessSummary;
  disabled: boolean;
}

export default function BusinessDatasetCard({
  tableName,
  summary,
  disabled,
}: BusinessDatasetCardProps) {
  const selectedTables = useAnalysisStore((state) => state.selectedTables);
  const pendingTables = useAnalysisStore((state) => state.pendingTables);
  const tableErrors = useAnalysisStore((state) => state.tableErrors);
  const toggleTable = useAnalysisStore((state) => state.toggleTable);
  const toggleField = useAnalysisStore((state) => state.toggleField);
  const selectAllFields = useAnalysisStore((state) => state.selectAllFields);
  const deselectAllFields = useAnalysisStore(
    (state) => state.deselectAllFields,
  );

  const entry = selectedTables.get(tableName);
  const isSelected = Boolean(entry);
  const loading = pendingTables.has(tableName);
  const error = tableErrors.get(tableName);
  const auxiliaryColumns = entry?.columns.filter(isAuxiliaryColumn) ?? [];
  const selectedAuxiliaryCount = auxiliaryColumns.filter((column) =>
    entry?.selectedFields.has(column.name),
  ).length;
  const allAuxiliarySelected =
    auxiliaryColumns.length > 0 &&
    selectedAuxiliaryCount === auxiliaryColumns.length;
  const selectionLabel = summary
    ? `选择业务数据 ${summary.semantic_name}（来源 ${tableName}）`
    : `选择业务数据 ${tableName}`;

  async function handleSelectionChange() {
    if (loading) return;
    await toggleTable(tableName);
  }

  return (
    <article
      className={`overflow-hidden rounded-xl border transition-colors ${
        isSelected
          ? "border-blue-300 bg-blue-50/40"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-start gap-3 p-4">
        <input
          type="checkbox"
          aria-label={selectionLabel}
          checked={isSelected}
          disabled={disabled || loading}
          onChange={handleSelectionChange}
          className="mt-1 h-4 w-4 rounded text-blue-600"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate font-semibold text-gray-900">
                {summary?.semantic_name ?? tableName}
              </h3>
              {summary && (
                <p className="mt-0.5 truncate font-mono text-xs text-gray-400">
                  {tableName}
                </p>
              )}
            </div>
            {summary && (
              <span className="shrink-0 text-sm text-gray-500">
                {summary.row_count} 个对象
              </span>
            )}
          </div>

          {summary && summary.name_samples.length > 0 && (
            <ul
              aria-label={`${summary.semantic_name} 示例对象`}
              className="mt-3 flex flex-wrap gap-2"
            >
              {summary.name_samples.map((sample) => (
                <li
                  key={sample}
                  className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600"
                >
                  {sample}
                </li>
              ))}
            </ul>
          )}

          {loading && (
            <p role="status" className="mt-3 text-sm text-blue-700">
              正在加载 {tableName} 的业务字段…
            </p>
          )}
        </div>
      </div>

      {error && !isSelected && (
        <div className="flex items-center justify-between gap-3 border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            aria-label={`重试 ${tableName} 字段加载`}
            onClick={handleSelectionChange}
            disabled={loading}
            className="shrink-0 font-medium underline"
          >
            重试
          </button>
        </div>
      )}

      {isSelected && entry && (
        <div className="space-y-4 border-t border-gray-200 bg-white px-4 py-4">
          <section aria-label={`${tableName} 主要判断信息`}>
            <h4 className="text-sm font-semibold text-gray-800">主要判断信息</h4>
            <p className="mt-1 text-sm text-gray-600">
              系统将使用名称和对象类型判断关系。
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {entry.columns.some((column) => column.is_name) && (
                <span className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-800">
                  节点名称（自动使用）
                </span>
              )}
              {entry.columns.some((column) => column.is_class_name) && (
                <span className="rounded bg-violet-50 px-2 py-1 text-xs text-violet-800">
                  对象类型由系统自动识别
                </span>
              )}
            </div>
          </section>

          <section aria-label={`${tableName} 辅助判断依据`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-gray-800">
                  辅助判断依据
                </h4>
                <p className="mt-0.5 text-xs text-gray-500">
                  可选信息只用于补充主要判断。
                </p>
              </div>
              {auxiliaryColumns.length > 0 && (
                <button
                  type="button"
                  aria-label={`${
                    allAuxiliarySelected ? "取消全选" : "全选"
                  } ${tableName} 辅助判断依据`}
                  onClick={() =>
                    allAuxiliarySelected
                      ? deselectAllFields(tableName)
                      : selectAllFields(tableName)
                  }
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  {allAuxiliarySelected ? "取消全选" : "全选"}
                </button>
              )}
            </div>

            {auxiliaryColumns.length > 0 ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {auxiliaryColumns.map((column) => (
                  <label
                    key={column.name}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      aria-label={`字段 ${column.name}`}
                      checked={entry.selectedFields.has(column.name)}
                      onChange={() => toggleField(tableName, column.name)}
                      className="h-4 w-4 rounded text-blue-600"
                    />
                    <span>{column.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-gray-400">没有可选的辅助信息。</p>
            )}
          </section>

          <details className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-gray-600">
              技术信息
            </summary>
            <dl className="mt-3 grid gap-2">
              {entry.columns.map((column) => (
                <div
                  key={column.name}
                  className="flex items-center justify-between gap-4 text-xs"
                >
                  <dt className="font-mono text-gray-600">{column.name}</dt>
                  <dd className="flex flex-wrap items-center justify-end gap-1.5">
                    <span className="font-mono text-gray-400">{column.type}</span>
                    {column.is_primary_key && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-sans font-medium text-amber-800">
                        主键
                      </span>
                    )}
                    {column.is_foreign_key && (
                      <span className="rounded bg-cyan-100 px-1.5 py-0.5 font-sans font-medium text-cyan-800">
                        外键
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      )}
    </article>
  );
}
