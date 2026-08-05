import { describe, expect, it } from "vitest";
import { nextSearchIndex, searchNodes } from "./nodeSearch";

describe("graph node search", () => {
  it("matches any normalized keyword and sorts matches by business name then ID", () => {
    const results = searchNodes([
      { id: "b", primary: "订单", secondary: "", className: "Order" },
      { id: "a", primary: "客户账户", secondary: "A-1", className: "Customer" },
      { id: "c", primary: "发票", secondary: "", className: "Invoice" },
    ], "  ＣＵＳＴＯＭＥＲ   发票 ");

    expect(results.map((node) => node.id)).toEqual(["c", "a"]);
  });

  it("sorts matching business names ascending and breaks ties by ID", () => {
    const results = searchNodes([
      { id: "z", primary: "Alpha", secondary: "", className: "Business" },
      { id: "b", primary: "Bravo", secondary: "", className: "Business" },
      { id: "a", primary: "Alpha", secondary: "", className: "Business" },
    ], "business");

    expect(results.map((node) => node.id)).toEqual(["a", "z", "b"]);
  });

  it("wraps navigation after the final result and keeps empty queries empty", () => {
    expect(nextSearchIndex(1, 3)).toBe(2);
    expect(nextSearchIndex(2, 3)).toBe(0);
    expect(nextSearchIndex(0, 0)).toBe(-1);
    expect(searchNodes([{ id: "a", primary: "客户", secondary: "", className: null }], "  ")).toEqual([]);
  });
});
