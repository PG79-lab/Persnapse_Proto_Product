/** Smoke the running integrated Next app through the local Mock gateway. */
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const baseUrl = "http://127.0.0.1:3130";
const output = resolve("output/card-rectification/test-ready-2026-10-13");
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#cards`, { timeout: 60000 });
  await page
    .getByLabel("명함 이미지 선택")
    .setInputFiles("output/card-rectification/real-pilot/inputs/photo-001.png");
  const preview = page.getByAltText("OCR에 사용할 2D 명함 이미지");
  await preview.waitFor({ timeout: 60000 });
  const dimensions = () =>
    preview.evaluate(async (image) => {
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    });
  const before = await dimensions();
  await page.getByRole("button", { name: "오른쪽으로 90도 회전" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "90도 회전했습니다" })
    .waitFor();
  assert.deepEqual(await dimensions(), [before[1], before[0]]);
  await page.screenshot({
    path: resolve(output, "cards-ready.png"),
    fullPage: true,
  });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/business-cards") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "이 2D 이미지로 OCR 실행" }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 201);
  const receipt = await response.json();
  assert.equal(receipt.ocrProvider, "mock");
  assert.equal(
    receipt.testDiagnostics.processingRecipe,
    "docaligner-lc100-card-v1",
  );
  assert.deepEqual(
    [
      receipt.testDiagnostics.displayWidth,
      receipt.testDiagnostics.displayHeight,
    ],
    [before[1], before[0]],
  );
  await page
    .getByRole("heading", { name: "인식한 명함 정보", exact: true })
    .waitFor();
  await page.request.delete(
    `${baseUrl}/api/business-cards/${receipt.captureId}`,
  );
  assert.deepEqual(errors, []);
  const result = {
    url: `${baseUrl}/#cards`,
    scope: "Actual integrated Next app; real LC100 and warp; Mock OCR",
    beforeDimensions: before,
    ocrDimensions: [before[1], before[0]],
    errors,
    status: "PASS",
    liveApp: "http://127.0.0.1:3131/#cards",
  };
  await writeFile(
    resolve(output, "smoke.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
