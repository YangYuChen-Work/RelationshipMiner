/** Zustand 全局状态 — 分析配置与执行。 */

import { create } from "zustand";
import type {
  TableBusinessSummary,
  TableInfo,
  ColumnInfo,
} from "../api/tables";
import type {
  AnalysisDiagnostics,
  AnalysisStatus,
  SemanticGraphData,
} from "../api/analysis";
import {
  fetchTableColumns,
  fetchTableSummaries,
  fetchTables,
} from "../api/tables";
import { submitAnalysis, createAnalysisSocket } from "../api/analysis";
import {
  requestNaturalSelection as requestNaturalSelectionApi,
} from "../api/naturalSelection";

export type Phase = "select" | "analyzing" | "done" | "error";

export interface SelectedTable {
  name: string;
  columns: ColumnInfo[];
  selectedFields: Set<string>;
}

export type SelectionMode = "natural" | "manual";
export type SelectionSource = "ai" | "manual" | "mixed";

export interface NaturalLanguageState {
  input: string;
  status: "idle" | "loading" | "selected" | "needs_clarification" | "unavailable";
  activeRequestId: string | null;
  reasonCode: string | null;
  guidance: string | null;
  suggestedQuestions: string[];
}

interface FocusNodeRequest {
  nodeId: string;
  version: number;
}

export function isRequiredBusinessColumn(column: ColumnInfo): boolean {
  return column.is_name || column.is_class_name;
}

export function isAuxiliaryColumn(column: ColumnInfo): boolean {
  return !isRequiredBusinessColumn(column) &&
    !column.is_primary_key &&
    !column.is_foreign_key;
}

interface AnalysisState {
  // ── 阶段 ──
  phase: Phase;
  errorMessage: string | null;

  // ── 数据库元数据 ──
  tables: TableInfo[];
  tablesLoading: boolean;
  tablesError: string | null;
  tableSummaries: Map<string, TableBusinessSummary>;
  tableSummariesWarning: string | null;

  // ── 用户选择 ──
  selectedTables: Map<string, SelectedTable>;
  pendingTables: Set<string>;
  tableRequestTokens: Map<string, number>;
  tableErrors: Map<string, string>;
  maxTables: number;
  selectionMode: SelectionMode;
  selectionSource: SelectionSource;
  selectionDirty: boolean;
  metadataRevision: string | null;
  previousSelection: Map<string, SelectedTable> | null;
  pendingAIReplacement: Map<string, SelectedTable> | null;
  pendingAIReplacementMetadataRevision: string | null;
  naturalLanguage: NaturalLanguageState;

  // ── 分析进度 ──
  currentPhase: string;
  progressMessage: string;
  progressValue: number;

  // ── 图谱数据 ──
  graph: SemanticGraphData | null;
  analysisStatus: AnalysisStatus | null;
  warnings: string[];
  diagnostics: AnalysisDiagnostics | null;
  taskId: string | null;
  activeSocket: WebSocket | null;
  analysisGeneration: number;

  // ── 图谱交互状态 ──
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
  confidenceThreshold: number;
  showIsolatedNodes: boolean;
  fitViewRequest: number;
  relayoutRequest: number;
  focusNodeRequest: FocusNodeRequest | null;
  selectedEntityEdgeId: string | null;
  selectedTableEdgeId: string | null;

  // ── 操作：元数据 ──
  loadTables: () => Promise<void>;
  loadTableSummaries: () => Promise<void>;
  toggleTable: (tableName: string) => Promise<void>;
  toggleField: (tableName: string, fieldName: string) => void;
  selectAllFields: (tableName: string) => void;
  deselectAllFields: (tableName: string) => void;
  setSelectionMode: (mode: SelectionMode) => void;
  setNaturalLanguageInput: (input: string) => void;
  requestNaturalSelection: (description?: string) => Promise<void>;
  queueAISelection: (
    selection: Map<string, SelectedTable>,
    metadataRevision?: string,
  ) => void;
  applyAISelection: (
    selection: Map<string, SelectedTable>,
    metadataRevision: string,
  ) => void;
  confirmAIReplacement: () => void;
  cancelAIReplacement: () => void;
  undoAIReplacement: () => void;

  // ── 操作：分析 ──
  startAnalysis: () => Promise<void>;
  resetAnalysis: () => void;

  // ── 操作：图谱交互 ──
  setHoveredNode: (id: string | null) => void;
  setSelectedNode: (id: string | null) => void;
  requestNodeFocus: (id: string) => void;
  setConfidenceThreshold: (value: number) => void;
  setShowIsolatedNodes: (value: boolean) => void;
  requestFitView: () => void;
  requestRelayout: () => void;
  selectEntityEdge: (id: string | null) => void;
  selectTableEdge: (id: string | null) => void;
}

/** 不可变更新 selectedTables Map：clone → 修改指定表 → set。 */
function patchSelectedTable(
  selectedTables: Map<string, SelectedTable>,
  tableName: string,
  updater: (entry: SelectedTable) => SelectedTable
): Map<string, SelectedTable> {
  const next = new Map(selectedTables);
  const entry = next.get(tableName);
  if (entry) {
    next.set(tableName, updater(entry));
  }
  return next;
}

function cloneSelectedTables(
  selectedTables: Map<string, SelectedTable>,
): Map<string, SelectedTable> {
  return new Map(
    Array.from(selectedTables, ([name, table]) => [
      name,
      { ...table, columns: [...table.columns], selectedFields: new Set(table.selectedFields) },
    ]),
  );
}

function closeAnalysisSocket(socket: WebSocket | null) {
  if (!socket) return;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  try {
    socket.close();
  } catch {
    // The run is already detached; a close failure must not restore ownership.
  }
}

let nextTableRequestToken = 0;
let nextTableSummaryRequestToken = 0;
let nextNaturalSelectionRequestId = 0;
let naturalSelectionAbortController: AbortController | null = null;

function abortNaturalSelectionRequest() {
  naturalSelectionAbortController?.abort();
  naturalSelectionAbortController = null;
}

function manualSelectionPatch(): Pick<
  AnalysisState,
  "selectionSource" | "selectionDirty" | "metadataRevision"
> {
  return {
    selectionSource: "mixed",
    selectionDirty: true,
    metadataRevision: null,
  };
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  // ── 初始值 ──
  phase: "select",
  errorMessage: null,
  tables: [],
  tablesLoading: false,
  tablesError: null,
  tableSummaries: new Map(),
  tableSummariesWarning: null,
  selectedTables: new Map(),
  pendingTables: new Set(),
  tableRequestTokens: new Map(),
  tableErrors: new Map(),
  maxTables: 10,
  selectionMode: "natural",
  selectionSource: "manual",
  selectionDirty: false,
  metadataRevision: null,
  previousSelection: null,
  pendingAIReplacement: null,
  pendingAIReplacementMetadataRevision: null,
  naturalLanguage: {
    input: "",
    status: "idle",
    activeRequestId: null,
    reasonCode: null,
    guidance: null,
    suggestedQuestions: [],
  },
  currentPhase: "",
  progressMessage: "",
  progressValue: 0,
  graph: null,
  analysisStatus: null,
  warnings: [],
  diagnostics: null,
  taskId: null,
  activeSocket: null,
  analysisGeneration: 0,
  hoveredNodeId: null,
  selectedNodeId: null,
  confidenceThreshold: 0,
  showIsolatedNodes: false,
  fitViewRequest: 0,
  relayoutRequest: 0,
  focusNodeRequest: null,
  selectedEntityEdgeId: null,
  selectedTableEdgeId: null,

  // ── 元数据操作 ──

  loadTables: async () => {
    const { tables, tablesLoading } = get();
    // 避免重复加载：表已加载或正在加载时跳过
    if (tables.length > 0 || tablesLoading) return;

    set({ tablesLoading: true });
    try {
      const result = await fetchTables();
      set({ tables: result, tablesLoading: false, tablesError: null });
      void get().loadTableSummaries();
    } catch (e: any) {
      set({
        tablesError: e.message || "无法加载表列表",
        tablesLoading: false,
      });
    }
  },

  loadTableSummaries: async () => {
    const requestToken = ++nextTableSummaryRequestToken;
    set({ tableSummariesWarning: null });
    try {
      const summaries = await fetchTableSummaries();
      if (requestToken !== nextTableSummaryRequestToken) return;
      set({
        tableSummaries: new Map(
          summaries.map((summary) => [summary.table_name, summary]),
        ),
        tableSummariesWarning: null,
      });
    } catch (e: any) {
      if (requestToken !== nextTableSummaryRequestToken) return;
      set({
        tableSummaries: new Map(),
        tableSummariesWarning:
          e.message || "无法加载业务数据摘要，将显示原始表名",
      });
    }
  },

  toggleTable: async (tableName: string) => {
    const { pendingTables, phase, selectedTables } = get();
    if (phase !== "select" || pendingTables.has(tableName)) return;

    if (selectedTables.has(tableName)) {
      const next = new Map(selectedTables);
      next.delete(tableName);
      set({ selectedTables: next, ...manualSelectionPatch() });
    } else {
      if (selectedTables.size >= get().maxTables) return;
      const requestToken = ++nextTableRequestToken;
      const nextPendingTables = new Set(pendingTables);
      const nextRequestTokens = new Map(get().tableRequestTokens);
      const nextTableErrors = new Map(get().tableErrors);
      nextPendingTables.add(tableName);
      nextRequestTokens.set(tableName, requestToken);
      nextTableErrors.delete(tableName);
      set({
        pendingTables: nextPendingTables,
        tableRequestTokens: nextRequestTokens,
        tableErrors: nextTableErrors,
        // A manual add is a user selection as soon as it is requested, not only
        // once its columns arrive. This prevents an in-flight AI result from
        // replacing it as if the selection were still clean.
        ...manualSelectionPatch(),
      });

      try {
        const { columns } = await fetchTableColumns(tableName);
        const selectedFields = new Set<string>();
        const current = get();
        if (
          current.phase !== "select" ||
          current.tableRequestTokens.get(tableName) !== requestToken
        ) {
          return;
        }

        const currentSelectedTables = current.selectedTables;
        const pendingTablesAfterLoad = new Set(current.pendingTables);
        const requestTokensAfterLoad = new Map(current.tableRequestTokens);
        pendingTablesAfterLoad.delete(tableName);
        requestTokensAfterLoad.delete(tableName);
        if (currentSelectedTables.size >= current.maxTables) {
          set({
            pendingTables: pendingTablesAfterLoad,
            tableRequestTokens: requestTokensAfterLoad,
          });
          return;
        }
        const next = new Map(currentSelectedTables);
        const tableErrors = new Map(current.tableErrors);
        tableErrors.delete(tableName);
        next.set(tableName, {
          name: tableName,
          columns,
          selectedFields,
        });
        set({
          selectedTables: next,
          pendingTables: pendingTablesAfterLoad,
          tableRequestTokens: requestTokensAfterLoad,
          tableErrors,
          errorMessage: null,
          ...manualSelectionPatch(),
        });
      } catch (e: any) {
        const current = get();
        if (
          current.phase !== "select" ||
          current.tableRequestTokens.get(tableName) !== requestToken
        ) {
          return;
        }

        const pendingTablesAfterLoad = new Set(current.pendingTables);
        const requestTokensAfterLoad = new Map(current.tableRequestTokens);
        const tableErrors = new Map(current.tableErrors);
        pendingTablesAfterLoad.delete(tableName);
        requestTokensAfterLoad.delete(tableName);
        tableErrors.set(
          tableName,
          e.message || `加载表 ${tableName} 字段失败`
        );
        set({
          pendingTables: pendingTablesAfterLoad,
          tableRequestTokens: requestTokensAfterLoad,
          tableErrors,
        });
      }
    }
  },

  toggleField: (tableName: string, fieldName: string) => {
    const { selectedTables } = get();
    const entry = selectedTables.get(tableName);
    if (!entry) return;

    const col = entry.columns.find((c) => c.name === fieldName);
    if (!col || !isAuxiliaryColumn(col)) return;

    const next = patchSelectedTable(selectedTables, tableName, (e) => {
      const nextFields = new Set(e.selectedFields);
      if (nextFields.has(fieldName)) {
        nextFields.delete(fieldName);
      } else {
        nextFields.add(fieldName);
      }
      return { ...e, selectedFields: nextFields };
    });
    set({ selectedTables: next, ...manualSelectionPatch() });
  },

  selectAllFields: (tableName: string) => {
    const { selectedTables } = get();
    const next = patchSelectedTable(selectedTables, tableName, (e) => ({
      ...e,
      selectedFields: new Set(
        e.columns
          .filter(isAuxiliaryColumn)
          .map((column) => column.name)
      ),
    }));
    set({ selectedTables: next, ...manualSelectionPatch() });
  },

  deselectAllFields: (tableName: string) => {
    const { selectedTables } = get();
    const next = patchSelectedTable(selectedTables, tableName, (e) => ({
      ...e,
      selectedFields: new Set(),
    }));
    set({ selectedTables: next, ...manualSelectionPatch() });
  },

  setSelectionMode: (mode) => {
    if (mode !== "natural") abortNaturalSelectionRequest();
    const current = get();
    const naturalLanguage = current.naturalLanguage;
    set({
      selectionMode: mode,
      // Field loads started from the previous mode must not append to a
      // selection that is now owned by another mode or an AI replacement.
      ...(mode !== current.selectionMode
        ? { pendingTables: new Set<string>(), tableRequestTokens: new Map<string, number>() }
        : {}),
      naturalLanguage:
        mode === "natural"
          ? naturalLanguage
          : { ...naturalLanguage, status: "idle", activeRequestId: null },
    });
  },

  setNaturalLanguageInput: (input) => {
    set({ naturalLanguage: { ...get().naturalLanguage, input } });
  },

  requestNaturalSelection: async (description) => {
    const current = get();
    const input = (description ?? current.naturalLanguage.input).trim();
    if (!input || current.phase !== "select" || current.selectionMode !== "natural") return;

    abortNaturalSelectionRequest();
    const controller = new AbortController();
    naturalSelectionAbortController = controller;
    const requestId = `natural-selection-${++nextNaturalSelectionRequestId}`;
    set({
      naturalLanguage: {
        ...current.naturalLanguage,
        input,
        status: "loading",
        activeRequestId: requestId,
        reasonCode: null,
        guidance: null,
        suggestedQuestions: [],
      },
    });

    try {
      const response = await requestNaturalSelectionApi(
        { request_id: requestId, description: input },
        controller.signal,
      );
      const owned = get();
      if (
        owned.phase !== "select" ||
        owned.selectionMode !== "natural" ||
        owned.naturalLanguage.activeRequestId !== requestId ||
        response.status !== "unavailable" && response.request_id !== requestId
      ) return;

      if (response.status === "unavailable") {
        set({
          naturalLanguage: {
            ...owned.naturalLanguage,
            status: "unavailable",
            activeRequestId: null,
            reasonCode: response.reason_code,
            guidance: response.guidance,
          },
        });
        return;
      }
      if (response.status === "needs_clarification") {
        set({
          naturalLanguage: {
            ...owned.naturalLanguage,
            status: "needs_clarification",
            activeRequestId: null,
            reasonCode: response.reason_code,
            guidance: response.guidance,
            suggestedQuestions: response.suggested_questions,
          },
        });
        return;
      }

      // Ownership was checked before this network fan-out. Check it again before commit.
      const fetched = await Promise.all(
        response.tables.map(async (table) => {
          const { columns } = await fetchTableColumns(table.table_name);
          return [
            table.table_name,
            {
              name: table.table_name,
              columns,
              // The backend has already validated and expanded legal auxiliary fields.
              selectedFields: new Set(table.auxiliary_fields),
            },
          ] as const;
        }),
      );
      const currentAfterColumns = get();
      if (
        currentAfterColumns.phase !== "select" ||
        currentAfterColumns.selectionMode !== "natural" ||
        currentAfterColumns.naturalLanguage.activeRequestId !== requestId
      ) return;
      const selection = new Map<string, SelectedTable>(fetched);
      get().queueAISelection(selection, response.metadata_revision);
      const afterQueue = get();
      set({
        naturalLanguage: {
          ...afterQueue.naturalLanguage,
          status: "selected",
          activeRequestId: null,
          reasonCode: null,
          guidance: null,
          suggestedQuestions: [],
        },
      });
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return;
      const owned = get();
      if (
        owned.phase !== "select" ||
        owned.selectionMode !== "natural" ||
        owned.naturalLanguage.activeRequestId !== requestId
      ) return;
      set({
        naturalLanguage: {
          ...owned.naturalLanguage,
          status: "unavailable",
          activeRequestId: null,
          reasonCode: "REQUEST_FAILED",
          guidance: "当前无法完成自动选取，已有选择未发生变化；可稍后重试或切换到手动选取。",
        },
      });
    } finally {
      if (naturalSelectionAbortController === controller) {
        naturalSelectionAbortController = null;
      }
    }
  },

  queueAISelection: (selection, metadataRevision) => {
    if (get().selectionDirty) {
      set({
        pendingAIReplacement: cloneSelectedTables(selection),
        pendingAIReplacementMetadataRevision: metadataRevision ?? null,
      });
      return;
    }
    get().applyAISelection(selection, metadataRevision ?? "");
  },

  applyAISelection: (selection, metadataRevision) => {
    set({
      selectedTables: cloneSelectedTables(selection),
      previousSelection: cloneSelectedTables(get().selectedTables),
      selectionSource: "ai",
      selectionDirty: false,
      metadataRevision: metadataRevision || null,
      pendingTables: new Set(),
      pendingAIReplacement: null,
      pendingAIReplacementMetadataRevision: null,
    });
  },

  confirmAIReplacement: () => {
    const { pendingAIReplacement, pendingAIReplacementMetadataRevision } = get();
    if (!pendingAIReplacement) return;
    get().applyAISelection(
      pendingAIReplacement,
      pendingAIReplacementMetadataRevision ?? "",
    );
  },

  cancelAIReplacement: () => {
    set({
      pendingAIReplacement: null,
      pendingAIReplacementMetadataRevision: null,
    });
  },

  undoAIReplacement: () => {
    const previousSelection = get().previousSelection;
    if (!previousSelection) return;
    set({
      selectedTables: cloneSelectedTables(previousSelection),
      pendingTables: new Set(),
      tableRequestTokens: new Map(),
      previousSelection: null,
      selectionSource: "manual",
      selectionDirty: true,
      metadataRevision: null,
    });
  },

  // ── 分析操作 ──

  startAnalysis: async () => {
    const { activeSocket, analysisGeneration, pendingTables, selectedTables } =
      get();
    if (pendingTables.size > 0) {
      set({ errorMessage: "正在加载所选表字段，请稍候再开始分析" });
      return;
    }

    // ── 验证 ──
    if (selectedTables.size === 0) {
      set({ errorMessage: "请至少选择一张表" });
      return;
    }

    const selectedEntries = Array.from(selectedTables.values());
    if (
      selectedEntries.some(
        (table) => !table.columns.some((column) => column.is_name),
      )
    ) {
      set({ errorMessage: "缺少业务名称字段。" });
      return;
    }
    if (
      selectedEntries.some(
        (table) => !table.columns.some((column) => column.is_class_name),
      )
    ) {
      set({ errorMessage: "缺少对象类型信息，无法进行主要关系判断。" });
      return;
    }

    const tableList = selectedEntries.map((table) => ({
      name: table.name,
      fields: table.columns
        .filter(
          (column) =>
            isAuxiliaryColumn(column) &&
            table.selectedFields.has(column.name),
        )
        .map((column) => column.name),
    }));

    const runGeneration = analysisGeneration + 1;
    abortNaturalSelectionRequest();
    closeAnalysisSocket(activeSocket);
    set({
      phase: "analyzing",
      errorMessage: null,
      currentPhase: "",
      progressMessage: "正在提交分析任务...",
      progressValue: 0,
      graph: null,
      analysisStatus: null,
      warnings: [],
      diagnostics: null,
      selectedEntityEdgeId: null,
      selectedTableEdgeId: null,
      showIsolatedNodes: false,
      taskId: null,
      hoveredNodeId: null,
      selectedNodeId: null,
      focusNodeRequest: null,
      pendingTables: new Set(),
      tableRequestTokens: new Map(),
      activeSocket: null,
      analysisGeneration: runGeneration,
      naturalLanguage: {
        ...get().naturalLanguage,
        status: "idle",
        activeRequestId: null,
      },
    });

    try {
      const taskId = await submitAnalysis(tableList, get().metadataRevision);
      if (get().analysisGeneration !== runGeneration) return;

      let socket: WebSocket | null = null;
      const ownsRun = () => {
        const state = get();
        return (
          state.analysisGeneration === runGeneration &&
          state.activeSocket === socket
        );
      };
      const finishRun = (
        terminalState: Partial<Pick<
          AnalysisState,
          | "phase"
          | "errorMessage"
          | "graph"
          | "analysisStatus"
          | "warnings"
          | "diagnostics"
          | "currentPhase"
          | "progressValue"
        >>
      ) => {
        if (!ownsRun()) return;
        set({ ...terminalState, activeSocket: null });
        closeAnalysisSocket(socket);
      };

      socket = createAnalysisSocket(
        taskId,
        (msg) => {
          if (!ownsRun()) return;

          if ("status" in msg) {
            const terminalState = {
              analysisStatus: msg.status,
              warnings: msg.warnings,
              diagnostics: msg.diagnostics,
              currentPhase: msg.phase,
              progressValue: msg.progress,
            };
            if (msg.status === "failed") {
              finishRun({
                ...terminalState,
                phase: "error",
                errorMessage: msg.warnings[0] || "分析失败",
                graph: msg.graph,
              });
            } else {
              finishRun({
                ...terminalState,
                phase: "done",
                errorMessage: null,
                graph: msg.graph,
              });
            }
          } else {
            set({
              currentPhase: msg.phase,
              progressMessage: msg.message,
              progressValue: msg.progress,
            });
          }
        },
        (_err) => {
          finishRun({
            phase: "error",
            errorMessage: "WebSocket 连接失败，请检查后端服务是否运行",
            graph: null,
          });
        },
        () => {
          if (!ownsRun()) return;
          const state = get();
          set({ activeSocket: null });
          closeAnalysisSocket(socket);
          if (state.phase === "analyzing") {
            set({
              phase: "error",
              errorMessage: "分析连接意外断开",
            });
          }
        }
      );
      if (get().analysisGeneration !== runGeneration) {
        closeAnalysisSocket(socket);
        return;
      }
      set({ taskId, activeSocket: socket });
    } catch (e: any) {
      if (get().analysisGeneration !== runGeneration) return;
      closeAnalysisSocket(get().activeSocket);
      set({
        phase: "error",
        errorMessage: e.message || "启动分析失败",
        activeSocket: null,
      });
    }
  },

  resetAnalysis: () => {
    abortNaturalSelectionRequest();
    const { activeSocket, analysisGeneration } = get();
    closeAnalysisSocket(activeSocket);
    set({
      phase: "select",
      errorMessage: null,
      currentPhase: "",
      progressMessage: "",
      progressValue: 0,
      graph: null,
      analysisStatus: null,
      warnings: [],
      diagnostics: null,
      taskId: null,
      activeSocket: null,
      analysisGeneration: analysisGeneration + 1,
      hoveredNodeId: null,
      selectedNodeId: null,
      confidenceThreshold: 0,
      showIsolatedNodes: false,
      fitViewRequest: 0,
      relayoutRequest: 0,
      focusNodeRequest: null,
      selectedEntityEdgeId: null,
      selectedTableEdgeId: null,
      pendingTables: new Set(),
      tableRequestTokens: new Map(),
      tableErrors: new Map(),
      naturalLanguage: {
        ...get().naturalLanguage,
        status: "idle",
        activeRequestId: null,
        reasonCode: null,
        guidance: null,
        suggestedQuestions: [],
      },
    });
  },

  // ── 图谱交互操作 ──

  setHoveredNode: (id) => {
    set({ hoveredNodeId: id });
  },

  setSelectedNode: (id) => {
    set({
      selectedNodeId: id,
      ...(id
        ? { selectedEntityEdgeId: null, selectedTableEdgeId: null }
        : {}),
    });
  },

  requestNodeFocus: (id) => {
    set((state) => ({
      selectedNodeId: id,
      selectedEntityEdgeId: null,
      selectedTableEdgeId: null,
      focusNodeRequest: {
        nodeId: id,
        version: (state.focusNodeRequest?.version ?? 0) + 1,
      },
    }));
  },

  setConfidenceThreshold: (value) => {
    set({ confidenceThreshold: value });
  },

  setShowIsolatedNodes: (value) => {
    set({ showIsolatedNodes: value });
  },

  requestFitView: () => {
    set((state) => ({ fitViewRequest: state.fitViewRequest + 1 }));
  },

  requestRelayout: () => {
    set((state) => ({ relayoutRequest: state.relayoutRequest + 1 }));
  },

  selectEntityEdge: (id) => {
    set({
      selectedNodeId: null,
      selectedEntityEdgeId: id,
      selectedTableEdgeId: null,
    });
  },

  selectTableEdge: (id) => {
    set({
      selectedNodeId: null,
      selectedEntityEdgeId: null,
      selectedTableEdgeId: id,
    });
  },
}));
