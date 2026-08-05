import { useAnalysisStore } from "../store/analysis";

interface NaturalLanguageSelectionPanelProps {
  hidden?: boolean;
}

const copy = {
  unavailable:
    "\u5f53\u524d\u65e0\u6cd5\u5b8c\u6210\u81ea\u52a8\u9009\u53d6\uff0c\u5df2\u6709\u9009\u62e9\u672a\u53d1\u751f\u53d8\u5316\uff1b\u53ef\u7a0d\u540e\u91cd\u8bd5\u6216\u5207\u6362\u5230\u624b\u52a8\u9009\u53d6\u3002",
  title: "\u7528\u81ea\u7136\u8bed\u8a00\u63cf\u8ff0\u60a8\u60f3\u5206\u6790\u7684\u4e1a\u52a1\u5173\u7cfb",
  timeHelp:
    "\u65f6\u95f4\u76f8\u5173\u63cf\u8ff0\u53ea\u7528\u4e8e\u5e2e\u52a9\u9009\u62e9\u8868\u548c\u8f85\u52a9\u5b57\u6bb5\uff0c\u4e0d\u4f1a\u8fc7\u6ee4\u6570\u636e\u884c\u3002",
  input: "\u63cf\u8ff0\u8981\u5206\u6790\u7684\u4e1a\u52a1\u5173\u7cfb",
  placeholder:
    "\u4f8b\u5982\uff1a\u5206\u6790\u5ba2\u6237\u3001\u8ba2\u5355\u4e0e\u9000\u6b3e\u4e4b\u95f4\u7684\u5173\u7cfb",
  select: "AI \u81ea\u52a8\u9009\u53d6",
  selecting: "AI \u6b63\u5728\u9009\u53d6...",
  loading: "\u6b63\u5728\u5206\u6790\u60a8\u7684\u63cf\u8ff0...",
  clarify: "\u8bf7\u5c06\u8303\u56f4\u7f29\u5c0f\uff0c\u6216\u5207\u6362\u5230\u624b\u52a8\u9009\u53d6\u3002",
  suggestions: "\u5efa\u8bae\u8865\u5145\u63cf\u8ff0",
  suggestLead: "\u60a8\u53ef\u4ee5\u8865\u5145\uff1a",
};

export default function NaturalLanguageSelectionPanel({ hidden = false }: NaturalLanguageSelectionPanelProps) {
  const naturalLanguage = useAnalysisStore((state) => state.naturalLanguage);
  const setNaturalLanguageInput = useAnalysisStore(
    (state) => state.setNaturalLanguageInput,
  );
  const requestNaturalSelection = useAnalysisStore(
    (state) => state.requestNaturalSelection,
  );
  const { input, status } = naturalLanguage;
  const guidance =
    status === "unavailable"
      ? naturalLanguage.guidance || copy.unavailable
      : naturalLanguage.guidance;

  return (
    <section id="selection-panel-natural" role="tabpanel" aria-labelledby="selection-tab-natural" hidden={hidden} className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
      <div>
        <h3 className="font-semibold text-gray-900">{copy.title}</h3>
        <p className="mt-1 text-sm text-gray-600">{copy.timeHelp}</p>
      </div>
      <textarea aria-label={copy.input} placeholder={copy.placeholder} value={input} onChange={(event) => setNaturalLanguageInput(event.target.value)} className="min-h-24 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!input.trim() || status === "loading"} onClick={() => void requestNaturalSelection()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300">
          {status === "loading" ? copy.selecting : copy.select}
        </button>
        {status === "loading" && <span role="status" className="text-sm text-blue-700">{copy.loading}</span>}
      </div>
      {guidance && (
        <div role="status" className={`rounded-lg px-3 py-2 text-sm ${status === "unavailable" ? "border border-amber-200 bg-amber-50 text-amber-800" : "border border-blue-200 bg-white text-blue-900"}`}>
          <p>{guidance}</p>
          {status === "needs_clarification" && <p className="mt-1 text-xs text-gray-600">{copy.clarify}</p>}
        </div>
      )}
      {naturalLanguage.suggestedQuestions.length > 0 && (
        <section aria-label={copy.suggestions}>
          <p className="text-sm font-medium text-gray-700">{copy.suggestLead}</p>
          <ul className="mt-1 list-inside list-disc text-sm text-gray-600">
            {naturalLanguage.suggestedQuestions.map((question) => <li key={question}>{question}</li>)}
          </ul>
        </section>
      )}
    </section>
  );
}
