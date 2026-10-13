import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  isClockwiseConvex,
  percentile,
  polygonArea,
} from "../../card_recognition/benchmark-metrics";
import type { CardCorners, CardPoint } from "../../card_recognition/geometry";
import { containedPath, sha256 } from "./dataset";
import models from "../../card_recognition/models/manifest.json" with { type: "json" };

const output = resolve("output/card-rectification/real-pilot");
await mkdir(output, { recursive: true });
const rawManifest = await readFile(resolve(output, "photos.json"));
const manifest = JSON.parse(rawManifest.toString()) as {
  images: {
    imageId: string;
    file?: string;
    width?: number;
    height?: number;
    status: string;
    sourceSha256: string;
    inputSha256: string;
  }[];
};
const bundle = await build({
  entryPoints: ["scripts/card_recognition/photos-browser.ts"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
});
const provenance = {
  runId: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  photoManifestSha256: sha256(rawManifest),
  evaluatorSha256: sha256(
    await readFile("scripts/card_recognition/benchmark-photos.ts"),
  ),
  browserBundleSha256: sha256(bundle.outputFiles[0].contents),
  workerSha256: sha256(
    await readFile("public/vendor/card-inference-worker.js"),
  ),
  wasmSha256: sha256(
    await readFile("public/vendor/ort/1.30.0/ort-wasm-simd-threaded.wasm"),
  ),
  opencvSha256: sha256(await readFile("public/vendor/opencv.js")),
  runtimeVersion: "1.30.0",
  device: "development-PC",
  externalAiCalls: 0,
  cache:
    "fresh page/session per engine per 9 images; first preparation recorded separately",
  performanceScope:
    "pilot local detector calls, not 200 warm / 50 cold / mobile gates",
};
await writeFile(
  resolve(output, "provenance.json"),
  JSON.stringify(provenance, null, 2),
);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end("<!doctype html><title>Private local card pilot</title>");
      return;
    }
    if (url.pathname === "/client.js") {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.end(bundle.outputFiles[0].contents);
      return;
    }
    const path = url.pathname.startsWith("/inputs/")
      ? containedPath(output, url.pathname.slice(1))
      : containedPath(resolve("public"), url.pathname.slice(1));
    res.setHeader(
      "Content-Type",
      path.endsWith(".wasm")
        ? "application/wasm"
        : /\.(js|mjs)$/.test(path)
          ? "text/javascript; charset=utf-8"
          : path.endsWith(".png")
            ? "image/png"
            : "application/octet-stream",
    );
    res.end(await readFile(path));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
if (!address || typeof address === "string") throw new Error("No pilot server");
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  headless: true,
  channel:
    process.env.PLAYWRIGHT_CHANNEL ??
    (process.platform === "win32" ? "chrome" : undefined),
});
await writeFile(
  resolve(output, "browser.json"),
  JSON.stringify({ version: browser.version() }, null, 2),
);
const rows: Record<string, unknown>[] = [];
await writeFile(resolve(output, "measurements.jsonl"), "");
try {
  for (const engine of ["legacy", ...models.models.map((m) => m.id)]) {
    for (let offset = 0; offset < manifest.images.length; offset += 9) {
      const page = await browser.newPage();
      await page.goto(baseUrl);
      await page.addScriptTag({ url: "/client.js" });
      const model = models.models.find((m) => m.id === engine);
      const preparation = await page.evaluate(async (model) => {
        const api = window as unknown as {
          photoBenchmark: typeof import("./photos-browser") & {
            CardInferenceClient: typeof import("../../card_recognition/runtime/inference-client").CardInferenceClient;
          };
          client?: import("../../card_recognition/runtime/inference-client").CardInferenceClient;
        };
        if (!model) return { prepareMs: 0 };
        const start = performance.now();
        api.client = new api.photoBenchmark.CardInferenceClient();
        await api.client.prepare(model.staticUrl);
        return { prepareMs: performance.now() - start };
      }, model ?? null);
      for (const image of manifest.images.slice(offset, offset + 9)) {
        const result = await page.evaluate(
          async ({ image, engine }) => {
            const scope = window as unknown as {
              photoBenchmark: {
                restoreBusinessCardImage: typeof import("../../card_recognition/restore-image").restoreBusinessCardImage;
              };
              client: import("../../card_recognition/runtime/inference-client").CardInferenceClient;
            };
            const timings: Record<string, number> = {},
              start = performance.now();
            let bitmap: ImageBitmap | null = null;
            try {
              if (image.status !== "ready" || !image.file)
                throw new Error("unsupported-image");
              const file = new File(
                [await (await fetch(`/${image.file}`)).blob()],
                image.imageId + ".png",
                { type: "image/png" },
              );
              let points: { x: number; y: number }[] = [],
                peaks: number[] = [];
              if (engine === "legacy") {
                const restored =
                  await scope.photoBenchmark.restoreBusinessCardImage(file);
                timings.detectAndWarpEncodeMs = performance.now() - start;
                if (restored.kind === "fallback")
                  return {
                    status: "no-boundary",
                    reason: restored.reason,
                    points,
                    peaks,
                    timings,
                    totalMs: performance.now() - start,
                  };
                points = restored.corners;
              } else {
                let before = performance.now();
                bitmap = await createImageBitmap(file, {
                  imageOrientation: "from-image",
                });
                const canvas = document.createElement("canvas");
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const context = canvas.getContext("2d");
                if (!context) throw new Error("Canvas unavailable");
                context.drawImage(bitmap, 0, 0);
                bitmap.close();
                bitmap = null;
                const pixels = context.getImageData(
                  0,
                  0,
                  canvas.width,
                  canvas.height,
                );
                canvas.width = canvas.height = 0;
                timings.decodeMs = performance.now() - before;
                before = performance.now();
                const tensor = await scope.client.preprocess(
                  new Uint8Array(pixels.data.buffer),
                  image.width!,
                  image.height!,
                );
                timings.preprocessMs = performance.now() - before;
                before = performance.now();
                const prediction = await scope.client.infer(tensor);
                timings.inferenceCallMs = performance.now() - before;
                timings.inferenceWorkerMs = prediction.inferenceMs;
                const plane = prediction.dims[2] * prediction.dims[3];
                peaks = Array.from({ length: 4 }, (_, channel) => {
                  let max = 0;
                  for (let i = channel * plane; i < (channel + 1) * plane; i++)
                    max = Math.max(max, prediction.data[i]);
                  return max;
                });
                before = performance.now();
                points = await scope.client.corners(
                  prediction.data,
                  prediction.dims,
                  image.width!,
                  image.height!,
                );
                timings.postprocessMs = performance.now() - before;
              }
              return {
                status: "prediction",
                points,
                peaks,
                timings,
                totalMs: performance.now() - start,
              };
            } catch (error) {
              return {
                status: "error",
                reason: error instanceof Error ? error.message : "unknown",
                points: [],
                peaks: [],
                timings,
                totalMs: performance.now() - start,
              };
            } finally {
              bitmap?.close();
            }
          },
          { image, engine },
        );
        // Model order is cyclically normalized for display, not semantically rotated.
        const points = result.points as CardPoint[];
        const { orderCardCorners } =
          await import("../../card_recognition/geometry");
        const ordered = orderCardCorners(points);
        const valid =
          !!ordered &&
          isClockwiseConvex(ordered) &&
          ordered.every(
            (p) =>
              p.x >= 0 && p.y >= 0 && p.x < image.width! && p.y < image.height!,
          );
        const normalized = valid
          ? (ordered!.map((p) => ({
              x: p.x / image.width!,
              y: p.y / image.height!,
            })) as CardCorners)
          : null;
        const row = {
          ...provenance,
          imageId: image.imageId,
          sourceSha256: image.sourceSha256,
          inputSha256: image.inputSha256,
          coordinateSpace: "oriented-prepared-image-pixels",
          engine,
          modelSha256: model?.sha256 ?? null,
          sessionId: `${engine}-${offset / 9}`,
          sessionPreparationMs: preparation.prepareMs,
          width: image.width,
          height: image.height,
          ...result,
          status:
            result.status === "error"
              ? "error"
              : valid
                ? "valid-quad"
                : "needs-review",
          validQuad: valid,
          normalizedCorners: normalized,
          coverage: normalized ? polygonArea(normalized) : null,
          quality: "NOT_RUN: no verified ground truth",
          acceptance: "NOT_RUN",
        };
        rows.push(row);
        await appendFile(
          resolve(output, "measurements.jsonl"),
          JSON.stringify(row) + "\n",
        );
        console.log(
          `${engine} ${image.imageId}: ${row.status}, ${points.length}/4 points, ${result.totalMs.toFixed(0)}ms`,
        );
      }
      await page.evaluate(() =>
        (
          window as unknown as {
            client?: import("../../card_recognition/runtime/inference-client").CardInferenceClient;
          }
        ).client?.dispose(),
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
const summaries = ["legacy", ...models.models.map((m) => m.id)].map(
  (engine) => {
    const data = rows.filter((row) => row.engine === engine),
      valid = data.filter((row) => row.validQuad);
    return {
      engine,
      requests: data.length,
      validQuads: valid.length,
      needsReview: data.filter((row) => row.status === "needs-review").length,
      errors: data.filter((row) => row.status === "error").length,
      pointCount: Object.fromEntries(
        [0, 1, 2, 3, 4].map((count) => [
          count,
          data.filter((row) => (row.points as unknown[]).length === count)
            .length,
        ]),
      ),
      totalMsP50: percentile(
        data.map((row) => row.totalMs as number),
        0.5,
      ),
      totalMsP95: percentile(
        data.map((row) => row.totalMs as number),
        0.95,
      ),
      totalMsMax: Math.max(...data.map((row) => row.totalMs as number)),
      validOnlyMsP95: percentile(
        valid.map((row) => row.totalMs as number),
        0.95,
      ),
      quality: "NOT_RUN",
      performance: "PILOT_ONLY",
    };
  },
);
await writeFile(
  resolve(output, "summary.json"),
  JSON.stringify(
    {
      images: manifest.images.length,
      recorded: rows.length,
      summaries,
      scope: provenance.performanceScope,
      quality: "NOT_RUN: human labels required",
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(summaries, null, 2));
if (rows.some((row) => row.status === "error")) process.exitCode = 1;
