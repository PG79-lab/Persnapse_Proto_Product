import * as cpu from "onnxruntime-node";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { containedPath, sha256 } from "./dataset";

const output = resolve("output/card-rectification/phase2");
await mkdir(output, { recursive: true });
const provenance = {
  runId: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  runtimeVersion: "1.30.0",
  workerSha256: sha256(
    await readFile("public/vendor/card-inference-worker.js"),
  ),
  wasmSha256: sha256(
    await readFile("public/vendor/ort/1.30.0/ort-wasm-simd-threaded.wasm"),
  ),
  opencvSha256: sha256(await readFile("public/vendor/opencv.js")),
  lockfileSha256: sha256(await readFile("package-lock.json")),
  evaluatorSha256: sha256(
    await readFile("scripts/card_recognition/compatibility.ts"),
  ),
  modelManifestSha256: sha256(
    await readFile("card_recognition/models/manifest.json"),
  ),
  referencePreprocessingSha256: sha256(
    await readFile("scripts/card_recognition/reference_preprocessing.py"),
  ),
};
await writeFile(
  resolve(output, "provenance.json"),
  JSON.stringify(provenance, null, 2),
);
const manifest = JSON.parse(
  await readFile("card_recognition/models/manifest.json", "utf8"),
) as {
  models: {
    id: string;
    localFile: string;
    staticUrl: string;
    sha256: string;
  }[];
};
const bundle = await build({
  stdin: {
    contents:
      "import { CardInferenceClient } from './card_recognition/runtime/inference-client'; Object.assign(window,{CardInferenceClient});",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
});
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end("<!doctype html><title>Card model compatibility</title>");
      return;
    }
    if (url.pathname === "/client.js") {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.end(bundle.outputFiles[0].contents);
      return;
    }
    const path = url.pathname.startsWith("/fixture/")
      ? containedPath(output, url.pathname.slice(9))
      : containedPath(resolve("public"), url.pathname.slice(1));
    res.setHeader(
      "Content-Type",
      path.endsWith(".wasm")
        ? "application/wasm"
        : path.endsWith(".js") || path.endsWith(".mjs")
          ? "text/javascript; charset=utf-8"
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
if (!address || typeof address === "string")
  throw new Error("No compatibility server");
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL,
});
const measurements: Record<string, unknown>[] = [];
const adapterMeasurements: Record<string, unknown>[] = [];
try {
  const patterns = JSON.parse(
    await readFile(resolve(output, "preprocessing/manifest.json"), "utf8"),
  ) as {
    patterns: {
      id: number;
      width: number;
      height: number;
      points: { x: number; y: number }[];
    }[];
  };
  const adapterPage = await browser.newPage();
  await adapterPage.goto(url);
  await adapterPage.addScriptTag({ url: "/client.js" });
  await adapterPage.evaluate(() => {
    const api = window as unknown as {
      CardInferenceClient: typeof import("../../card_recognition/runtime/inference-client").CardInferenceClient;
      client: import("../../card_recognition/runtime/inference-client").CardInferenceClient;
    };
    api.client = new api.CardInferenceClient();
  });
  for (const pattern of patterns.patterns) {
    const row = await adapterPage.evaluate(async (pattern) => {
      const client = (
        window as unknown as {
          client: import("../../card_recognition/runtime/inference-client").CardInferenceClient;
        }
      ).client;
      const rgba = new Uint8Array(
        await (
          await fetch(`/fixture/preprocessing/${pattern.id}-rgba.bin`)
        ).arrayBuffer(),
      );
      const expected = new Float32Array(
        await (
          await fetch(`/fixture/preprocessing/${pattern.id}-tensor.f32`)
        ).arrayBuffer(),
      );
      const actual = await client.preprocess(
        rgba,
        pattern.width,
        pattern.height,
      );
      let maximum = 0,
        sum = 0;
      if (actual.length !== expected.length)
        throw new Error("Preprocessing shape mismatch");
      for (let i = 0; i < expected.length; i++) {
        const difference = Math.abs(actual[i] - expected[i]);
        maximum = Math.max(maximum, difference);
        sum += difference;
      }
      const heatmap = new Float32Array(
        await (
          await fetch(`/fixture/preprocessing/${pattern.id}-heatmap.f32`)
        ).arrayBuffer(),
      );
      const points = await client.corners(
        heatmap,
        [1, 4, 128, 128],
        pattern.width,
        pattern.height,
      );
      const errors = points.map((point, i) =>
        Math.hypot(
          point.x - pattern.points[i].x,
          point.y - pattern.points[i].y,
        ),
      );
      return {
        id: pattern.id,
        meanAbsoluteDifference: sum / expected.length,
        maxAbsoluteDifference: maximum,
        postprocessMatches: points.length === pattern.points.length,
        maximumCornerDifferencePx: Math.max(0, ...errors),
        points,
      };
    }, pattern);
    adapterMeasurements.push(row);
  }
  await adapterPage.evaluate(() =>
    (
      window as unknown as {
        client: import("../../card_recognition/runtime/inference-client").CardInferenceClient;
      }
    ).client.dispose(),
  );
  await adapterPage.close();
  for (const model of manifest.models) {
    const root = resolve(output, model.id);
    await mkdir(root, { recursive: true });
    const session = await cpu.InferenceSession.create(
      resolve("output/card-rectification/models", model.localFile),
      {
        executionProviders: ["cpu"],
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
      },
    );
    const cpuMetadata = {
      inputs: session.inputMetadata,
      outputs: session.outputMetadata,
    };
    for (let sample = 0; sample < 30; sample++) {
      // Fixed BGR NCHW tensors isolate inference numerical compatibility.
      // Image decoder/resize/channel preprocessing is a separate unpassed gate.
      const tensor = new Float32Array(3 * 256 * 256);
      for (let c = 0; c < 3; c++)
        for (let y = 0; y < 256; y++)
          for (let x = 0; x < 256; x++)
            tensor[c * 256 * 256 + y * 256 + x] =
              ((x * ((sample % 5) + 1) +
                y * ((sample % 7) + 1) +
                c * 73 +
                sample * 13) %
                256) /
              255;
      const input = new cpu.Tensor("float32", tensor, [1, 3, 256, 256]);
      const result = await session.run({ img: input });
      const heatmap = result.heatmap;
      await writeFile(
        resolve(root, `${sample}-input.f32`),
        Buffer.from(tensor.buffer),
      );
      await writeFile(
        resolve(root, `${sample}-reference.f32`),
        Buffer.from((heatmap.data as Float32Array).buffer),
      );
      await writeFile(
        resolve(root, `${sample}-metadata.json`),
        JSON.stringify({
          dims: heatmap.dims,
          inputSha256: sha256(new Uint8Array(tensor.buffer)),
          outputSha256: sha256(
            new Uint8Array((heatmap.data as Float32Array).buffer),
          ),
        }),
      );
      input.dispose();
      for (const tensor of Object.values(result)) tensor.dispose();
    }
    await session.release();
    const page = await browser.newPage();
    page.on("pageerror", (error) =>
      console.log(`Compatibility browser: ${error.message}`),
    );
    await page.goto(url);
    await page.addScriptTag({ url: "/client.js" });
    const ready = await page.evaluate(async (model) => {
      const api = window as unknown as {
        CardInferenceClient: typeof import("../../card_recognition/runtime/inference-client").CardInferenceClient;
        client: import("../../card_recognition/runtime/inference-client").CardInferenceClient;
      };
      api.client = new api.CardInferenceClient();
      return await api.client.prepare(model.staticUrl);
    }, model);
    for (let sample = 0; sample < 30; sample++) {
      const row = await page.evaluate(
        async ({ model, sample }) => {
          const api = window as unknown as {
            client: import("../../card_recognition/runtime/inference-client").CardInferenceClient;
          };
          const input = new Float32Array(
            await (
              await fetch(`/fixture/${model.id}/${sample}-input.f32`)
            ).arrayBuffer(),
          );
          const reference = new Float32Array(
            await (
              await fetch(`/fixture/${model.id}/${sample}-reference.f32`)
            ).arrayBuffer(),
          );
          const result = await api.client.infer(input);
          let failed = 0,
            nonFinite = 0,
            maxDifference = 0;
          if (result.data.length !== reference.length)
            throw new Error("Output shape mismatch");
          for (let i = 0; i < reference.length; i++) {
            if (
              !Number.isFinite(result.data[i]) ||
              !Number.isFinite(reference[i])
            )
              nonFinite++;
            const difference = Math.abs(result.data[i] - reference[i]);
            maxDifference = Math.max(maxDifference, difference);
            if (difference > 1e-4 + 1e-3 * Math.abs(reference[i])) failed++;
          }
          return {
            sample,
            elements: reference.length,
            dims: result.dims,
            failed,
            nonFinite,
            maxDifference,
            inferenceMs: result.inferenceMs,
          };
        },
        { model, sample },
      );
      measurements.push({
        ...provenance,
        modelId: model.id,
        modelSha256: model.sha256,
        runtimeVersion: "1.30.0",
        device: "development-PC",
        execution: "dedicated single-thread WASM Worker",
        ...row,
      });
    }
    await page.evaluate(() =>
      (
        window as unknown as {
          client: import("../../card_recognition/runtime/inference-client").CardInferenceClient;
        }
      ).client.dispose(),
    );
    await page.close();
    await writeFile(
      resolve(root, "session-metadata.json"),
      JSON.stringify({ cpuMetadata, webMetadata: ready }, null, 2),
    );
    console.log(`${model.id}: 30 fixed input tensors compared`);
  }
} finally {
  await browser.close();
  server.close();
}
await writeFile(
  resolve(output, "measurements.jsonl"),
  measurements.map((row) => JSON.stringify(row)).join("\n") + "\n",
);
await writeFile(
  resolve(output, "adapter-measurements.json"),
  JSON.stringify(adapterMeasurements, null, 2),
);
const summary = {
  ...provenance,
  runtimeVersion: "1.30.0",
  browserVersion: browser.version(),
  device: "development-PC",
  compared: measurements.length,
  failedElements: measurements.reduce((s, r) => s + (r.failed as number), 0),
  nonFinite: measurements.reduce((s, r) => s + (r.nonFinite as number), 0),
  outputNumerics: measurements.every((r) => r.failed === 0 && r.nonFinite === 0)
    ? "PASS"
    : "FAIL",
  preprocessing:
    adapterMeasurements.length === 30 &&
    adapterMeasurements.every(
      (row) =>
        (row.meanAbsoluteDifference as number) <= 0.5 / 255 &&
        (row.maxAbsoluteDifference as number) <= 2 / 255,
    )
      ? "PASS"
      : "FAIL",
  analyticPostprocessing:
    adapterMeasurements.length === 30 &&
    adapterMeasurements.every(
      (row) =>
        row.postprocessMatches &&
        (row.maximumCornerDifferencePx as number) <=
          0.002 *
            Math.hypot(
              37 + (row.id as number) * 11,
              29 + (row.id as number) * 7,
            ),
    )
      ? "PASS"
      : "FAIL",
  postprocessingScope:
    "30 analytic heatmaps; official downstream largest-contour centroid parity, real model output corner comparison pending",
  productionAssets: "NOT_RUN",
  officialModelPostprocessing: "NOT_RUN",
  android: "NOT_RUN",
  iphone: "NOT_RUN",
  docquad: "NOT_RUN",
  stage2:
    "NOT_RUN: numerical subgate alone does not complete model and web compatibility",
};
await writeFile(
  resolve(output, "summary.json"),
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
if (
  summary.outputNumerics !== "PASS" ||
  summary.preprocessing !== "PASS" ||
  summary.analyticPostprocessing !== "PASS"
)
  process.exitCode = 1;
