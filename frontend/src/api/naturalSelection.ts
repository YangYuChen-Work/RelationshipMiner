/** Typed client for the safe natural-language data selection endpoint. */

export interface NaturalLanguageSelectionRequest {
  request_id: string;
  description: string;
}

export interface NaturalLanguageSelectedTable {
  table_name: string;
  auxiliary_fields: string[];
  reason: string;
  matched_terms: string[];
}

interface NaturalSelectionBaseResponse {
  request_id: string;
  metadata_revision: string;
  glossary_version: string;
  selector_version: string;
}

export interface SelectedResponse extends NaturalSelectionBaseResponse {
  status: "selected";
  tables: NaturalLanguageSelectedTable[];
  warnings: string[];
}

export interface ClarificationResponse extends NaturalSelectionBaseResponse {
  status: "needs_clarification";
  tables: NaturalLanguageSelectedTable[];
  reason_code: string;
  guidance: string;
  suggested_questions: string[];
  warnings: string[];
}

export interface UnavailableResponse {
  status: "unavailable";
  reason_code: string;
  guidance: string;
}

export type NaturalSelectionResponse =
  | SelectedResponse
  | ClarificationResponse
  | UnavailableResponse;

function responseMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const message = (payload as { message?: unknown; detail?: unknown }).message;
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof message === "string" && message.trim()) return message;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}

export async function parseNaturalSelectionResponse(
  response: Response,
): Promise<NaturalSelectionResponse> {
  const payload: unknown = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || !("status" in payload)) {
    if (!response.ok) {
      throw new Error(responseMessage(payload, "自动选取请求失败"));
    }
    throw new Error("自动选取响应格式无效");
  }
  const status = (payload as { status: unknown }).status;
  if (
    status !== "selected" &&
    status !== "needs_clarification" &&
    status !== "unavailable"
  ) {
    throw new Error("自动选取响应状态无效");
  }
  if (!response.ok && status !== "unavailable") {
    throw new Error(responseMessage(payload, "自动选取请求失败"));
  }
  return payload as NaturalSelectionResponse;
}

export async function requestNaturalSelection(
  request: NaturalLanguageSelectionRequest,
  signal: AbortSignal,
): Promise<NaturalSelectionResponse> {
  const response = await fetch("/api/natural-language-selection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request_id: request.request_id,
      description: request.description,
    }),
    signal,
  });
  return parseNaturalSelectionResponse(response);
}
