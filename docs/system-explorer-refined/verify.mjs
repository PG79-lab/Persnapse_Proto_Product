import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const require = createRequire(resolve(root, "package.json"));
const { chromium } = require("@playwright/test");
const output = resolve(root, "output/system-explorer-build/qa-refined");
await mkdir(output, { recursive: true });
const sha = (data) => createHash("sha256").update(data).digest("hex");
const normalize = (value) => value.replace(/\s+/g, " ").trim();
const source = await readFile(resolve(here, "report-source.txt"), "utf8");
const artifact = await readFile(resolve(here, "index.html"));
const manifest = JSON.parse(
  await readFile(resolve(here, "report-manifest.json"), "utf8"),
);
assert.equal(sha(source), manifest.sourceSHA256);
assert.equal(sha(artifact), manifest.htmlSHA256);
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHANNEL }
    : {}),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  locale: "ko-KR",
  offline: true,
});
const page = await context.newPage();
const errors = [],
  external = [],
  checks = [];
context.on("page", (p) =>
  p.on("pageerror", (error) => errors.push(error.message)),
);
page.on("pageerror", (error) => errors.push(error.message));
context.on("request", (request) => {
  if (/^https?:/.test(request.url())) external.push(request.url());
});
const url = pathToFileURL(resolve(here, "index.html")).href;
try {
  await page.goto(url);
  const body = normalize(await page.locator("article").textContent());
  for (const text of manifest.expected)
    assert.ok(
      body.includes(normalize(text)),
      "Missing content: " + text.slice(0, 100),
    );
  // Compare every edited source line/cell, including folded flow text.
  const originalLines = source
    .replace(/```mermaid[\s\S]*?```/g, "")
    .split(/\r?\n/);
  let retained = 0;
  for (let line of originalLines) {
    if (!line.trim() || line.startsWith("```")) continue;
    const cells = line.startsWith("|")
      ? line.replace(/^\||\|$/g, "").split("|")
      : [line];
    for (let cell of cells) {
      cell = cell.trim();
      if (/^:?-+:?$/.test(cell)) continue;
      const text = normalize(
        cell
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/^\*\*\d+\. /, "")
          .replace(/\*\*/g, "")
          .replace(/`/g, "")
          .replace(/^\d+\. /, "")
          .replace(/^- /, ""),
      );
      if (text) {
        assert.ok(
          body.includes(text),
          "Document source line missing: " + text.slice(0, 100),
        );
        retained++;
      }
    }
  }
  checks.push({
    check: "Edited document source rendered completely",
    linesAndCells: retained,
    sourceSHA256: sha(source),
  });
  assert.equal(await page.locator("article section").count(), 12);
  assert.equal(await page.locator("article table").count(), 14);
  const imageCount = manifest.figures.length + manifest.screenshots.length;
  assert.equal(await page.locator("article figure").count(), imageCount);
  assert.equal(await page.locator(".screen-figure").count(), 9);
  for (const screen of manifest.screenshots) {
    const figure = page.locator("#screen-" + screen.id);
    assert.equal(screen.dataMode, "synthetic");
    const embedded = await figure.locator("img").getAttribute("src");
    assert.ok(embedded.startsWith("data:image/png;base64,"));
    assert.equal(
      sha(Buffer.from(embedded.split(",")[1], "base64")),
      screen.sha256,
    );
    assert.equal(
      await figure.locator(".screen-link").getAttribute("href"),
      screen.url,
    );
    assert.equal(
      await figure.locator(".screen-link").getAttribute("target"),
      "_blank",
    );
    assert.equal(
      sha(await readFile(resolve(here, "screenshots", screen.file))),
      screen.sha256,
    );
  }
  assert.equal(await page.locator("nav a").count(), 12);
  for (const link of manifest.sourceLinks) await access(resolve(here, link));
  checks.push({
    check: "Repository source links resolve",
    count: manifest.sourceLinks.length,
  });
  for (const section of manifest.sections) {
    await page.locator('nav a[href="#' + section.id + '"]').click();
    assert.equal(
      await page
        .locator("#" + section.id)
        .evaluate((element) => Math.round(element.getBoundingClientRect().top)),
      25,
    );
  }
  await page.locator('nav a[href="#section-3"]').click();
  await page.screenshot({ path: resolve(output, "architecture-section.png") });
  for (let i = 0; i < imageCount; i++) {
    const button = page.locator("[data-image-open]").nth(i);
    await button.scrollIntoViewIfNeeded();
    await button.click();
    const dialog = page.locator("dialog");
    assert.ok(await dialog.isVisible());
    await page.waitForFunction(() => {
      const img = document.querySelector("dialog img");
      return img.complete && img.naturalWidth > 0;
    });
    await page.keyboard.press("Escape");
    assert.ok(!(await dialog.isVisible()));
  }
  checks.push({
    check: "12 table-of-contents anchors and all image previews work",
    imageCount,
    screenshotLinks: manifest.screenshots.length,
  });
  await page.goto(url);
  await page.screenshot({ path: resolve(output, "desktop.png") });
  await page.locator('nav a[href="#section-6"]').click();
  await page.screenshot({ path: resolve(output, "pipeline-section.png") });
  await page.locator("#screen-assistant").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, "screenshot-section.png") });
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(url);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Page overflow at " + width,
    );
  }
  assert.ok(!(await page.locator(".toc").evaluate((element) => element.open)));
  await page.locator(".toc summary").click();
  await page.locator('nav a[href="#section-7"]').click();
  assert.equal(
    await page
      .locator("#section-7")
      .evaluate((element) => Math.round(element.getBoundingClientRect().top)),
    15,
  );
  await page.goto(url);
  await page.screenshot({ path: resolve(output, "mobile.png") });
  await page.locator("#screen-text").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, "mobile-screenshot.png") });
  checks.push({
    check: "1440 / 1024 / 768 / 390 px layouts; mobile contents navigation",
  });
  await page.emulateMedia({ media: "print" });
  assert.ok(!(await page.locator("aside").isVisible()));
  assert.equal(await page.locator("article section:visible").count(), 12);
  assert.equal(await page.locator(".screen-figure:visible").count(), 9);
  checks.push({ check: "Print contains all 12 sections" });
  const figurePage = await context.newPage();
  for (const figure of manifest.figures) {
    const svg = await readFile(
      resolve(here, "figures", figure.name + ".svg"),
      "utf8",
    );
    assert.ok(!/<path\b/.test(svg), "Use only straight polyline connectors");
    await figurePage.setViewportSize({ width: 1320, height: 1000 });
    await figurePage.goto("about:blank");
    await figurePage.setContent(
      '<!doctype html><html lang="ko"><body style="margin:0">' +
        svg +
        "</body></html>",
    );
    const problems = await figurePage.evaluate(() => {
      const issues = [];
      for (const node of document.querySelectorAll("g")) {
        const rect = node.querySelector("rect");
        if (!rect) continue;
        const w = Number(rect.getAttribute("width")),
          h = Number(rect.getAttribute("height"));
        for (const text of node.querySelectorAll("text")) {
          const b = text.getBBox();
          if (b.x < 0 || b.y < 0 || b.x + b.width > w || b.y + b.height > h)
            issues.push(text.textContent);
        }
      }
      for (const polyline of document.querySelectorAll("polyline")) {
        const points = [...polyline.points];
        for (let i = 1; i < points.length; i++)
          if (
            points[i].x !== points[i - 1].x &&
            points[i].y !== points[i - 1].y
          )
            issues.push("diagonal connector");
      }
      return issues;
    });
    assert.deepEqual(problems, [], figure.name + " geometry");
    await figurePage.screenshot({
      path: resolve(output, figure.name + ".png"),
      fullPage: true,
    });
  }
  checks.push({
    check: "All 3 SVGs use orthogonal connectors; labels fit within nodes",
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.equal(sha(await readFile(resolve(here, "index.html"))), sha(artifact));
  const result = {
    passed: true,
    htmlSHA256: sha(artifact),
    checks,
    browserErrors: errors,
    externalRequests: external,
  };
  await writeFile(
    resolve(output, "verification.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
