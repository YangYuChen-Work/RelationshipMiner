import type { SelectedTable } from "../store/analysis";

interface SelectionReplacementDialogProps {
  current: Map<string, SelectedTable>;
  proposed: Map<string, SelectedTable>;
  onConfirm: () => void;
  onCancel: () => void;
  onUndo?: () => void;
}

function fieldDifference(current: SelectedTable | undefined, proposed: SelectedTable | undefined) {
  const currentFields = current?.selectedFields ?? new Set<string>();
  const proposedFields = proposed?.selectedFields ?? new Set<string>();
  return {
    added: [...proposedFields].filter((field) => !currentFields.has(field)),
    removed: [...currentFields].filter((field) => !proposedFields.has(field)),
  };
}

export default function SelectionReplacementDialog({ current, proposed, onConfirm, onCancel, onUndo }: SelectionReplacementDialogProps) {
  const tableNames = new Set([...current.keys(), ...proposed.keys()]);
  const addedTables = [...proposed.keys()].filter((name) => !current.has(name));
  const removedTables = [...current.keys()].filter((name) => !proposed.has(name));
  const fieldChanges = [...tableNames].map((name) => ({ name, ...fieldDifference(current.get(name), proposed.get(name)) })).filter((change) => change.added.length || change.removed.length);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="ai-selection-replacement-title" className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
      <h3 id="ai-selection-replacement-title" className="font-semibold text-gray-900">AI \u5efa\u8bae\u66ff\u6362\u5f53\u524d\u9009\u62e9</h3>
      <p className="mt-1 text-sm text-gray-600">\u60a8\u5df2\u7ecf\u5fae\u8c03\u8fc7\u5f53\u524d\u7ed3\u679c\uff0c\u8bf7\u786e\u8ba4\u662f\u5426\u5e94\u7528 AI \u5efa\u8bae\u3002</p>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <section aria-label="\u65b0\u589e\u8868"><h4 className="font-medium text-emerald-800">\u65b0\u589e\u8868</h4><p className="mt-1 text-gray-700">{addedTables.join("\u3001") || "\u65e0"}</p></section>
        <section aria-label="\u79fb\u9664\u8868"><h4 className="font-medium text-red-800">\u79fb\u9664\u8868</h4><p className="mt-1 text-gray-700">{removedTables.join("\u3001") || "\u65e0"}</p></section>
      </div>
      {fieldChanges.length > 0 && <section aria-label="\u8f85\u52a9\u5b57\u6bb5\u53d8\u5316" className="mt-3 text-sm"><h4 className="font-medium text-gray-800">\u8f85\u52a9\u5b57\u6bb5\u53d8\u5316</h4><ul className="mt-1 space-y-1 text-gray-700">{fieldChanges.map(({ name, added, removed }) => <li key={name}><span className="font-medium">{name}</span>{added.length > 0 && <span> \u65b0\u589e: {added.join("\u3001")}</span>}{removed.length > 0 && <span> \u79fb\u9664: {removed.join("\u3001")}</span>}</li>)}</ul></section>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {onUndo && <button type="button" onClick={onUndo} className="rounded-lg px-3 py-2 text-sm text-gray-700 underline">\u64a4\u9500\u4e0a\u6b21\u66ff\u6362</button>}
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">\u53d6\u6d88</button>
        <button type="button" onClick={onConfirm} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white">\u786e\u8ba4\u5e94\u7528</button>
      </div>
    </div>
  );
}
