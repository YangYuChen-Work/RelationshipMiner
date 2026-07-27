/** FieldSelector — 字段选择组件。

按表分组展示字段，class_name 字段自动标记并强制选中，其余字段支持多选 + 全选/取消全选。
*/

import { useAnalysisStore } from "../store/analysis";

export default function FieldSelector() {
  const selectedTables = useAnalysisStore((s) => s.selectedTables);
  const toggleField = useAnalysisStore((s) => s.toggleField);
  const selectAllFields = useAnalysisStore((s) => s.selectAllFields);
  const deselectAllFields = useAnalysisStore((s) => s.deselectAllFields);

  if (selectedTables.size === 0) {
    return (
      <div className="text-gray-400 text-sm p-4 text-center">
        请先在上方选择要分析的数据表
      </div>
    );
  }

  const entries = Array.from(selectedTables.values());

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">选择分析字段</h2>

      {entries.map((entry) => {
        const totalFields = entry.columns.length;
        const selectedCount = entry.selectedFields.size;
        const allSelected = selectedCount === totalFields;

        return (
          <div
            key={entry.name}
            className="border border-gray-200 rounded-lg overflow-hidden"
          >
            {/* 表头 */}
            <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 border-b border-gray-200">
              <span className="text-sm font-semibold text-gray-700">
                {entry.name}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">
                  {selectedCount}/{totalFields}
                </span>
                <button
                  onClick={() =>
                    allSelected
                      ? deselectAllFields(entry.name)
                      : selectAllFields(entry.name)
                  }
                  className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {allSelected ? "取消全选" : "全选"}
                </button>
              </div>
            </div>

            {/* 字段列表 */}
            <div className="divide-y divide-gray-100">
              {entry.columns.map((col) => (
                <label
                  key={col.name}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors hover:bg-gray-50 ${
                    col.is_class_name ? "bg-purple-50/50" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={entry.selectedFields.has(col.name)}
                    disabled={col.is_class_name}
                    onChange={() => toggleField(entry.name, col.name)}
                    className={`w-4 h-4 rounded focus:ring-blue-500 ${
                      col.is_class_name
                        ? "text-purple-600 cursor-not-allowed"
                        : "text-blue-600"
                    }`}
                  />
                  <span className="text-sm text-gray-700 flex-1">
                    {col.name}
                  </span>
                  <span className="text-xs text-gray-400 font-mono">
                    {col.type}
                  </span>
                  {col.is_class_name && (
                    <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">
                      类名
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
