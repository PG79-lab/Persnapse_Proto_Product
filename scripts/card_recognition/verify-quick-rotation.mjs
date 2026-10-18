import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import assert from "node:assert/strict";
import { mockCardApi } from "./mock-card-api.ts";

const output = resolve(
  "output/card-rectification/optimization-quality-2026-10-13",
);
const bundle = await build({
  entryPoints: ["scripts/card_recognition/quick-ui-browser.tsx"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": "'production'" },
});
const server = createServer(async (req, res) => {
  if (await mockCardApi(req, res)) return;
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><meta charset="utf-8"><title>실제 명함 workspace 컴포넌트 검증</title><style>body{font:16px sans-serif}img{max-width:500px;max-height:500px}svg{max-height:400px}button{padding:10px;margin:6px}</style><div id="root"></div><script src="/client.js"></script>',
    );
    return;
  }
  if (url.pathname === "/client.js") {
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.end(bundle.outputFiles[0].contents);
    return;
  }
  try {
    const root = url.pathname.startsWith("/pilot/")
        ? resolve("output/card-rectification/real-pilot")
        : resolve("public"),
      path = resolve(
        root,
        url.pathname.startsWith("/pilot/")
          ? url.pathname.slice(7)
          : url.pathname.slice(1),
      );
    if (!path.startsWith(root + sep)) throw new Error();
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
await new Promise((resolve) => server.listen(3121, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({
      viewport: { width: 1400, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:3121/#cards");
  await page
    .getByLabel("명함 이미지 선택")
    .setInputFiles("output/card-rectification/real-pilot/inputs/photo-001.png");
  await page
    .getByRole("button", { name: "이 2D 이미지로 OCR 실행" })
    .waitFor({ timeout: 60000 });
  const preview = page.getByAltText("OCR에 사용할 2D 명함 이미지");
  await preview.waitFor({ timeout: 60000 });
  const dimensions = () =>
    preview.evaluate(async (img) => {
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    });
  const base = await dimensions(),
    turns = [];
  for (let i = 1; i <= 4; i++) {
    await page.getByRole("button", { name: "오른쪽으로 90도 회전" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: `${(i * 90) % 360}도 회전했습니다` })
      .waitFor({ timeout: 10000 });
    const dims = await dimensions();
    assert.deepEqual(dims, i % 2 ? [base[1], base[0]] : base);
    turns.push({ angle: (i * 90) % 360, dimensions: dims });
  }
  for (const angle of [90, 180, 270]) {
    await page.getByRole("button", { name: "오른쪽으로 90도 회전" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: `${angle}도 회전했습니다` })
      .waitFor();
  }
  await page.screenshot({
    path: resolve(output, "rotation-ui.png"),
    fullPage: true,
  });
  const inputs = await preview.evaluate(async (img) => {
    const original = new File(
      [await (await fetch("/pilot/inputs/photo-001.png")).blob()],
      "photo-001.png",
      { type: "image/png" },
    );
    const before = await window.quickPrepare(original);
    const restored = new File(
      [await (await fetch(img.src)).blob()],
      "rotated.jpg",
      { type: "image/jpeg" },
    );
    const after = await window.quickPrepare(restored);
    return {
      original: Array.from(
        new Uint8Array(await before.originalFile.arrayBuffer()),
      ),
      before: Array.from(
        new Uint8Array(await before.displayFile.arrayBuffer()),
      ),
      after: Array.from(new Uint8Array(await after.displayFile.arrayBuffer())),
      originalWidth: before.originalWidth,
      originalHeight: before.originalHeight,
      beforeWidth: before.displayWidth,
      beforeHeight: before.displayHeight,
      afterWidth: after.displayWidth,
      afterHeight: after.displayHeight,
    };
  });
  for (const key of ["original", "before", "after"])
    await writeFile(
      resolve(output, `ocr-${key}.jpg`),
      Buffer.from(inputs[key]),
    );
  const metadata = Object.fromEntries(
    Object.entries(inputs).filter(
      ([key]) => !["original", "before", "after"].includes(key),
    ),
  );
  await writeFile(
    resolve(output, "ocr-input-metadata.json"),
    JSON.stringify(metadata, null, 2),
  );
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/business-cards") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "이 2D 이미지로 OCR 실행" }).click();
  const response = await responsePromise,
    receipt = await response.json();
  assert.ok([200, 201].includes(response.status()));
  assert.equal(
    receipt.testDiagnostics.processingRecipe,
    "docaligner-lc100-card-v1",
  );
  const d = receipt.testDiagnostics;
  assert.ok(
    Math.abs(d.displayWidth / d.displayHeight - base[1] / base[0]) < 0.01,
  );
  await page
    .getByRole("heading", { name: "인식한 명함 정보", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  const summary = {
    scope:
      "Actual BusinessCardWorkspace bundled in local React harness; Mock OCR; not full Next route E2E",
    baseDimensions: base,
    turns,
    ocrInputDisplayDimensions: [d.displayWidth, d.displayHeight],
    mockOcrRouting: "PASS",
    pageErrors: errors,
    externalOcrCalls: 0,
  };
  await writeFile(
    resolve(output, "rotation-ui-summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary));
} finally {
  await browser.close();
  server.close();
}
