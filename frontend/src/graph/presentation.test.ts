import { describe, expect, it } from "vitest";
import { presentEntity } from "./presentation";

describe("presentEntity", () => {
  it.each([
    {
      display_name: "0",
      dimensions: { name: "Reflector component", status: 0 },
      expected: "Reflector component",
    },
    {
      display_name: "0",
      dimensions: { status: 0, item_code: "ITEM0000400" },
      expected: "ITEM0000400",
    },
    {
      display_name: "true",
      dimensions: { enabled: true },
      expected: "42",
    },
  ])("selects a meaningful primary label", ({ display_name, dimensions, expected }) => {
    expect(presentEntity({
      id: "parts:42",
      table_id: "parts",
      display_name,
      class_name: "com.example.ReflectorPart",
      dimensions,
    }, 3).primary).toBe(expected);
  });

  it("uses deterministic dimension selection regardless of insertion order", () => {
    const first = presentEntity({
      id: "parts:42",
      table_id: "parts",
      display_name: "0",
      class_name: "com.example.ReflectorPart",
      dimensions: { title: "Beta", name: "Alpha" },
    }, 3);
    const second = presentEntity({
      id: "parts:42",
      table_id: "parts",
      display_name: "0",
      class_name: "com.example.ReflectorPart",
      dimensions: { name: "Alpha", title: "Beta" },
    }, 3);

    expect(first.primary).toBe("Alpha");
    expect(second.primary).toBe(first.primary);
  });

  it("safely decodes an ID suffix when semantic text is unavailable", () => {
    const presentation = presentEntity({
      id: "parts:Reflector%20Part%2F42%",
      table_id: "parts",
      display_name: "undefined",
      class_name: null,
      dimensions: {},
    }, 3);

    expect(presentation.primary).toBe("Reflector%20Part%2F42%");
  });

  it("uses a non-duplicate secondary type source", () => {
    const presentation = presentEntity({
      id: "parts:42",
      table_id: "parts",
      display_name: "ReflectorPart",
      class_name: "com.example.ReflectorPart",
      dimensions: {},
    }, 3);

    expect(presentation.secondary).toBe("parts");
    expect(presentation.secondary).not.toBe(presentation.primary);
  });

  it("caps visible lines while preserving their full accessible label", () => {
    const fullName = "A".repeat(50);
    const presentation = presentEntity({
      id: "parts:42",
      table_id: "parts",
      display_name: fullName,
      class_name: "com.example.ReflectorPart",
      dimensions: {},
    }, 3);

    expect(Array.from(presentation.primary)).toHaveLength(42);
    expect(presentation.primary).toBe("A".repeat(42));
    expect(presentation.accessibleLabel).toBe(`${fullName}; ReflectorPart`);
  });
});
