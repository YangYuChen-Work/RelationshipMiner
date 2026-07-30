import {
  computeFallbackScatterLayout,
  computeNebulaLayout,
  type LayoutGraph,
  type Viewport,
} from "./layout";

interface LayoutWorkerRequest {
  requestId: number;
  graph: LayoutGraph;
  viewport: Viewport;
  seedOffset?: number;
}

self.onmessage = (event: MessageEvent<LayoutWorkerRequest>) => {
  const { requestId, graph, viewport, seedOffset } = event.data;
  try {
    self.postMessage({
      requestId,
      layout: computeNebulaLayout(graph, viewport, { seedOffset }),
    });
  } catch (simulationError) {
    try {
      self.postMessage({
        requestId,
        layout: computeFallbackScatterLayout(
          graph,
          viewport,
          { seedOffset },
        ),
      });
    } catch (fallbackError) {
      const simulationMessage = simulationError instanceof Error
        ? simulationError.message
        : "Unable to compute graph layout";
      const fallbackMessage = fallbackError instanceof Error
        ? fallbackError.message
        : "Unable to compute fallback graph layout";
      self.postMessage({
        requestId,
        error: `${simulationMessage}; fallback failed: ${fallbackMessage}`,
      });
    }
  }
};
