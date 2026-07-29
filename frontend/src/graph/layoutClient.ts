import type { GraphLayout, LayoutGraph, Viewport } from "./layout";

interface LayoutWorkerRequest {
  requestId: number;
  graph: LayoutGraph;
  viewport: Viewport;
}

interface LayoutWorkerResponse {
  requestId: number;
  layout?: GraphLayout;
  error?: string;
}

export class StaleLayoutRequestError extends Error {
  constructor() {
    super("The graph layout request was superseded or reset.");
    this.name = "StaleLayoutRequestError";
  }
}

export class LayoutClientDisposedError extends Error {
  constructor() {
    super("The graph layout client has been disposed.");
    this.name = "LayoutClientDisposedError";
  }
}

type PendingLayout = {
  resolve: (layout: GraphLayout) => void;
  reject: (reason: unknown) => void;
};

export class LayoutClient {
  private readonly worker: Worker;
  private nextRequestId = 0;
  private disposed = false;
  private readonly pending = new Map<number, PendingLayout>();

  constructor(worker?: Worker) {
    this.worker =
      worker ??
      new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<LayoutWorkerResponse>) => {
      this.receive(event.data);
    };
    this.worker.onerror = () => {
      this.rejectAll(new Error("The graph layout worker failed."));
    };
  }

  layoutGraph(graph: LayoutGraph, viewport: Viewport): Promise<GraphLayout> {
    if (this.disposed) return Promise.reject(new LayoutClientDisposedError());

    this.rejectAll(new StaleLayoutRequestError());
    const requestId = ++this.nextRequestId;
    return new Promise<GraphLayout>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        const request: LayoutWorkerRequest = { requestId, graph, viewport };
        this.worker.postMessage(request);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  /** Rejects in-flight graph work; late worker responses have no pending owner. */
  reset() {
    this.rejectAll(new StaleLayoutRequestError());
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.rejectAll(new LayoutClientDisposedError());
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
  }

  private receive(response: LayoutWorkerResponse) {
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    if (response.error) {
      pending.reject(new Error(response.error));
      return;
    }
    if (!response.layout) {
      pending.reject(new Error("The graph layout worker returned no layout."));
      return;
    }
    pending.resolve(response.layout);
  }

  private rejectAll(error: Error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}

let sharedClient: LayoutClient | null = null;

export function layoutGraph(graph: LayoutGraph, viewport: Viewport) {
  sharedClient ??= new LayoutClient();
  return sharedClient.layoutGraph(graph, viewport);
}

export function resetLayoutGraph() {
  sharedClient?.reset();
}

export function disposeLayoutGraph() {
  sharedClient?.dispose();
  sharedClient = null;
}
