import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  boundaryMetrics,
  contentPreservation,
  percentile,
} from "../../card_recognition/benchmark-metrics";
import {
  containedPath,
  points,
  regionPoints,
  sha256,
  validateDataset,
} from "./dataset";

const dataset = resolve("output/card-rectification/dataset");
const output = resolve("output/card-rectification/phase1");
await mkdir(output, { recursive: true });
const { manifest, report } = await validateDataset(dataset);
await writeFile(
  resolve(output, "dataset-validation.json"),
  JSON.stringify(report, null, 2),
);
if (report.status !== "PASS")
  throw new Error(`Invalid dataset: ${report.errors.join(",")}`);
const bundle = await build({
  entryPoints: ["scripts/card_recognition/browser-entry.ts"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
});
const script = bundle.outputFiles[0].contents;
const git = (...args: string[]) =>
  execFileSync(
    "git",
    ["-c", "safe.directory=D:/Persnapse/persnapse-mvp", ...args],
    { stdio: ["ignore", "pipe", "ignore"] },
  ).toString();
const runtime = await readFile("public/vendor/opencv.js");
async function baselineHash() {
  try {
    return sha256(
      await readFile("output/card-rectification/baseline/files.json"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
const provenance = {
  runId: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  gitHead: git("rev-parse", "HEAD").trim(),
  patchSha256: sha256(git("diff", "--binary", "HEAD")),
  baselineFilesSha256: await baselineHash(),
  datasetSha256: report.manifestSha256,
  bundleSha256: sha256(script),
  runtimeSha256: sha256(runtime),
  modelSha256: null,
  device: "development-PC",
  cache: "new browser page/runtime every 20 images, correctness run only",
  network: "localhost, uncontrolled",
  externalAiCalls: 0,
};
await writeFile(
  resolve(output, "provenance.json"),
  JSON.stringify(provenance, null, 2),
);
await writeFile(resolve(output, "benchmark-bundle.js"), script);
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end("<!doctype html><title>Local card boundary baseline</title>");
    } else if (url.pathname === "/vendor/opencv.js") {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.end(runtime);
    } else if (url.pathname === "/benchmark.js") {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.end(script);
    } else if (url.pathname.startsWith("/images/")) {
      res.setHeader("Content-Type", "image/png");
      res.end(
        await readFile(
          containedPath(dataset, decodeURIComponent(url.pathname.slice(1))),
        ),
      );
    } else {
      res.statusCode = 404;
      res.end();
    }
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("No server address");
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL,
});
const results: Record<string, unknown>[] = [];
await writeFile(resolve(output, "measurements.jsonl"), "");
try {
  async function openPage() {
    const page = await browser.newPage();
    page.on("pageerror", (error) =>
      console.log(`Browser error: ${error.message}`),
    );
    await page.goto(baseUrl);
    await page.addScriptTag({ url: "/benchmark.js" });
    return page;
  }
  let page = await openPage();
  const userAgent = await page.evaluate(() => navigator.userAgent);
  await writeFile(
    resolve(output, "browser.json"),
    JSON.stringify({ version: browser.version(), userAgent }, null, 2),
  );
  const limit = Number(
    process.env.CARD_BENCHMARK_LIMIT ?? manifest.images.length,
  );
  let imageIndex = 0;
  for (const image of manifest.images.slice(0, limit)) {
    if (imageIndex++ > 0 && (imageIndex - 1) % 20 === 0) {
      await page.close();
      page = await openPage();
    }
    // Separate the unchanged detector from the oracle-corner restoration path.
    const modes =
      image.kind === "normal" ? ["legacy", "oracle-corners"] : ["legacy"];
    for (const mode of modes) {
      const result = await Promise.race([
        page.evaluate(
          async ({ image, mode }) => {
            const api = (
              window as unknown as {
                cardBoundaryBenchmark: {
                  restoreBusinessCardImage: typeof import("../../card_recognition/restore-image").restoreBusinessCardImage;
                  orderCardCorners: typeof import("../../card_recognition/geometry").orderCardCorners;
                };
              }
            ).cardBoundaryBenchmark;
            const start = performance.now();
            try {
              const blob = await (await fetch(`/${image.file}`)).blob();
              const file = new File([blob], image.imageId + ".png", {
                type: "image/png",
              });
              const corners =
                mode === "oracle-corners" && image.corners
                  ? (api.orderCardCorners(
                      image.corners.map(([x, y]) => ({
                        x: x / image.width,
                        y: y / image.height,
                      })),
                    ) ?? undefined)
                  : (image.manualCorners?.map(([x, y]) => ({ x, y })) as
                      | import("../../card_recognition/geometry").CardCorners
                      | undefined);
              const restoration = await api.restoreBusinessCardImage(
                file,
                corners,
              );
              if (restoration.kind === "fallback")
                return { ...restoration, totalMs: performance.now() - start };
              const bytes = new Uint8Array(
                await restoration.file.arrayBuffer(),
              );
              let binary = "";
              for (const byte of bytes) binary += String.fromCharCode(byte);
              return {
                kind: restoration.kind,
                width: restoration.width,
                height: restoration.height,
                corners: restoration.corners,
                coverage: restoration.coverage,
                outputBytes: bytes.length,
                jpeg: btoa(binary),
                totalMs: performance.now() - start,
              };
            } catch (error) {
              return {
                kind: "error",
                reason: error instanceof Error ? error.message : "unknown",
                totalMs: performance.now() - start,
              };
            }
          },
          { image, mode },
        ),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new Error(`Baseline timed out on ${image.imageId}/${mode}`),
              ),
            30_000,
          );
          timer.unref();
        }),
      ]);
      const { jpeg, ...measurement } = result as typeof result & {
        jpeg?: string;
      };
      const outputFile = jpeg ? `${image.imageId}-${mode}.jpg` : null;
      const bytes = jpeg ? Buffer.from(jpeg, "base64") : null;
      if (bytes && outputFile)
        await writeFile(resolve(output, outputFile), bytes);
      const corners = ("corners" in result ? result.corners : null) ?? null;
      const metrics = image.corners
        ? boundaryMetrics(corners, points(image.corners))
        : null;
      const printedRegions = image.requiredRegions.map((region) => ({
        id: region.id,
        preservation: contentPreservation(
          regionPoints(region.polygon),
          corners,
        ),
      }));
      results.push({
        ...provenance,
        imageId: image.imageId,
        cardId: image.cardId,
        split: image.split,
        kind: image.kind,
        tags: image.tags,
        inputSha256: image.sha256,
        inputWidth: image.width,
        inputHeight: image.height,
        sourceKind: "capture-file",
        detectorId: mode,
        aspectSource: "estimated",
        measurement,
        metrics,
        printedRegions,
        outputFile,
        outputSha256: bytes ? sha256(bytes) : null,
        stageTimings: "NOT_RUN: legacy engine exposes only total call time",
        acceptance: "NOT_RUN",
        managedBufferPeak: "NOT_RUN",
      });
      await appendFile(
        resolve(output, "measurements.jsonl"),
        JSON.stringify(results.at(-1)) + "\n",
      );
    }
    if (results.length % 100 === 0) {
      console.log(
        `Recorded ${results.length} paths, last image ${image.imageId}`,
      );
    }
  }
} finally {
  await browser.close();
  server.close();
}
await writeFile(
  resolve(output, "measurements.jsonl"),
  results.map((row) => JSON.stringify(row)).join("\n") + "\n",
);
const summaries = ["legacy", "oracle-corners"].map((detectorId) => {
  const rows = results.filter((row) => row.detectorId === detectorId);
  const normal = rows.filter((row) => row.kind === "normal");
  const values = normal.map(
    (row) => row.metrics as ReturnType<typeof boundaryMetrics>,
  );
  const times = rows.map(
    (row) => (row.measurement as { totalMs: number }).totalMs,
  );
  const outcomes = rows.map(
    (row) => (row.measurement as { kind: string }).kind,
  );
  return {
    detectorId,
    requests: rows.length,
    normalInputs: normal.length,
    outcomes: Object.fromEntries(
      [...new Set(outcomes)].map((kind) => [
        kind,
        outcomes.filter((v) => v === kind).length,
      ]),
    ),
    detectionSuccess: values.filter((v) => v.success).length,
    missingOrInvalid: values.filter((v) => !v.valid).length,
    meanErrorPercent: values.some((v) => v.valid)
      ? values
          .filter((v) => v.meanErrorPercent !== null)
          .reduce((s, v) => s + v.meanErrorPercent!, 0) /
        values.filter((v) => v.valid).length
      : null,
    meanErrorP95: percentile(
      values.flatMap((v) =>
        v.meanErrorPercent === null ? [] : [v.meanErrorPercent],
      ),
      0.95,
    ),
    maxErrorP95: percentile(
      values.flatMap((v) =>
        v.maxErrorPercent === null ? [] : [v.maxErrorPercent],
      ),
      0.95,
    ),
    iouMedian: percentile(
      values.map((v) => v.iou),
      0.5,
    ),
    iouP5: percentile(
      values.map((v) => v.iou),
      0.05,
    ),
    totalMsP50: percentile(times, 0.5),
    totalMsP95: percentile(times, 0.95),
    totalMsP99: percentile(times, 0.99),
    contentClipping: normal.filter(
      (row) =>
        (row.measurement as { kind: string }).kind === "restored" &&
        (row.printedRegions as { preservation: number }[]).some(
          (r) => r.preservation < 0.999,
        ),
    ).length,
    falseNormalNegative: rows.filter(
      (row) =>
        row.kind === "negative" &&
        (row.measurement as { kind: string }).kind === "restored",
    ).length,
    falseNormalInvalid: rows.filter(
      (row) =>
        row.kind === "invalid" &&
        (row.measurement as { kind: string }).kind === "restored",
    ).length,
    status: "BASELINE_ONLY",
    performanceGate: "NOT_RUN: not fixed-device warm/cold sessions",
    qualityGate: "NOT_RUN: baseline preparation is not final model evaluation",
  };
});
const processed = new Set(results.map((row) => row.imageId)).size;
await writeFile(
  resolve(output, "summary.json"),
  JSON.stringify(
    {
      data: report,
      processed,
      expected: 1700,
      stage1: processed === 1700 ? "PASS" : "INSUFFICIENT_DATA",
      summaries,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ processed, expected: 1700, summaries }, null, 2));
if (processed !== 1700) process.exitCode = 2;
