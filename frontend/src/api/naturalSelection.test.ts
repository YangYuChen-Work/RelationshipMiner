import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseNaturalSelectionResponse,
  requestNaturalSelection,
} from "./naturalSelection";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("natural language selection API", () => {
  it("sends only the public request id and description", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "selected",
          request_id: "request-1",
          metadata_revision: "meta-1",
          glossary_version: "glossary-1",
          selector_version: "selector-1",
          tables: [],
          warnings: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await requestNaturalSelection(
      { request_id: "request-1", description: "分析订单" },
      new AbortController().signal,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/natural-language-selection",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ request_id: "request-1", description: "分析订单" }),
      }),
    );
  });

  it("keeps the public unavailable payload typed", async () => {
    await expect(
      parseNaturalSelectionResponse(
        new Response(
          JSON.stringify({
            status: "unavailable",
            reason_code: "MODEL_UNAVAILABLE",
            guidance: "请稍后重试",
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      ),
    ).resolves.toMatchObject({ status: "unavailable", reason_code: "MODEL_UNAVAILABLE" });
  });

  it("rejects an unknown successful response status", async () => {
    await expect(
      parseNaturalSelectionResponse(
        new Response(JSON.stringify({ status: "unknown" }), { status: 200 }),
      ),
    ).rejects.toThrow("响应状态无效");
  });
});
