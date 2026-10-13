import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "./dataset";
import {
  boundaryMetrics,
  percentile,
} from "../../card_recognition/benchmark-metrics";
import type { CardCorners } from "../../card_recognition/geometry";

const output = resolve("output/card-rectification/real-pilot");
const raw = await readFile(resolve(output, "photos.json"));
const manifest = JSON.parse(raw.toString());
const rows = (await readFile(resolve(output, "measurements.jsonl"), "utf8"))
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const summary = JSON.parse(
  await readFile(resolve(output, "summary.json"), "utf8"),
);
const agreement = manifest.images.map(
  (image: { imageId: string; width: number; height: number }) => {
    const lc = rows.find(
      (row) =>
        row.imageId === image.imageId && row.engine === "docaligner-lc100",
    );
    const t8 = rows.find(
      (row) => row.imageId === image.imageId && row.engine === "docaligner-t8",
    );
    if (!lc?.normalizedCorners || !t8?.normalizedCorners)
      return { imageId: image.imageId, iou: null, meanGapPercent: null };
    const pixel = (points: CardCorners) =>
      points.map((point) => ({
        x: point.x * image.width,
        y: point.y * image.height,
      })) as CardCorners;
    const result = boundaryMetrics(
      pixel(lc.normalizedCorners),
      pixel(t8.normalizedCorners),
    );
    return {
      imageId: image.imageId,
      iou: result.iou,
      meanGapPercent: result.meanErrorPercent,
    };
  },
);
const validAgreement = agreement.filter(
  (row: { iou: number | null }) => row.iou !== null,
);
const consensus = {
  scope: "LC100/T8 agreement, not ground-truth accuracy",
  bothValid: validAgreement.length,
  images: manifest.images.length,
  iouMedian: percentile(
    validAgreement.map((row: { iou: number }) => row.iou),
    0.5,
  ),
  iouP5: percentile(
    validAgreement.map((row: { iou: number }) => row.iou),
    0.05,
  ),
  lowest: validAgreement
    .sort((a: { iou: number }, b: { iou: number }) => a.iou - b.iou)
    .slice(0, 10),
  rows: agreement,
};
await writeFile(
  resolve(output, "cross-model.json"),
  JSON.stringify(consensus, null, 2),
);
const bundle = await build({
  stdin: {
    contents:
      "import * as metrics from './card_recognition/benchmark-metrics';Object.assign(window,{cardReportMetrics:metrics});",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  minify: true,
});
await writeFile(
  resolve(output, "report-metrics.js"),
  bundle.outputFiles[0].contents,
);
const template = await readFile(
  "scripts/card_recognition/photo-report.html",
  "utf8",
);
const data = JSON.stringify({
  images: manifest.images,
  rows,
  summary,
  consensus,
  manifestSha256: sha256(raw),
}).replaceAll("<", "\\u003c");
await writeFile(
  resolve(output, "report.html"),
  template.replace(
    "<!-- REPORT_DATA -->",
    `<script>const DATA=${data};</script>`,
  ),
);
const columns = [
  "imageId",
  "engine",
  "status",
  "validQuad",
  "pointCount",
  "coverage",
  "totalMs",
  "decodeMs",
  "preprocessMs",
  "inferenceWorkerMs",
  "postprocessMs",
  "reason",
];
const csv = [
  columns.join(","),
  ...rows.map((row) =>
    columns
      .map((key) => {
        const value =
          key === "pointCount"
            ? row.points.length
            : (row[key] ?? row.timings[key] ?? "");
        return `"${String(value).replaceAll('"', '""')}"`;
      })
      .join(","),
  ),
].join("\n");
await writeFile(resolve(output, "measurements.csv"), "\ufeff" + csv + "\n");
console.log(
  JSON.stringify({
    report: resolve(output, "report.html"),
    images: manifest.images.length,
    rows: rows.length,
  }),
);
