/** Zustand 全局状态 — 分析配置与执行。 */

import { create } from "zustand";
import type { TableInfo, ColumnInfo } from "../api/tables";
import type { GraphData } from "../api/analysis";
import { fetchTables, fetchTableColumns } from "../api/tables";
import { submitAnalysis, createAnalysisSocket } from "../api/analysis";

export type Phase = "select" | "analyzing" | "done" | "error";

interface SelectedTable {
  name: string;
  columns: ColumnInfo[];
  selectedFields: Set<string>;
}

export function isRequiredColumn(column: ColumnInfo): boolean {
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
  tableErrors: Map<string, string>;
  maxTables: number;

  // ── 分析进度 ──
  currentPhase: number;
  progressMessage: string;
  progressValue: number;

  // ── 图谱数据 ──
  graph: GraphData | null;
  taskId: string | null;

  // ── 图谱交互状态 ──
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
  confidenceThreshold: number;
  fitViewRequest: number;
  relayoutRequest: number;

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
  setConfidenceThreshold: (value: number) => void;
  requestFitView: () => void;
  requestRelayout: () => void;
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

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  // ── 初始值 ──
  phase: "select",
  errorMessage: null,
  tables: [],
  tablesLoading: false,
  tablesError: null,
  selectedTables: new Map(),
  tableErrors: new Map(),
  maxTables: 10,
  currentPhase: 0,
  progressMessage: "",
  progressValue: 0,
  graph: null,
  taskId: null,
  hoveredNodeId: null,
  selectedNodeId: null,
  confidenceThreshold: 0,
  fitViewRequest: 0,
  relayoutRequest: 0,

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
    const { selectedTables } = get();
    if (selectedTables.has(tableName)) {
      const next = new Map(selectedTables);
      next.delete(tableName);
      set({ selectedTables: next });
    } else {
      if (selectedTables.size >= get().maxTables) return;
      try {
        const { columns } = await fetchTableColumns(tableName);
        const requiredFields = columns.filter(isRequiredColumn);
        const selectedFields = new Set(requiredFields.map((c) => c.name));
        const currentSelectedTables = get().selectedTables;
        if (currentSelectedTables.size >= get().maxTables) return;
        const next = new Map(currentSelectedTables);
        const tableErrors = new Map(get().tableErrors);
        tableErrors.delete(tableName);
        next.set(tableName, {
          name: tableName,
          columns,
          selectedFields,
        });
        set({ selectedTables: next, tableErrors });
      } catch (e: any) {
        const tableErrors = new Map(get().tableErrors);
        tableErrors.set(
          tableName,
          e.message || `加载表 ${tableName} 字段失败`
        );
        set({ tableErrors });
      }
    }
  },

  toggleField: (tableName: string, fieldName: string) => {
    const { selectedTables } = get();
    const entry = selectedTables.get(tableName);
    if (!entry) return;

    const col = entry.columns.find((c) => c.name === fieldName);
    if (col && isRequiredColumn(col)) return;

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
      selectedFields: new Set(e.columns.map((c) => c.name)),
    }));
    set({ selectedTables: next });
  },

  deselectAllFields: (tableName: string) => {
    const { selectedTables } = get();
    const next = patchSelectedTable(selectedTables, tableName, (e) => ({
      ...e,
      selectedFields: new Set(
        e.columns.filter(isRequiredColumn).map((c) => c.name)
      ),
    }));
    set({ selectedTables: next });
  },

  // ── 分析操作 ──

  startAnalysis: async () => {
    const { selectedTables } = get();
    const tableList = Array.from(selectedTables.values()).map((t) => ({
      name: t.name,
      fields: Array.from(t.selectedFields),
    }));

    // ── 验证 ──
    if (tableList.length === 0) {
      set({ errorMessage: "请至少选择一张表" });
      return;
    }

    set({
      phase: "analyzing",
      errorMessage: null,
      currentPhase: 0,
      progressMessage: "正在提交分析任务...",
      progressValue: 0,
    });

    try {
      const taskId = await submitAnalysis(tableList);
      set({ taskId });

      createAnalysisSocket(
        taskId,
        (msg) => {
          set({
            currentPhase: msg.phase,
            progressMessage: msg.message,
            progressValue: msg.progress,
          });

          if (msg.phase === 5 && msg.graph) {
            set({
              phase: "done",
              graph: msg.graph,
            });
          }

          if (msg.error) {
            set({
              phase: "error",
              errorMessage: msg.error || msg.message,
            });
          }
        },
        (_err) => {
          set({
            phase: "error",
            errorMessage: "WebSocket 连接失败，请检查后端服务是否运行",
          });
        },
        () => {
          const state = get();
          if (state.phase === "analyzing") {
            set({
              phase: "error",
              errorMessage: "分析连接意外断开",
            });
          }
        }
      );
    } catch (e: any) {
      set({
        phase: "error",
        errorMessage: e.message || "启动分析失败",
      });
    }
  },

  resetAnalysis: () => {
    set({
      phase: "select",
      errorMessage: null,
      currentPhase: 0,
      progressMessage: "",
      progressValue: 0,
      graph: null,
      taskId: null,
      hoveredNodeId: null,
      selectedNodeId: null,
      confidenceThreshold: 0,
      fitViewRequest: 0,
      relayoutRequest: 0,
      tableErrors: new Map(),
    });
  },

  // ── 图谱交互操作 ──

  setHoveredNode: (id) => {
    set({ hoveredNodeId: id });
  },

  setSelectedNode: (id) => {
    set({ selectedNodeId: id });
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
}));
