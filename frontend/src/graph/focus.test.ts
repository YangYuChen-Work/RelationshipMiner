import { describe, expect, it } from "vitest";
import type { EntityEdgeData } from "../api/analysis";
import { buildGraphFocusIndex, resolveGraphFocus } from "./focus";

const edges: EntityEdgeData[] = [
  {
    id: "ab",
    source: "a",
    target: "b",
    relations: [{
      source: "a",
      target: "b",
      relation_type: "links",
      direction: "source_to_target",
      strength: "strong",
      confidence: 0,
      explanation: "",
      evidence: [],
      model_id: null,
      task_id: null,
    }],
  },
  {
    id: "bc",
    source: "b",
    target: "c",
    relations: [{
      source: "b",
      target: "c",
      relation_type: "links",
      direction: "source_to_target",
      strength: "weak",
      confidence: 0.6,
      explanation: "",
      evidence: [],
      model_id: null,
      task_id: null,
    }],
  },
];

describe("graph focus", () => {
  it("includes only direct visible neighbors and their edges", () => {
    const index = buildGraphFocusIndex(edges, 0.5);

    expect([...resolveGraphFocus(index, "a", null).nodeIds].sort()).toEqual(["a", "b"]);
    expect([...resolveGraphFocus(index, "a", null).edgeIds]).toEqual(["ab"]);
    expect(resolveGraphFocus(index, "b", null).nodeIds.has("c")).toBe(true);
  });

  it("removes weak edges below the confidence threshold while retaining strong edges", () => {
    const index = buildGraphFocusIndex(edges, 0.7);

    expect([...resolveGraphFocus(index, "a", null).edgeIds]).toEqual(["ab"]);
    expect([...resolveGraphFocus(index, "b", null).nodeIds].sort()).toEqual(["a", "b"]);
  });

  it("prefers the hovered node over the selected node", () => {
    const index = buildGraphFocusIndex(edges, 0.5);

    expect(resolveGraphFocus(index, "a", "c").activeNodeId).toBe("a");
  });

  it("returns empty focus when neither hover nor selection is active", () => {
    const index = buildGraphFocusIndex(edges, 0.5);

    const focus = resolveGraphFocus(index, null, null);
    expect(focus.activeNodeId).toBeNull();
    expect([...focus.nodeIds]).toEqual([]);
    expect([...focus.edgeIds]).toEqual([]);
  });

  it("does not expose mutable adjacency maps or sets", () => {
    const index = buildGraphFocusIndex(edges, 0.5);

    expect(() => (index.neighborsByNode as Map<string, Set<string>>).set("a", new Set(["c"]))).toThrow();
    expect(() => (index.neighborsByNode.get("a") as Set<string>).add("c")).toThrow();
    expect([...index.neighborsByNode.get("a") ?? []].sort()).toEqual(["b"]);
  });
});
