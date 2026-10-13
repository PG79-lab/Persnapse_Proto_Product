import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardInferenceClient } from "./inference-client";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
  messages: { id: string; type: string }[] = [];
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: { id: string; type: string }) {
    this.messages.push(message);
  }
  emit(message: unknown) {
    this.onmessage?.({ data: message } as MessageEvent);
  }
}

describe("dedicated inference client lifecycle", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("terminates cancelled WASM work and ignores late results", async () => {
    const client = new CardInferenceClient(),
      controller = new AbortController();
    const pending = client.prepare(
      "/models/test/model.onnx",
      controller.signal,
    );
    const rejected = expect(pending).rejects.toThrow("cancelled");
    const worker = FakeWorker.instances[0];
    controller.abort();
    worker.emit({ id: worker.messages[0].id, type: "ready" });
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("times out once and creates a new Worker on explicit retry", async () => {
    const client = new CardInferenceClient();
    const pending = client.prepare("/models/test/model.onnx");
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const retry = client.prepare("/models/test/model.onnx");
    const worker = FakeWorker.instances[1];
    worker.emit({ id: worker.messages[0].id, type: "ready" });
    await expect(retry).resolves.toMatchObject({ type: "ready" });
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects queued operations when the Worker fails", async () => {
    const client = new CardInferenceClient();
    const first = client.prepare("/models/test/model.onnx");
    const second = client.infer(new Float32Array(3 * 256 * 256));
    const a = expect(first).rejects.toThrow("unavailable"),
      b = expect(second).rejects.toThrow("unavailable");
    FakeWorker.instances[0].onerror?.();
    await Promise.all([a, b]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("returns engine failures without automatically retrying", async () => {
    const client = new CardInferenceClient();
    const pending = client.prepare("/models/missing/model.onnx");
    const rejected = expect(pending).rejects.toThrow("404");
    const worker = FakeWorker.instances[0];
    worker.emit({
      id: worker.messages[0].id,
      type: "error",
      reason: "model 404",
    });
    await rejected;
    expect(FakeWorker.instances).toHaveLength(1);
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
