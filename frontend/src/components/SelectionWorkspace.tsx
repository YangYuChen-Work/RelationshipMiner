import { useDeferredValue, useEffect, useMemo, useState } from "react";
import AnalysisLauncher from "./AnalysisLauncher";
import BusinessDatasetCard from "./BusinessDatasetCard";
import DatabaseInfoCard from "./DatabaseInfoCard";
import { useAnalysisStore } from "../store/analysis";

export default function SelectionWorkspace() {
  const tables = useAnalysisStore((s) => s.tables);
  const tablesLoading = useAnalysisStore((s) => s.tablesLoading);
  const tablesError = useAnalysisStore((s) => s.tablesError);
  const tableSummaries = useAnalysisStore((s) => s.tableSummaries);
  const tableSummariesWarning = useAnalysisStore(
    (s) => s.tableSummariesWarning,
  );
  const selectedTables = useAnalysisStore((s) => s.selectedTables);
  const maxTables = useAnalysisStore((s) => s.maxTables);
  const loadTables = useAnalysisStore((s) => s.loadTables);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedSearchQuery = deferredSearchQuery.trim().toLocaleLowerCase();
  const filteredTables = useMemo(
    () =>
      normalizedSearchQuery
        ? tables.filter((table) => {
            const summary = tableSummaries.get(table.name);
            return [table.name, summary?.semantic_name]
              .filter(Boolean)
              .some((value) =>
                value!.toLocaleLowerCase().includes(normalizedSearchQuery),
              );
          })
        : tables,
    [normalizedSearchQuery, tableSummaries, tables]
  );

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  const selectedCount = selectedTables.size;

  return (
    <section className="space-y-4" aria-label="业务数据选择">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            选择要分析的业务数据
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            选择业务数据，并按需补充辅助判断依据。
          </p>
        </div>
        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-sm font-medium text-blue-800">
          {selectedCount} / {maxTables} 表
        </span>
      </div>

      <DatabaseInfoCard />

      {selectedCount >= maxTables && (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          已达到十表上限，取消选择后可继续添加。
        </p>
      )}

      {tableSummariesWarning && !tablesError && (
        <p role="status" className="text-xs text-amber-700">
          业务名称暂不可用，已显示原始表名。
        </p>
      )}

      {!tablesLoading && !tablesError && tables.length > 0 && (
        <input
          type="search"
          aria-label="搜索表名"
          placeholder="搜索表名"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
      )}

      {tablesError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="font-medium">加载失败</p>
          <p className="mt-1 text-sm">{tablesError}</p>
          <button type="button" onClick={loadTables} className="mt-2 text-sm underline">
            重试
          </button>
        </div>
      )}

      {tablesLoading && (
        <div className="space-y-2" aria-label="正在加载数据表">
          <div className="h-14 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-14 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-14 animate-pulse rounded-xl bg-gray-100" />
        </div>
      )}

      {!tablesLoading && !tablesError && tables.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          未发现任何表，请检查数据库连接。
        </p>
      )}

      {!tablesLoading &&
        !tablesError &&
        tables.length > 0 &&
        normalizedSearchQuery &&
        filteredTables.length === 0 && (
          <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            未找到匹配的数据表
          </p>
        )}

      {!tablesLoading && tables.length > 0 && (
        <div className="space-y-2">
          {filteredTables.map((table) => (
            <BusinessDatasetCard
              key={table.name}
              tableName={table.name}
              summary={tableSummaries.get(table.name)}
              disabled={
                !selectedTables.has(table.name) && selectedCount >= maxTables
              }
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
        <span className="text-xs text-gray-500">
          系统将使用名称和对象类型判断关系。
        </span>
        <AnalysisLauncher />
      </div>
    </section>
  );
}
