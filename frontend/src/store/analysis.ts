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

interface AnalysisState {
  // ── 阶段 ──
  phase: Phase;
  errorMessage: string | null;

  // ── 数据库元数据 ──
  tables: TableInfo[];
  tablesLoading: boolean;

  // ── 用户选择 ──
  selectedTables: Map<string, SelectedTable>;
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
  detailPanelNodeId: string | null;
  confidenceThreshold: number;

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
  openDetailPanel: (id: string) => void;
  closeDetailPanel: () => void;
  setConfidenceThreshold: (value: number) => void;
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
  selectedTables: new Map(),
  maxTables: 10,
  currentPhase: 0,
  progressMessage: "",
  progressValue: 0,
  graph: null,
  taskId: null,
  hoveredNodeId: null,
  selectedNodeId: null,
  detailPanelNodeId: null,
  confidenceThreshold: 0,

  // ── 元数据操作 ──

  loadTables: async () => {
    const { tables, tablesLoading } = get();
    // 避免重复加载：表已加载或正在加载时跳过
    if (tables.length > 0 || tablesLoading) return;

    set({ tablesLoading: true });
    try {
      const result = await fetchTables();
      set({ tables: result, tablesLoading: false, errorMessage: null });
    } catch (e: any) {
      set({
        errorMessage: e.message || "无法加载表列表",
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
        const classFields = columns.filter((c) => c.is_class_name);
        const selectedFields = new Set(classFields.map((c) => c.name));
        const next = new Map(selectedTables);
        next.set(tableName, {
          name: tableName,
          columns,
          selectedFields,
        });
        set({ selectedTables: next });
      } catch (e: any) {
        set({ errorMessage: e.message || `加载表 ${tableName} 字段失败` });
      }
    }
  },

  toggleField: (tableName: string, fieldName: string) => {
    const { selectedTables } = get();
    const entry = selectedTables.get(tableName);
    if (!entry) return;

    const col = entry.columns.find((c) => c.name === fieldName);
    if (col?.is_class_name) return;

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
        e.columns.filter((c) => c.is_class_name).map((c) => c.name)
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

    // 验证每张表都有 class_name 字段
    const missingClassNames = tableList.filter((t) => {
      const entry = selectedTables.get(t.name);
      if (!entry) return true;
      return !entry.columns.some(
        (c) => c.is_class_name && t.fields.includes(c.name)
      );
    });
    if (missingClassNames.length > 0) {
      set({
        errorMessage: `表 "${missingClassNames.map((t) => t.name).join("、")}" 缺少 class_name 字段，请确保每张表都包含 class_name 相关字段`,
      });
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
      detailPanelNodeId: null,
      confidenceThreshold: 0,
    });
  },

  // ── 图谱交互操作 ──

  setHoveredNode: (id) => {
    set({ hoveredNodeId: id });
  },

  setSelectedNode: (id) => {
    set({ selectedNodeId: id });
  },

  openDetailPanel: (id) => {
    set({ detailPanelNodeId: id });
  },

  closeDetailPanel: () => {
    set({ detailPanelNodeId: null });
  },

  setConfidenceThreshold: (value) => {
    set({ confidenceThreshold: value });
  },
}));
