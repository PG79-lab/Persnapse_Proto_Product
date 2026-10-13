export interface InferenceOutput {
  id: string;
  type: "output";
  dims: number[];
  data: Float32Array;
  inferenceMs: number;
}

/** Low-level compatibility client; model predictions are not yet safe card candidates. */
export class CardInferenceClient {
  private worker: Worker | null = null;
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
    }
  >();

  private start() {
    if (this.worker) return this.worker;
    const worker = new Worker("/vendor/card-inference-worker.js", {
      type: "module",
    });
    worker.onmessage = (
      event: MessageEvent<{ id: string; type: string; reason?: string }>,
    ) => {
      const request = this.pending.get(event.data.id);
      if (!request) return;
      this.pending.delete(event.data.id);
      request.cleanup();
      if (event.data.type === "error")
        request.reject(new Error(event.data.reason));
      else request.resolve(event.data);
    };
    worker.onerror = () =>
      this.dispose(new Error("Inference Worker unavailable"));
    this.worker = worker;
    return worker;
  }

  private call(
    message: Record<string, unknown>,
    timeout: number,
    signal?: AbortSignal,
    transfers: Transferable[] = [],
  ) {
    signal?.throwIfAborted();
    const worker = this.start();
    return new Promise<unknown>((resolve, reject) => {
      const id = crypto.randomUUID();
      const cancel = () => this.dispose(new Error("Inference cancelled"));
      const timer = setTimeout(
        () => this.dispose(new Error("Inference timed out")),
        timeout,
      );
      this.pending.set(id, {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", cancel);
        },
      });
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        worker.postMessage({ ...message, id }, transfers);
      } catch (error) {
        this.dispose(
          error instanceof Error
            ? error
            : new Error("Inference message failed"),
        );
      }
    });
  }

  prepare(modelUrl: string, signal?: AbortSignal) {
    return this.call({ type: "prepare", modelUrl }, 20_000, signal);
  }
  async preprocess(
    rgba: Uint8Array,
    width: number,
    height: number,
    signal?: AbortSignal,
  ): Promise<Float32Array> {
    const pixels = new Uint8Array(rgba);
    const result = (await this.call(
      { type: "preprocess", rgba: pixels, width, height },
      15_000,
      signal,
      [pixels.buffer],
    )) as { data: Float32Array };
    return result.data;
  }
  async corners(
    heatmap: Float32Array,
    dims: readonly number[],
    width: number,
    height: number,
    signal?: AbortSignal,
  ) {
    const tensor = new Float32Array(heatmap);
    const result = (await this.call(
      { type: "postprocess", tensor, dims, width, height },
      15_000,
      signal,
      [tensor.buffer],
    )) as { points: { x: number; y: number }[] };
    return result.points;
  }
  async infer(
    tensor: Float32Array,
    signal?: AbortSignal,
  ): Promise<InferenceOutput> {
    const input = new Float32Array(tensor);
    return (await this.call({ type: "infer", tensor: input }, 15_000, signal, [
      input.buffer,
    ])) as InferenceOutput;
  }
  dispose(error = new Error("Inference session closed")) {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }
}
