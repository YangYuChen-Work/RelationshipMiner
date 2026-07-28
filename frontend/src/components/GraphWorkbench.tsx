import GraphCanvas from "./GraphCanvas";
import GraphToolbar from "./GraphToolbar";
import NodeDetailPanel from "./NodeDetailPanel";

export default function GraphWorkbench() {
  return (
    <section className="min-h-[100dvh] h-[100dvh] overflow-hidden bg-[#09131f] text-slate-100">
      <GraphToolbar />

      <main className="grid h-[calc(100dvh-4rem)] min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="relative min-h-0 overflow-hidden border-r border-slate-700/70 bg-[#0d1926]">
          <div className="h-full min-h-0 p-3 [&>div]:h-full [&_svg]:h-full">
            <GraphCanvas />
          </div>
        </section>

        <aside className="hidden min-h-0 border-l border-slate-700/70 bg-[#101c2a] lg:block">
          <div className="border-b border-slate-700/70 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-300">
              节点详情
            </p>
            <p className="mt-1 text-sm text-slate-400">选择图谱中的节点以查看关联数据。</p>
          </div>
        </aside>
      </main>

      <NodeDetailPanel />
    </section>
  );
}
