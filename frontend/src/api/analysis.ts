/** API 层 — 分析任务提交与 WebSocket 进度。 */

export interface TableSelection {
  name: string;
  fields: string[];
}

export type AnalysisStatus = "complete" | "partial" | "failed";

export interface TableNodeData {
  id: string;
  display_name: string;
  entity_count: number;
}

export interface EntityNodeData {
  id: string;
  table_id: string;
  display_name: string;
  /** Present on current payloads whose display name was derived from `name`. */
  display_name_source?: "name";
  display_code?: string | null;
  class_name: string | null;
  dimensions: Record<string, unknown>;
}

export interface RelationEvidenceData {
  source_field: string;
  source_value: unknown;
  target_field: string;
  target_value: unknown;
  method: "foreign_key" | "unique_identifier" | "relation_table" | "llm_semantic_reasoning";
  reason: string;
}

export interface EntityRelationData {
  source: string;
  target: string;
  relation_type: string;
  /** Optional while loading graph snapshots created before business labels. */
  display_label?: string;
  direction: "source_to_target" | "target_to_source" | "undirected";
  strength: "strong" | "weak";
  confidence: number;
  explanation: string;
  evidence: RelationEvidenceData[];
  model_id: string | null;
  task_id: string | null;
}

export interface EntityEdgeData {
  id: string;
  source: string;
  target: string;
  relations: EntityRelationData[];
}

export interface TableEdgeData {
  id: string;
  source_table: string;
  target_table: string;
  relation_types: string[];
  strong_count: number;
  weak_count: number;
  entity_edge_count: number;
  average_confidence: number;
  supporting_entity_edges: string[];
}

export interface SemanticGraphData {
  table_nodes: TableNodeData[];
  entity_nodes: EntityNodeData[];
  table_edges: TableEdgeData[];
  entity_edges: EntityEdgeData[];
}

export interface AnalysisDiagnostics {
  entities_read: number;
  plans_created: number;
  candidates_retrieved: number;
  candidates_completed: number;
  candidates_pending: number;
  /** Present when a producer can distinguish failed judgements from pending work. */
  candidates_failed?: number;
  strong_edges_created: number;
  weak_edges_created: number;
}

export interface AnalysisProgressMessage {
  phase: string;
  message: string;
  progress: number;
}

export interface AnalysisTerminalMessage {
  phase: "complete";
  progress: number;
  status: AnalysisStatus;
  graph: SemanticGraphData;
  diagnostics: AnalysisDiagnostics;
  warnings: string[];
}

export type ProgressMessage = AnalysisProgressMessage | AnalysisTerminalMessage;

const BASE = "/api";

export async function submitAnalysis(
  tables: TableSelection[]
): Promise<string> {
  const res = await fetch(`${BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tables }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail =
      typeof err?.detail === "string"
        ? err.detail
        : err?.detail?.detail || "提交分析任务失败";
    throw new Error(detail);
  }
  const data = await res.json();
  return data.task_id;
}

export function createAnalysisSocket(
  taskId: string,
  onMessage: (msg: ProgressMessage) => void,
  onError: (err: Event) => void,
  onClose: () => void
): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.host;
  const url = `${protocol}://${host}/api/ws/analyze/${taskId}`;

  const ws = new WebSocket(url);

  ws.onmessage = (event) => {
    try {
      const msg: ProgressMessage = JSON.parse(event.data);
      onMessage(msg);
    } catch {
      onError(new Event("error"));
    }
  };

  ws.onerror = onError;
  ws.onclose = onClose;

  return ws;
}
