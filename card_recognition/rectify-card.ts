import { isClockwiseConvex } from "./benchmark-metrics";
import { orderCardCorners, type CardCorners } from "./geometry";
import manifest from "./models/manifest.json";
import { selectedBoundaryModelId } from "./model-policy";
import { restoreBusinessCardImage } from "./restore-image";
import { CardInferenceClient } from "./runtime/inference-client";

export async function rectifyCard(
  file: File,
  options: {
    signal: AbortSignal;
    corners?: CardCorners;
    progress?: (message: string) => void;
  },
) {
  const timings: Record<string, number> = {};
  const start = performance.now();
  let corners = options.corners;
  if (!corners) {
    const client = new CardInferenceClient();
    let bitmap: ImageBitmap | null = null;
    try {
      options.progress?.("LC100으로 명함 테두리를 찾고 있습니다.");
      const model = manifest.models.find(
        (m) => m.id === selectedBoundaryModelId,
      )!;
      let before = performance.now();
      await client.prepare(model.staticUrl, options.signal);
      timings.modelLoadMs = performance.now() - before;
      before = performance.now();
      bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      options.signal.throwIfAborted();
      const scale = Math.min(
        1,
        Math.sqrt(2_000_000 / (bitmap.width * bitmap.height)),
      );
      const width = Math.max(1, Math.floor(bitmap.width * scale));
      const height = Math.max(1, Math.floor(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("이미지 처리 환경을 사용할 수 없습니다.");
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      bitmap = null;
      const rgba = ctx.getImageData(0, 0, width, height);
      canvas.width = canvas.height = 0;
      timings.decodeMs = performance.now() - before;
      before = performance.now();
      const input = await client.preprocess(
        new Uint8Array(rgba.data.buffer),
        width,
        height,
        options.signal,
      );
      timings.preprocessMs = performance.now() - before;
      const output = await client.infer(input, options.signal);
      timings.inferenceMs = output.inferenceMs;
      before = performance.now();
      const points = await client.corners(
        output.data,
        output.dims,
        width,
        height,
        options.signal,
      );
      timings.postprocessMs = performance.now() - before;
      const ordered = orderCardCorners(points);
      if (
        !ordered ||
        !isClockwiseConvex(ordered) ||
        ordered.some((p) => p.x < 0 || p.y < 0 || p.x >= width || p.y >= height)
      )
        throw new Error(
          "명함 외곽 네 점을 찾지 못했습니다. 모서리를 직접 지정하세요.",
        );
      corners = ordered.map((p) => ({
        x: p.x / width,
        y: p.y / height,
      })) as CardCorners;
    } finally {
      bitmap?.close();
      client.dispose();
    }
  }
  options.signal.throwIfAborted();
  if (
    !isClockwiseConvex(corners) ||
    corners.some((p) => p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1)
  )
    throw new Error("명함 네 모서리를 다시 지정하세요.");
  options.progress?.("명함을 정면의 2D 이미지로 보정하고 있습니다.");
  const before = performance.now();
  const restored = await restoreBusinessCardImage(file, corners);
  options.signal.throwIfAborted();
  if (restored.kind !== "restored")
    throw new Error("원근 보정에 실패했습니다. 다시 시도하거나 재촬영하세요.");
  timings.warpEncodeMs = performance.now() - before;
  timings.totalMs = performance.now() - start;
  return {
    restored,
    corners,
    timings,
    recipe: options.corners
      ? ("manual-card-v1" as const)
      : ("docaligner-lc100-card-v1" as const),
  };
}
