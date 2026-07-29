/** Zustand 全局状态 — 分析配置与执行。 */

import { create } from "zustand";
import type { TableInfo, ColumnInfo } from "../api/tables";
import type {
  AnalysisDiagnostics,
  AnalysisStatus,
  SemanticGraphData,
} from "../api/analysis";
import { fetchTables, fetchTableColumns } from "../api/tables";
import { submitAnalysis, createAnalysisSocket } from "../api/analysis";

export type Phase = "select" | "analyzing" | "done" | "error";

interface SelectedTable {
  name: string;
  columns: ColumnInfo[];
  selectedFields: Set<string>;
}

interface FocusNodeRequest {
  nodeId: string;
  version: number;
}

export function isSystemColumn(column: ColumnInfo): boolean {
  return column.is_class_name || column.is_primary_key;
}

interface AnalysisState {
  // ── 阶段 ──
  phase: Phase;
  errorMessage: string | null;

  // ── 数据库元数据 ──
  tables: TableInfo[];
  tablesLoading: boolean;
  tablesError: string | null;

  // ── 用户选择 ──
  selectedTables: Map<string, SelectedTable>;
  pendingTables: Set<string>;
  tableRequestTokens: Map<string, number>;
  tableErrors: Map<string, string>;
  maxTables: number;

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
  fitViewRequest: number;
  relayoutRequest: number;
  focusNodeRequest: FocusNodeRequest | null;
  selectedEntityEdgeId: string | null;
  selectedTableEdgeId: string | null;

  // ── 操作：元数据 ──
  loadTables: () => Promise<void>;
  toggleTable: (tableName: string) => Promise<void>;
  toggleField: (tableName: string, fieldName: string) => void;
  selectAllFields: (tableName: string) => void;
  deselectAllFields: (tableName: string) => void;

  // ── 操作：分析 ──
  startAnalysis: () => Promise<void>;
  resetAnalysis: () => void;

  // ── 操作：图谱交互 ──
  setHoveredNode: (id: string | null) => void;
  setSelectedNode: (id: string | null) => void;
  requestNodeFocus: (id: string) => void;
  setConfidenceThreshold: (value: number) => void;
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

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  // ── 初始值 ──
  phase: "select",
  errorMessage: null,
  tables: [],
  tablesLoading: false,
  tablesError: null,
  selectedTables: new Map(),
  pendingTables: new Set(),
  tableRequestTokens: new Map(),
  tableErrors: new Map(),
  maxTables: 10,
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
    } catch (e: any) {
      set({
        tablesError: e.message || "无法加载表列表",
        tablesLoading: false,
      });
    }
  },

  toggleTable: async (tableName: string) => {
    const { pendingTables, phase, selectedTables } = get();
    if (phase !== "select" || pendingTables.has(tableName)) return;

    if (selectedTables.has(tableName)) {
      const next = new Map(selectedTables);
      next.delete(tableName);
      set({ selectedTables: next });
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
    if (!col || isSystemColumn(col)) return;

    const next = patchSelectedTable(selectedTables, tableName, (e) => {
      const nextFields = new Set(e.selectedFields);
      if (nextFields.has(fieldName)) {
        nextFields.delete(fieldName);
      } else {
        nextFields.add(fieldName);
      }
      return { ...e, selectedFields: nextFields };
    });
    set({ selectedTables: next });
  },

  selectAllFields: (tableName: string) => {
    const { selectedTables } = get();
    const next = patchSelectedTable(selectedTables, tableName, (e) => ({
      ...e,
      selectedFields: new Set(
        e.columns.filter((column) => !isSystemColumn(column)).map((column) => column.name)
      ),
    }));
    set({ selectedTables: next });
  },

  deselectAllFields: (tableName: string) => {
    const { selectedTables } = get();
    const next = patchSelectedTable(selectedTables, tableName, (e) => ({
      ...e,
      selectedFields: new Set(),
    }));
    set({ selectedTables: next });
  },

  // ── 分析操作 ──

  startAnalysis: async () => {
    const { activeSocket, analysisGeneration, pendingTables, selectedTables } =
      get();
    if (pendingTables.size > 0) {
      set({ errorMessage: "正在加载所选表字段，请稍候再开始分析" });
      return;
    }

    const tableList = Array.from(selectedTables.values()).map((t) => ({
      name: t.name,
      fields: t.columns
        .filter((column) => !isSystemColumn(column) && t.selectedFields.has(column.name))
        .map((column) => column.name),
    }));

    // ── 验证 ──
    if (tableList.length === 0) {
      set({ errorMessage: "请至少选择一张表" });
      return;
    }

    const runGeneration = analysisGeneration + 1;
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
      taskId: null,
      hoveredNodeId: null,
      selectedNodeId: null,
      focusNodeRequest: null,
      pendingTables: new Set(),
      tableRequestTokens: new Map(),
      activeSocket: null,
      analysisGeneration: runGeneration,
    });

    try {
      const taskId = await submitAnalysis(tableList);
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
      fitViewRequest: 0,
      relayoutRequest: 0,
      focusNodeRequest: null,
      selectedEntityEdgeId: null,
      selectedTableEdgeId: null,
      pendingTables: new Set(),
      tableRequestTokens: new Map(),
      tableErrors: new Map(),
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
