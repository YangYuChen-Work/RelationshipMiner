import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTableColumns, fetchTables } from "./tables";

describe("tables API errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("turns a plain-text table-list failure into a useful error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    );

    await expect(fetchTables()).rejects.toThrow(
      "\u83b7\u53d6\u8868\u5217\u8868\u5931\u8d25 (HTTP 500)",
    );
  });

  it("uses a structured backend database error when available", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            code: "database_unavailable",
            message: "\u6570\u636e\u5e93\u8fde\u63a5\u4e0d\u53ef\u7528",
          },
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await expect(fetchTableColumns("users")).rejects.toThrow(
      "\u6570\u636e\u5e93\u8fde\u63a5\u4e0d\u53ef\u7528",
    );
  });
});
