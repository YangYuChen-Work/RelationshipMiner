import { computeGroupedLayout, type LayoutGraph, type Viewport } from "./layout";

interface LayoutWorkerRequest {
  requestId: number;
  graph: LayoutGraph;
  viewport: Viewport;
}

self.onmessage = (event: MessageEvent<LayoutWorkerRequest>) => {
  const { requestId, graph, viewport } = event.data;
  try {
    self.postMessage({ requestId, layout: computeGroupedLayout(graph, viewport) });
  } catch (error) {
    self.postMessage({
      requestId,
      error: error instanceof Error ? error.message : "Unable to compute graph layout",
    });
  }
};
