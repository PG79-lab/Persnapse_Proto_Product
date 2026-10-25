import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { frontendGraphSnapshot } from "../../src/features/workspace/preview/fixture";
import { isolatedEnvironment } from "../testing/environment.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const folder = resolve(root, "docs/system-explorer-refined");
await mkdir(resolve(folder, "screenshots"), { recursive: true });
const port = await new Promise<number>((res, reject) => {
  const probe = createServer();
  probe.on("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (!address || typeof address === "string")
      return reject(new Error("No port"));
    probe.close(() => res(address.port));
  });
});
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd: root,
    env: { ...process.env, ...isolatedEnvironment },
    stdio: "ignore",
    windowsHide: true,
  },
);
let serverError: Error | undefined;
server.on("error", (error) => {
  serverError = error;
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (serverError) throw serverError;
    if (server.exitCode !== null)
      throw new Error("Document capture server exited");
    try {
      ready = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      /* startup */
    }
    if (ready) break;
    await new Promise((res) => setTimeout(res, 500));
  }
  if (!ready)
    throw new Error("Document capture server did not start; build first");
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    serviceWorkers: "block",
  });
  const cardPage = await context.newPage();
  await cardPage.setContent(
    '<main style="box-sizing:border-box;width:720px;height:420px;padding:48px;background:#f6faf7;color:#16372d;font-family:Arial,sans-serif"><p style="font-size:20px">문서용 합성 명함 · 실제 연락처 아님</p><h1 style="font-size:48px;margin:45px 0 10px">김민수</h1><p style="font-size:26px">가온벤처스 · 투자 심사역</p><p style="font-size:22px">person1@example.test</p></main>',
  );
  const cardImage = await cardPage.locator("main").screenshot();
  await cardPage.close();
  const draft = {
    schemaVersion: "business-card-draft-v1",
    identity: {
      displayName: "김민수",
      organizationName: "가온벤처스",
      title: "투자 심사역",
      department: null,
      emails: ["person1@example.test"],
      phones: [],
      contactNumbers: [],
      websites: [],
      address: null,
    },
    interaction: {
      interactionType: "meeting",
      occurredAt: "2026-10-25T03:00:00Z",
      summary: "제품 소개와 후속 자료 전달을 논의했다.",
      location: null,
      eventName: null,
    },
    topics: [],
    memories: [],
    actions: [],
    observedFields: [
      "identity.displayName",
      "identity.organizationName",
      "identity.title",
      "identity.emails",
    ],
    inferredFields: [],
  };
  const card = {
    captureId: "10000000-0000-4000-8000-000000000005",
    state: "draft",
    stage: "card_result",
    originalAssetId: "11000000-0000-4000-8000-000000000005",
    displayAssetId: "12000000-0000-4000-8000-000000000005",
    imageUrl: `data:image/png;base64,${cardImage.toString("base64")}`,
    draft,
    modelDraft: draft,
    fieldsConfirmedAt: "2026-10-25T03:00:00Z",
    contextNote: "",
    identityCandidates: [],
    userCorrectionCount: 0,
    ocrProvider: "mock",
    ocrLatencyMs: 0,
    lastErrorCode: null,
    commitResult: null,
    createdAt: "2026-10-25T03:00:00Z",
  };
  const snapshot = frontendGraphSnapshot();
  snapshot.capabilities.assistantContext = true;
  const blocked: string[] = [];
  const errors: string[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin) {
      blocked.push(url.origin);
      return route.abort();
    }
    if (url.pathname.startsWith("/api/")) {
      if (request.method() === "GET" && url.pathname === "/api/workspace")
        return route.fulfill({ json: snapshot });
      if (request.method() === "GET" && url.pathname === "/api/business-cards")
        return route.fulfill({ json: [card] });
      if (
        request.method() === "GET" &&
        url.pathname.startsWith("/api/assistant/sessions/")
      )
        return route.fulfill({
          status: 404,
          json: { error: "No synthetic conversation yet" },
        });
      if (
        request.method() === "GET" &&
        url.pathname.startsWith("/api/source-assets/")
      )
        return route.fulfill({ body: cardImage, contentType: "image/png" });
      blocked.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "DOCUMENT_CAPTURE_ONLY",
            message: "합성 화면 촬영에서는 실행하지 않는 기능입니다.",
          },
        },
      });
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-10-25T03:00:00Z"));
  async function visit(route: string) {
    await page.goto(origin + "/" + route);
    await expect(
      page.getByRole("navigation", { name: "주요 메뉴" }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
  }
  async function capture(id: string, selector?: string) {
    const path = resolve(folder, "screenshots", `${id}.png`);
    if (selector)
      await page.locator(selector).screenshot({ path, animations: "disabled" });
    else await page.screenshot({ path, animations: "disabled" });
    console.log(`Captured synthetic ${id}`);
  }
  for (const id of [
    "map",
    "people",
    "meetings",
    "todos",
    "cards",
    "recordings",
  ]) {
    await visit(`#${id}`);
    if (id === "people")
      await expect(page.locator(".people-table-row")).toHaveCount(8);
    if (id === "cards")
      await expect(page.getByText("확인한 명함 정보")).toBeVisible();
    await capture(id);
  }
  await visit("?assistant=1#todos");
  await page
    .locator(".connected-thread")
    .evaluate((element) => element.scrollTo({ top: 0, behavior: "instant" }));
  await capture("assistant", ".connected-assistant");
  await page.getByRole("button", { name: "기록 남기기", exact: true }).click();
  await page
    .getByLabel("관계 맥락")
    .fill(
      "김민수 님과 제품의 첫 사용 경험에 대해 이야기했다. 다음 미팅 전에 제품 소개 자료를 전달하기로 했다.",
    );
  await capture("text", ".capture-dialog");
  await visit("#people");
  await page
    .locator(".people-table-row")
    .filter({ hasText: "가온벤처스" })
    .click();
  await page
    .getByRole("button", { name: "맞춤형 메일 초안", exact: true })
    .click();
  await capture("mail", ".mail-composer-modal");
  if (errors.length)
    throw new Error(`Capture browser errors: ${errors.join("; ")}`);
  const catalog = JSON.parse(
    await readFile(resolve(folder, "screenshots.json"), "utf8"),
  );
  catalog.capturedOn = "2026-10-25";
  catalog.dataMode = "synthetic";
  await writeFile(
    resolve(folder, "screenshots.json"),
    JSON.stringify(catalog, null, 2) + "\n",
  );
  await mkdir(resolve(root, "output/handoff"), { recursive: true });
  await writeFile(
    resolve(root, "output/handoff/capture-result.json"),
    JSON.stringify(
      {
        passed: true,
        screenshots: 9,
        dataMode: "synthetic",
        blocked,
        errors,
        externalApiCalls: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.kill();
}
