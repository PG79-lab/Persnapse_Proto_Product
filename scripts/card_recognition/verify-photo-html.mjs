import { chromium } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, stat, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const root = resolve("output/card-rectification/real-pilot");
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
});
try {
  const context = await browser.newContext({
    offline: true,
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  const network = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  await page.goto(
    pathToFileURL(
      resolve(root, "card-boundary-comparison-LC100-2026-10-13.html"),
    ).href,
  );
  assert.equal(await page.locator("article").count(), 27);
  assert.equal(await page.locator("a[data-overlay]").count(), 81);
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll("img")];
    images.forEach((img) => img.removeAttribute("loading"));
    await Promise.all(images.map((img) => img.decode()));
    if (images.some((img) => !img.naturalWidth))
      throw new Error("Image did not decode");
  });
  const download = page.waitForEvent("download");
  await page.locator("a[data-overlay]").first().click();
  const png = await download;
  assert.match(png.suggestedFilename(), /^docaligner-lc100-.*\.png$/);
  const pngBytes = (await stat(await png.path())).size;
  assert.ok(pngBytes > 1000);
  await page.locator("article details").first().locator("summary").click();
  await page.locator("article .confirm").first().click();
  const labelDownload = page.waitForEvent("download");
  await page.locator("#save").click();
  const labels = await labelDownload;
  assert.equal(labels.suggestedFilename(), "card-labels-and-evaluation.json");
  const jsonBytes = (await stat(await labels.path())).size;
  assert.ok(jsonBytes > 1000);
  const exported = JSON.parse(await readFile(await labels.path(), "utf8"));
  assert.equal(exported.evaluation.length, 81);
  assert.equal(exported.labels["photo-001"].status, "confirmed");
  assert.equal(exported.quality, "PROVISIONAL_SINGLE_REVIEW");
  await page.locator("#import").setInputFiles(await labels.path());
  const csvDownload = page.waitForEvent("download");
  await page.locator('a[download="measurements.csv"]').click();
  assert.equal((await csvDownload).suggestedFilename(), "measurements.csv");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(root, "offline-html-verified.png") });
  assert.deepEqual(network, []);
  assert.deepEqual(errors, []);
  const result = {
    status: "PASS",
    offline: true,
    images: 27,
    overlays: 81,
    pngBytes,
    jsonBytes,
    network,
    errors,
  };
  await writeFile(
    resolve(root, "offline-html-check.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
