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
  private workerTerminated = false;
  private unavailableError: Error | null = null;
  private readonly pending = new Map<number, PendingLayout>();

  constructor(worker?: Worker) {
    this.worker =
      worker ??
      new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<LayoutWorkerResponse>) => {
      this.receive(event.data);
    };
    this.worker.onerror = () => {
      this.failWorker(new Error("The graph layout worker failed."));
    };
    this.worker.onmessageerror = () => {
      this.failWorker(
        new Error("The graph layout worker failed to deserialize a message."),
      );
    };
  }

  layoutGraph(graph: LayoutGraph, viewport: Viewport): Promise<GraphLayout> {
    if (this.disposed) return Promise.reject(new LayoutClientDisposedError());
    if (this.unavailableError) return Promise.reject(this.unavailableError);

    const requestId = ++this.nextRequestId;
    return new Promise<GraphLayout>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        const request: LayoutWorkerRequest = { requestId, graph, viewport };
        this.worker.postMessage(request);
      } catch (error) {
        this.failWorker(
          error instanceof Error
            ? error
            : new Error("The graph layout worker rejected a request."),
        );
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
    this.detachWorker();
    this.terminateWorker();
  }

  private failWorker(error: Error) {
    if (this.disposed || this.unavailableError) return;
    this.unavailableError = error;
    this.rejectAll(error);
    this.detachWorker();
    this.terminateWorker();
  }

  private detachWorker() {
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
  }

  private terminateWorker() {
    if (this.workerTerminated) return;
    this.workerTerminated = true;
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

export function createLayoutClient(worker?: Worker): LayoutClient {
  return new LayoutClient(worker);
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
