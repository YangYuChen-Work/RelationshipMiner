import { tableColor } from "../graph/scene";
import { buildBusinessTablePresentationIndex } from "../graph/businessTables";
import { useAnalysisStore } from "../store/analysis";

export default function GraphLegend() {
  const graph = useAnalysisStore((state) => state.graph);
  const tableSummaries = useAnalysisStore((state) => state.tableSummaries);

  if (!graph || graph.table_nodes.length === 0) return null;
  const tablePresentations = buildBusinessTablePresentationIndex(
    graph.table_nodes,
    tableSummaries,
  );

  return (
    <details
      open
      role="group"
      aria-label="数据来源图例"
      className="pointer-events-auto w-56 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-slate-700 shadow-sm backdrop-blur-sm"
    >
      <summary className="cursor-pointer select-none text-xs font-semibold text-slate-700">
        数据来源
      </summary>
      <ul className="mt-3 space-y-2.5">
        {graph.table_nodes.map((table) => {
          const semanticName = tablePresentations.get(table.id) ?? "业务数据集";
          return (
            <li key={table.id} className="flex min-w-0 items-start gap-2.5">
              <span
                aria-label={`${semanticName}颜色`}
                className="mt-0.5 size-3.5 shrink-0 rounded-full border-[1.5px] border-white shadow-[0_0_0_1px_rgba(148,163,184,0.35)]"
                style={{ backgroundColor: tableColor(table.id) }}
              />
              <span className="min-w-0 block truncate text-xs font-medium text-slate-700">
                {semanticName}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
