import type { CV } from "@techstark/opencv-js";
import { docalignerInput, docalignerCorners } from "../detectors/docaligner";
import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";

// Dedicated single-thread WASM Worker. No proxy, DOM, WebGPU or cross-origin URLs.
env.wasm.numThreads = 1;
env.wasm.proxy = false;
env.wasm.wasmPaths = "/vendor/ort/1.30.0/";
let session: InferenceSession | null = null;
const scope = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          id: string;
          type: "prepare" | "infer" | "preprocess" | "postprocess";
          modelUrl?: string;
          tensor?: Float32Array;
          rgba?: Uint8Array;
          width?: number;
          height?: number;
          dims?: number[];
        }>,
      ) => void)
    | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
let cvPromise: Promise<CV> | null = null;
async function openCv(): Promise<CV> {
  if (!cvPromise)
    cvPromise = (async () => {
      const url = "/vendor/opencv.js";
      await import(/* webpackIgnore: true */ url);
      const cv = await (self as unknown as { cv: Promise<CV> }).cv;
      if (!cv?.Mat) throw new Error("Worker OpenCV unavailable");
      return cv;
    })();
  return cvPromise;
}
let work = Promise.resolve();
scope.onmessage = (
  event: MessageEvent<{
    id: string;
    type: "prepare" | "infer" | "preprocess" | "postprocess";
    modelUrl?: string;
    tensor?: Float32Array;
    rgba?: Uint8Array;
    width?: number;
    height?: number;
    dims?: number[];
  }>,
) => {
  const request = event.data;
  work = work.then(async () => {
    try {
      if (request.type === "preprocess") {
        const cv = await openCv();
        const data = docalignerInput(
          cv,
          request.rgba!,
          request.width!,
          request.height!,
        );
        scope.postMessage({ id: request.id, type: "preprocessed", data }, [
          data.buffer,
        ]);
        return;
      }
      if (request.type === "postprocess") {
        const cv = await openCv();
        const points = docalignerCorners(
          cv,
          request.tensor!,
          request.dims!,
          request.width!,
          request.height!,
        );
        scope.postMessage({ id: request.id, type: "corners", points });
        return;
      }
      if (request.type === "prepare") {
        if (!request.modelUrl?.startsWith("/models/"))
          throw new Error("Invalid model path");
        if (session) await session.release();
        session = await InferenceSession.create(request.modelUrl, {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
        });
        scope.postMessage({
          id: request.id,
          type: "ready",
          inputs: session.inputMetadata,
          outputs: session.outputMetadata,
        });
        return;
      }
      if (!session || request.tensor?.length !== 3 * 256 * 256)
        throw new Error("Inference session or input unavailable");
      const input = new Tensor("float32", request.tensor, [1, 3, 256, 256]);
      let outputs: InferenceSession.ReturnType | null = null;
      try {
        const start = performance.now();
        outputs = await session.run({ img: input });
        const heatmap = outputs.heatmap;
        if (heatmap.type !== "float32")
          throw new Error("Unexpected heatmap type");
        const data = new Float32Array(heatmap.data as Float32Array);
        scope.postMessage(
          {
            id: request.id,
            type: "output",
            dims: heatmap.dims,
            data,
            inferenceMs: performance.now() - start,
          },
          [data.buffer],
        );
      } finally {
        input.dispose();
        if (outputs)
          for (const output of Object.values(outputs)) output.dispose();
      }
    } catch (error) {
      scope.postMessage({
        id: request.id,
        type: "error",
        reason: error instanceof Error ? error.message : "Inference error",
      });
    }
  });
};
