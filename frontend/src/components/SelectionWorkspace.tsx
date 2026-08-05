import { useDeferredValue, useEffect, useMemo, useState } from "react";
import AnalysisLauncher from "./AnalysisLauncher";
import BusinessDatasetCard from "./BusinessDatasetCard";
import DatabaseInfoCard from "./DatabaseInfoCard";
import NaturalLanguageSelectionPanel from "./NaturalLanguageSelectionPanel";
import SelectionModeToggle from "./SelectionModeToggle";
import SelectionReplacementDialog from "./SelectionReplacementDialog";
import { useAnalysisStore } from "../store/analysis";

const copy = {
  region: "\u4e1a\u52a1\u6570\u636e\u9009\u62e9",
  title: "\u9009\u62e9\u8981\u5206\u6790\u7684\u4e1a\u52a1\u6570\u636e",
  description: "\u9009\u62e9\u4e1a\u52a1\u6570\u636e\uff0c\u5e76\u6309\u9700\u8865\u5145\u8f85\u52a9\u5224\u65ad\u4f9d\u636e\u3002",
  limit: "\u5df2\u8fbe\u5230\u5341\u8868\u4e0a\u9650\uff0c\u53d6\u6d88\u9009\u62e9\u540e\u53ef\u7ee7\u7eed\u6dfb\u52a0\u3002",
  summaryWarning: "\u4e1a\u52a1\u540d\u79f0\u6682\u4e0d\u53ef\u7528\uff0c\u5df2\u663e\u793a\u539f\u59cb\u8868\u540d\u3002",
  search: "\u641c\u7d22\u8868\u540d",
  loadFailed: "\u52a0\u8f7d\u5931\u8d25",
  retry: "\u91cd\u8bd5",
  loading: "\u6b63\u5728\u52a0\u8f7d\u6570\u636e\u8868",
  noTables: "\u672a\u53d1\u73b0\u4efb\u4f55\u8868\uff0c\u8bf7\u68c0\u67e5\u6570\u636e\u5e93\u8fde\u63a5\u3002",
  noMatches: "\u672a\u627e\u5230\u5339\u914d\u7684\u6570\u636e\u8868\u3002",
  selected: "\u5f53\u524d\u5df2\u9009\u6570\u636e\u8868",
  undo: "\u64a4\u9500\u4e0a\u6b21 AI \u66ff\u6362",
  systemInfo: "\u7cfb\u7edf\u5c06\u4f7f\u7528\u540d\u79f0\u548c\u5bf9\u8c61\u7c7b\u578b\u5224\u65ad\u5173\u7cfb\u3002",
};

export default function SelectionWorkspace() {
  const tables = useAnalysisStore((s) => s.tables);
  const tablesLoading = useAnalysisStore((s) => s.tablesLoading);
  const tablesError = useAnalysisStore((s) => s.tablesError);
  const tableSummaries = useAnalysisStore((s) => s.tableSummaries);
  const tableSummariesWarning = useAnalysisStore((s) => s.tableSummariesWarning);
  const selectedTables = useAnalysisStore((s) => s.selectedTables);
  const maxTables = useAnalysisStore((s) => s.maxTables);
  const selectionMode = useAnalysisStore((s) => s.selectionMode);
  const setSelectionMode = useAnalysisStore((s) => s.setSelectionMode);
  const loadTables = useAnalysisStore((s) => s.loadTables);
  const pendingAIReplacement = useAnalysisStore((s) => s.pendingAIReplacement);
  const previousSelection = useAnalysisStore((s) => s.previousSelection);
  const confirmAIReplacement = useAnalysisStore((s) => s.confirmAIReplacement);
  const cancelAIReplacement = useAnalysisStore((s) => s.cancelAIReplacement);
  const undoAIReplacement = useAnalysisStore((s) => s.undoAIReplacement);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = useDeferredValue(searchQuery).trim().toLocaleLowerCase();
  const filteredTables = useMemo(() => normalizedSearchQuery ? tables.filter((table) => {
    const summary = tableSummaries.get(table.name);
    return [table.name, summary?.semantic_name].filter(Boolean).some((value) => value!.toLocaleLowerCase().includes(normalizedSearchQuery));
  }) : tables, [normalizedSearchQuery, tableSummaries, tables]);

  useEffect(() => { void loadTables(); }, [loadTables]);
  const selectedCount = selectedTables.size;

  return (
    <section className="space-y-4" aria-label={copy.region}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="text-lg font-semibold text-gray-900">{copy.title}</h2><p className="mt-1 text-sm text-gray-500">{copy.description}</p></div>
        <div className="flex flex-wrap items-center gap-3"><span className="rounded-full bg-blue-100 px-2.5 py-1 text-sm font-medium text-blue-800">{selectedCount} / {maxTables} \u5f20\u8868</span><SelectionModeToggle mode={selectionMode} onChange={setSelectionMode} /></div>
      </div>
      <DatabaseInfoCard />
      {selectedCount >= maxTables && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{copy.limit}</p>}
      {tableSummariesWarning && !tablesError && <p role="status" className="text-xs text-amber-700">{copy.summaryWarning}</p>}

      <div className="space-y-3" hidden={selectionMode !== "natural"}><NaturalLanguageSelectionPanel hidden={selectionMode !== "natural"} />
        {selectedCount > 0 && <section aria-label={copy.selected} className="space-y-2"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-gray-800">{copy.selected}</h3>{previousSelection && <button type="button" onClick={undoAIReplacement} className="text-sm font-medium text-blue-700 hover:underline">{copy.undo}</button>}</div>{Array.from(selectedTables.values()).map((table) => <BusinessDatasetCard key={table.name} tableName={table.name} summary={tableSummaries.get(table.name)} disabled={false} />)}</section>}
      </div>

      <section id="selection-panel-manual" role="tabpanel" aria-labelledby="selection-tab-manual" hidden={selectionMode !== "manual"} className="space-y-4">
        {!tablesLoading && !tablesError && tables.length > 0 && <input type="search" aria-label={copy.search} placeholder={copy.search} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />}
        {tablesError && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700"><p className="font-medium">{copy.loadFailed}</p><p className="mt-1 text-sm">{tablesError}</p><button type="button" onClick={() => void loadTables()} className="mt-2 text-sm underline">{copy.retry}</button></div>}
        {tablesLoading && <div className="space-y-2" aria-label={copy.loading}><div className="h-14 animate-pulse rounded-xl bg-gray-100" /><div className="h-14 animate-pulse rounded-xl bg-gray-100" /><div className="h-14 animate-pulse rounded-xl bg-gray-100" /></div>}
        {!tablesLoading && !tablesError && tables.length === 0 && <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">{copy.noTables}</p>}
        {!tablesLoading && !tablesError && tables.length > 0 && normalizedSearchQuery && filteredTables.length === 0 && <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">{copy.noMatches}</p>}
        {!tablesLoading && !tablesError && tables.length > 0 && <div className="space-y-2">{filteredTables.map((table) => <BusinessDatasetCard key={table.name} tableName={table.name} summary={tableSummaries.get(table.name)} disabled={!selectedTables.has(table.name) && selectedCount >= maxTables} />)}</div>}
      </section>

      <div className="flex items-center justify-between border-t border-gray-200 pt-4"><span className="text-xs text-gray-500">{copy.systemInfo}</span><AnalysisLauncher /></div>
      {pendingAIReplacement && <SelectionReplacementDialog current={selectedTables} proposed={pendingAIReplacement} onConfirm={confirmAIReplacement} onCancel={cancelAIReplacement} onUndo={previousSelection ? undoAIReplacement : undefined} />}
    </section>
  );
}
