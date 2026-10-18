import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";

const output = resolve(
  "output/card-rectification/optimization-quality-2026-10-13",
);
const pilot = resolve("output/card-rectification/real-pilot");
await mkdir(output, { recursive: true });
const snapshot = resolve(output, "docaligner-baseline.ts");
try {
  await access(snapshot);
} catch {
  throw new Error(
    "Save the BEFORE docaligner.ts as docaligner-baseline.ts before changing it.",
  );
}
const [bundle, baseline] = await Promise.all([
  build({
    entryPoints: ["scripts/card_recognition/quick-pilot-browser.ts"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
  }),
  build({
    entryPoints: [snapshot],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  }),
]);
const manifestBytes = await readFile(resolve(pilot, "photos.json"));
const manifest = JSON.parse(manifestBytes);
const truth = {
  "photo-001": [
    { x: 153, y: 140 },
    { x: 960, y: 188 },
    { x: 935, y: 1574 },
    { x: 150, y: 1615 },
  ],
  "photo-002": [
    { x: 181, y: 263 },
    { x: 921, y: 274 },
    { x: 960, y: 1398 },
    { x: 224, y: 1465 },
  ],
  "photo-003": [
    { x: 201, y: 214 },
    { x: 1020, y: 248 },
    { x: 1008, y: 1513 },
    { x: 184, y: 1554 },
  ],
};
const images = ["photo-001", "photo-002", "photo-003", "photo-009"].map(
  (id) => ({
    ...manifest.images.find((i) => i.imageId === id),
    truth: truth[id],
  }),
);
await writeFile(
  resolve(output, "labels.json"),
  JSON.stringify(
    {
      status: "PROVISIONAL_SINGLE_AUTHOR",
      method:
        "Manual visual inspection with predictions hidden; approximate corners; no independent review",
      photoManifestSha256: createHash("sha256")
        .update(manifestBytes)
        .digest("hex"),
      truth,
      excluded: {
        "photo-009":
          "Physical outer card partly outside frame; printed box is not ground truth",
      },
    },
    null,
    2,
  ),
);
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>Card quick pilot</title>");
      return;
    }
    if (url.pathname === "/client.js" || url.pathname === "/baseline.js") {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.end(
        (url.pathname === "/client.js" ? bundle : baseline).outputFiles[0]
          .contents,
      );
      return;
    }
    const root = url.pathname.startsWith("/pilot/") ? pilot : resolve("public");
    const path = resolve(
      root,
      url.pathname.startsWith("/pilot/")
        ? url.pathname.slice(7)
        : url.pathname.slice(1),
    );
    if (!path.startsWith(root + sep)) throw new Error("Invalid path");
    res.setHeader(
      "Content-Type",
      path.endsWith(".js") || path.endsWith(".mjs")
        ? "text/javascript; charset=utf-8"
        : path.endsWith(".wasm")
          ? "application/wasm"
          : "application/octet-stream",
    );
    res.end(await readFile(path));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(3120, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "chrome" });
try {
  const result = { modelLoadMs: [], rows: [] };
  const specs = images.flatMap((image) =>
    (image.imageId === "photo-001" ? [0, 90, 180, 270] : [0]).map((angle) => ({
      ...image,
      angles: [angle],
    })),
  );
  for (let i = 0; i < specs.length; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (message) => console.log(message.text()));
    await page.goto("http://127.0.0.1:3120");
    await page.addScriptTag({ url: "/client.js" });
    const part = await page.evaluate(
      ({ image, synthetic }) => window.quickPilot([image], synthetic),
      { image: specs[i], synthetic: i === specs.length - 1 },
    );
    result.modelLoadMs.push(part.modelLoadMs);
    result.rows.push(...part.rows);
    await writeFile(
      resolve(output, "rows.json"),
      JSON.stringify(result, null, 2),
    );
    await context.close();
  }
  await writeFile(
    resolve(output, "rows.json"),
    JSON.stringify(result, null, 2),
  );
  const samples = result.rows.flatMap((r) => r.samples ?? []);
  const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  const summary = {
    cases: result.rows.length,
    samples: samples.length,
    baselinePostprocessMedianMs: median(samples.map((s) => s.baselineMs)),
    optimizedPostprocessMedianMs: median(samples.map((s) => s.optimizedMs)),
    allSameHeatmapCornersIdentical: samples.every((s) => s.identical),
    modelLoadMs: result.modelLoadMs,
    casesSummary: result.rows.map(({ source, output, samples, ...r }) => r),
    externalOcrCalls: 0,
  };
  await writeFile(
    resolve(output, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  const esc = (s) =>
    String(s).replace(
      /[<>&]/g,
      (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c],
    );
  const html = `<!doctype html><meta charset="utf-8"><title>LC100 20분 실험</title><style>body{font:16px sans-serif;max-width:1200px;margin:30px auto}article{border-top:1px solid #ccc;padding:20px}img{max-width:45%;max-height:500px;object-fit:contain}pre{white-space:pre-wrap}</style><h1>LC100 속도·기울기·회전 탐색</h1><p>잠정 정답·소규모 실험. OCR 정확도 미평가.</p><pre>${esc(JSON.stringify(summary, null, 2))}</pre>${result.rows.map((r) => `<article><h2>${esc(r.imageId)} · ${r.angle}° · ${r.manual ? "수동" : "자동"}</h2><img src="${r.source}" alt="입력"><img src="${r.output ?? ""}" alt="보정 결과"><pre>${esc(JSON.stringify(r.metrics ?? {}, null, 2))}</pre></article>`).join("")}`;
  await writeFile(resolve(output, "comparison.html"), html);
  console.log(JSON.stringify(summary));
} finally {
  await browser.close();
  server.close();
}
