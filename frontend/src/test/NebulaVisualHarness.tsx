import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CanvasErrorBoundary from "../components/CanvasErrorBoundary";
import GraphCanvas from "../components/GraphCanvas";
import { useAnalysisStore } from "../store/analysis";
import { makeNebulaGraph } from "./nebulaFixtures";

const FIXTURES = {
  20: makeNebulaGraph({ entityCount: 20 }),
  200: makeNebulaGraph({ entityCount: 200 }),
} as const;

function requestedEntityCount(search: string): 20 | 200 {
  return new URLSearchParams(search).get("size") === "200" ? 200 : 20;
}

function bridgeNodeId(entityCount: 20 | 200): string {
  return `entity-${String(entityCount / 4 - 1).padStart(3, "0")}`;
}

function loadFixture(entityCount: 20 | 200): void {
  const graph = FIXTURES[entityCount];
  if (useAnalysisStore.getState().graph === graph) return;
  useAnalysisStore.setState({
    phase: "done",
    errorMessage: null,
    graph,
    analysisStatus: "complete",
    warnings: [],
    diagnostics: null,
    hoveredNodeId: null,
    selectedNodeId: null,
    confidenceThreshold: 0,
    showIsolatedNodes: false,
    fitViewRequest: 0,
    relayoutRequest: 0,
    focusNodeRequest: null,
    selectedEntityEdgeId: null,
    selectedTableEdgeId: null,
  });
}

export function NebulaVisualHarness() {
  const entityCount = requestedEntityCount(window.location.search);
  loadFixture(entityCount);
  const hoveredNodeId = useAnalysisStore((state) => state.hoveredNodeId);
  const selectedNodeId = useAnalysisStore((state) => state.selectedNodeId);
  const setHoveredNode = useAnalysisStore((state) => state.setHoveredNode);
  const setSelectedNode = useAnalysisStore((state) => state.setSelectedNode);
  const targetNodeId = bridgeNodeId(entityCount);

  return (
    <main
      className="nebula-visual-shell"
      data-visual-size={entityCount}
      data-visual-theme="light-business"
    >
      <header className="nebula-visual-header">
        <div>
          <p className="nebula-visual-kicker">Semantic graph visual fixture</p>
          <h1>{entityCount} entities</h1>
        </div>
        <div
          className="nebula-visual-controls"
          role="group"
          aria-label="Visual test controls"
        >
          <button
            type="button"
            aria-pressed={hoveredNodeId === targetNodeId}
            onClick={() => {
              setSelectedNode(null);
              setHoveredNode(targetNodeId);
            }}
          >
            Hover bridge
          </button>
          <button
            type="button"
            aria-pressed={selectedNodeId === targetNodeId}
            onClick={() => {
              setHoveredNode(null);
              setSelectedNode(targetNodeId);
            }}
          >
            Select bridge
          </button>
          <button
            type="button"
            onClick={() => {
              setHoveredNode(null);
              setSelectedNode(null);
            }}
          >
            Clear focus
          </button>
        </div>
      </header>
      <section className="nebula-visual-stage" aria-label="Nebula graph fixture">
        <CanvasErrorBoundary>
          <GraphCanvas suppressStatusOverlay />
        </CanvasErrorBoundary>
      </section>
    </main>
  );
}

const harnessRoot = document.querySelector<HTMLElement>(
  "[data-nebula-visual-root]",
);
if (harnessRoot) {
  createRoot(harnessRoot).render(
    <StrictMode>
      <NebulaVisualHarness />
    </StrictMode>,
  );
}
