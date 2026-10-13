import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve("output/card-rectification/real-pilot");
const manifest = JSON.parse(
  await readFile(resolve(root, "photos.json"), "utf8"),
);
const output = resolve(root, "pipeline-2026-10-13");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
});
const rows = [];
const errors = [];
try {
  for (const image of manifest.images) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.on("pageerror", (e) =>
      errors.push({ imageId: image.imageId, error: e.message }),
    );
    await page.goto("http://127.0.0.1:3100/#cards");
    const started = Date.now();
    await page
      .getByLabel("명함 이미지 선택")
      .setInputFiles(resolve(root, image.file));
    await page
      .getByRole("heading", { name: "명함 테두리·2D 이미지 확인" })
      .waitFor({ timeout: 60_000 });
    const detected = await page
      .getByRole("button", { name: "이 2D 이미지로 OCR 실행" })
      .isEnabled();
    const row = {
      imageId: image.imageId,
      detected,
      elapsedMs: Date.now() - started,
    };
    let captureId;
    if (detected) {
      row.timings = await page
        .getByLabel("명함 단계별 처리 시간")
        .textContent();
      const preview = page.getByAltText("OCR에 사용할 2D 명함 이미지");
      const bytes = await preview.evaluate(async (img) =>
        Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())),
      );
      await writeFile(
        resolve(output, `${image.imageId}-rectified.jpg`),
        Buffer.from(bytes),
      );
      const requestPromise = page.waitForRequest(
        (req) =>
          req.url().endsWith("/api/business-cards") && req.method() === "POST",
      );
      await page
        .getByRole("button", { name: "이 2D 이미지로 OCR 실행" })
        .click();
      const request = await requestPromise;
      const receipt = await (await request.response()).json();
      const diagnostic = receipt.testDiagnostics;
      assert.equal(diagnostic.processingRecipe, "docaligner-lc100-card-v1");
      assert.ok(diagnostic.displayWidth > 0);
      assert.notEqual(diagnostic.originalSha256, diagnostic.displaySha256);
      await page
        .getByRole("heading", { name: "인식한 명함 정보", exact: true })
        .waitFor({ timeout: 20_000 });
      captureId = receipt.captureId;
      row.ocr = "MOCK_ROUTING_PASS";
      row.width = diagnostic.displayWidth;
      row.height = diagnostic.displayHeight;
      if (image.imageId === "photo-001")
        await page.screenshot({
          path: resolve(output, "ocr-review.png"),
          fullPage: true,
        });
    } else {
      row.ocr = "NOT_RUN_NEEDS_MANUAL_CORNERS";
      assert.ok(
        await page
          .getByRole("button", { name: "지정한 영역으로 보정" })
          .isVisible(),
      );
    }
    rows.push(row);
    await writeFile(
      resolve(output, "rows.json"),
      JSON.stringify(rows, null, 2),
    );
    // Each browser uses one card; clear only this test gateway's in-memory cards.
    if (captureId)
      await context.request.delete(
        `http://127.0.0.1:3100/api/business-cards/${captureId}`,
      );
    await context.close();
    console.log(`${image.imageId}: ${row.ocr}`);
  }
  assert.deepEqual(errors, []);
  const summary = {
    images: rows.length,
    detected: rows.filter((r) => r.detected).length,
    needsManual: rows.filter((r) => !r.detected).map((r) => r.imageId),
    mockOcrRoutingPass: rows.filter((r) => r.ocr === "MOCK_ROUTING_PASS")
      .length,
    externalOcrCalls: 0,
    realOcrAccuracy: "NOT_RUN",
    errors,
    scope: "Real LC100 and warp; local mock OCR transport; no DB writes",
  };
  await writeFile(
    resolve(output, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary));
} finally {
  await browser.close();
}
