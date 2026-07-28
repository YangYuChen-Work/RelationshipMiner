/** TableSelector — 表列表多选组件。

展示数据库中所有表，支持多选勾选，显示已选数量与上限（10）。
*/

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useAnalysisStore } from "../store/analysis";

export default function TableSelector() {
  const tables = useAnalysisStore((s) => s.tables);
  const tablesLoading = useAnalysisStore((s) => s.tablesLoading);
  const selectedTables = useAnalysisStore((s) => s.selectedTables);
  const maxTables = useAnalysisStore((s) => s.maxTables);
  const loadTables = useAnalysisStore((s) => s.loadTables);
  const toggleTable = useAnalysisStore((s) => s.toggleTable);
  const errorMessage = useAnalysisStore((s) => s.errorMessage);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedSearchQuery = deferredSearchQuery.trim().toLocaleLowerCase();
  const filteredTables = useMemo(
    () =>
      normalizedSearchQuery
        ? tables.filter((table) =>
            table.name.toLocaleLowerCase().includes(normalizedSearchQuery)
          )
        : tables,
    [normalizedSearchQuery, tables]
  );

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  if (tablesLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-500 p-4">
        <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
        <span>正在加载表列表...</span>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        <p className="font-medium">加载失败</p>
        <p className="text-sm mt-1">{errorMessage}</p>
        <button
          className="mt-2 text-sm underline hover:no-underline"
          onClick={loadTables}
        >
          重试
        </button>
      </div>
    );
  }

  const selectedCount = selectedTables.size;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-800">选择数据表</h2>
        <span
          className={`text-sm px-2 py-0.5 rounded-full ${
            selectedCount >= maxTables
              ? "bg-orange-100 text-orange-700"
              : "bg-blue-100 text-blue-700"
          }`}
        >
          {selectedCount} / {maxTables}
        </span>
      </div>

      <div className="relative">
        <input
          type="search"
          aria-label="搜索表名"
          placeholder="搜索表名"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {tables.length === 0 && (
        <p className="text-gray-400 text-sm">未发现任何表，请检查数据库连接</p>
      )}

      {tables.length > 0 &&
        normalizedSearchQuery &&
        filteredTables.length === 0 && (
          <p className="text-gray-400 text-sm">未找到匹配的数据表</p>
        )}

      <div className="grid gap-1">
        {filteredTables.map((t) => {
          const isSelected = selectedTables.has(t.name);
          const isDisabled = !isSelected && selectedCount >= maxTables;

          return (
            <label
              key={t.name}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                isSelected
                  ? "border-blue-300 bg-blue-50"
                  : isDisabled
                    ? "border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed"
                    : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                disabled={isDisabled}
                onChange={() => toggleTable(t.name)}
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">
                {t.name}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
