/** API 层 — 分析任务提交与 WebSocket 进度。 */

export interface TableSelection {
  name: string;
  fields: string[];
}

export interface NodeData {
  id: string;
  source_table: string;
  class_name: string | null;
  field_values: Record<string, unknown>;
  degree: number;
}

export interface EdgeData {
  source: string;
  target: string;
  labels: string[];
  confidence: number;
}

export interface GraphData {
  nodes: NodeData[];
  edges: EdgeData[];
}

export interface ProgressMessage {
  phase: number;
  message: string;
  progress: number;
  graph?: GraphData;
  error?: string;
}

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
      // Ignore malformed messages
    }
  };

  ws.onerror = onError;
  ws.onclose = onClose;

  return ws;
}
