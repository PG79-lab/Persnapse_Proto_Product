import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { getDatabase, closeDatabase } from "../../src/server/db/client";
import { removeBusinessCardAssets } from "../../src/server/storage/business-card-storage";
import { createSyntheticBusinessCardImage } from "../ai/synthetic-business-card-image";

if (!process.argv.includes("--confirm-test-writes"))
  throw Error("Isolated test writes must be explicit.");
const fixtureId = randomUUID(),
  marker = `browser-integration-${fixtureId}`;
assert(fixtureId !== process.env.APP_DEFAULT_WORKSPACE_ID);
const sql = getDatabase();
const checks: string[] = [];
const errors: string[] = [];
const report: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  verified: false,
  checks,
};
const port = Number(process.env.INTEGRATION_BROWSER_PORT ?? 3399);
const base = `http://127.0.0.1:${port}`;
await mkdir("test-results/integration-browser", { recursive: true });
await sql`insert into public.workspaces(id,name) values(${fixtureId},${marker})`;
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
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_DEFAULT_WORKSPACE_ID: fixtureId,
      AI_ROUTING_MODE: "mock",
      BUSINESS_CARD_OCR_MODE: "mock",
      APP_REMOTE_PROTOTYPE_ACCESS: "off",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverFailed = false;
server.on("exit", () => {
  serverFailed = true;
});
server.stdout?.resume();
server.stderr?.resume();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  for (let tries = 0; tries < 60; tries++) {
    if (serverFailed) throw Error("Isolated server did not start.");
    try {
      if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) break;
    } catch {}
    if (tries === 59) throw Error("Isolated server startup timeout");
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(15000);
  await page.goto(base);
  await expect(
    page.getByRole("heading", { level: 1, name: "일정/업무관리" }),
  ).toBeVisible();
  await expect(page.locator(".save-state")).toHaveText("저장됨");
  await page.getByRole("button", { name: "사이드바 접기" }).click();
  await page.getByRole("button", { name: "사이드바 열기" }).click();
  checks.push("workspace loads server state and sidebar toggles");
  console.log("[browser] workspace loaded");
  // Commit a real HTTP write, then drop only its response. The UI must preserve
  // the draft and recover the same request without inserting another task.
  let dropWriteResponse = true;
  await page.route("**/api/workspace", async (route) => {
    if (dropWriteResponse && route.request().method() === "POST") {
      dropWriteResponse = false;
      const committed = await route.fetch();
      assert.equal(committed.status(), 200);
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "할 일 추가", exact: true })
    .first()
    .click();
  let dialog = page.getByRole("dialog", { name: "할 일 추가" });
  await dialog
    .getByLabel("할 일", { exact: true })
    .fill("Browser independent task");
  await dialog.getByRole("button", { name: "추가", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("할 일", { exact: true })).toHaveValue(
    "Browser independent task",
  );
  await dialog.getByRole("button", { name: "이전 저장 확인" }).click();
  await expect(
    dialog.getByText(
      "이전 저장을 확인했습니다. 내용을 확인하고 저장 버튼을 다시 눌러 주세요.",
    ),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "추가", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.unroute("**/api/workspace");
  const recovered = await fetch(`${base}/api/workspace`).then((r) => r.json());
  assert.equal(
    recovered.state.todos.filter(
      (t: { text: string }) => t.text === "Browser independent task",
    ).length,
    1,
  );
  checks.push(
    "lost save response preserves the editor and recovers exactly one task",
  );
  await expect(
    page.getByText("Browser independent task", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Browser independent task", { exact: true }),
  ).toBeVisible();
  checks.push("independent task survives real server reload");
  console.log("[browser] independent task saved");
  await page
    .getByRole("button", { name: "인맥 관리", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "인맥 추가", exact: true })
    .first()
    .click();
  dialog = page.getByRole("dialog", { name: "새로운 인맥" });
  await dialog.getByLabel("이름").fill("브라우저검증");
  await dialog.getByRole("button", { name: "인맥 저장" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("dialog", { name: "인맥 프로필" })).toBeVisible();
  const profile = page.getByRole("dialog", { name: "인맥 프로필" });
  await profile.getByRole("button", { name: "정보", exact: true }).click();
  await profile
    .getByRole("button", { name: "브라우저검증", exact: true })
    .click();
  await profile
    .getByRole("textbox", { name: "이름", exact: true })
    .fill("수정 중인 내 이름");
  const beforeConcurrent = await fetch(`${base}/api/workspace`).then((r) =>
    r.json(),
  );
  const originalPerson = beforeConcurrent.state.people.find(
    (p: { name: string }) => p.name === "브라우저검증",
  );
  const personFields = [
    "name",
    "company",
    "job",
    "email",
    "phone",
    "status",
    "importance",
    "relationshipCategories",
  ];
  const externalEdit = await fetch(`${base}/api/workspace`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: randomUUID(),
      operations: [
        {
          type: "person.save",
          id: originalPerson.id,
          version: originalPerson.version,
          value: {
            ...Object.fromEntries(
              personFields.map((k) => [k, originalPerson[k]]),
            ),
            name: "다른 기기에서 변경한 이름",
          },
        },
      ],
    }),
  });
  assert.equal(externalEdit.status, 200);
  await externalEdit.json();
  // Refresh through another conflicted control while the name input stays open.
  // Its saved revision must remain the one captured when editing began.
  await profile.getByLabel("관계 상태").selectOption("success");
  await expect(profile.getByRole("alert")).toContainText("다른 기기");
  const saveResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/workspace") && r.request().method() === "POST",
  );
  await profile.getByRole("button", { name: "이름 저장", exact: true }).click();
  assert.equal((await saveResponse).status(), 409);
  await expect(
    profile.getByRole("textbox", { name: "이름", exact: true }),
  ).toHaveValue("수정 중인 내 이름");
  const afterConcurrent = await fetch(`${base}/api/workspace`).then((r) =>
    r.json(),
  );
  assert.equal(
    afterConcurrent.state.people.find(
      (p: { id: string }) => p.id === originalPerson.id,
    ).name,
    "다른 기기에서 변경한 이름",
  );
  checks.push(
    "inline profile draft cannot overwrite another device even after a conflict refresh",
  );
  await page
    .getByRole("dialog", { name: "인맥 프로필" })
    .getByRole("button", { name: "닫기", exact: true })
    .click();
  checks.push("person creation opens its server UUID profile");
  await page
    .getByRole("button", { name: "만남 기록", exact: true })
    .first()
    .click();
  await page
    .locator(".page-actions")
    .getByRole("button", { name: "만남 기록", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "만남 기록" });
  await dialog.getByLabel("만남 이름").fill("Browser guest meeting");
  await dialog.getByLabel("날짜", { exact: true }).fill("");
  await dialog.getByLabel("처음 만난 사람 · 게스트").fill("처음 만난 게스트");
  await dialog.getByRole("button", { name: "만남 저장" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("Browser guest meeting", { exact: true }).first(),
  ).toBeVisible();
  checks.push(
    "guest-only meeting is saved without a fabricated person or date",
  );
  await page
    .getByRole("button", { name: "관계 지도", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("group", { name: "인맥 관계 지도" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/integration-browser/desktop-map.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "일정/업무관리", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "기록 남기기", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "AI로 기록하기" });
  await dialog
    .getByLabel("관계 맥락")
    .fill(
      "2026-10-08 코엑스에서 검증하늘님과 물류 실증을 이야기했다. 다음 주에 제안서를 보내기로 했다.",
    );
  await dialog.getByRole("button", { name: "구조화하고 검토하기" }).click();
  await expect(dialog.getByText("검토 중 · 아직 저장되지 않음")).toBeVisible({
    timeout: 30000,
  });
  await dialog.getByRole("button", { name: "확인하고 Memory 저장" }).click();
  await expect(
    dialog.getByText(
      "기존 Person 연결 또는 신규 Person 생성을 직접 선택해 주세요.",
    ),
  ).toBeVisible();
  await dialog.getByRole("radio", { name: /신규 Person 생성/ }).check();
  await dialog.getByPlaceholder("저장할 이름").fill("검증하늘");
  await dialog.getByRole("button", { name: "확인하고 Memory 저장" }).click();
  await expect(
    dialog.getByText("검토한 관계 기억이 저장되었습니다."),
  ).toBeVisible({ timeout: 30000 });
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  checks.push(
    "real Capture review requires explicit identity and commits canonical memory",
  );
  console.log("[browser] Capture committed");
  await page.getByLabel("AI에게 질문").fill("물류 실증");
  await page.getByRole("button", { name: "질문 보내기" }).click();
  await expect(page.locator(".chat-answer .answer-person").first()).toBeVisible(
    { timeout: 30000 },
  );
  await page.getByRole("button", { name: "도움이 됐어요" }).click();
  await expect(page.getByText("피드백이 저장되었습니다.")).toBeVisible();
  checks.push(
    "chat Recall renders real evidence and persists feedback (mock models)",
  );
  await page.screenshot({
    path: "test-results/integration-browser/desktop-work.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "명함 등록", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "명함 등록" }),
  ).toBeVisible();
  process.env.PLAYWRIGHT_CHANNEL = "chrome";
  const card = await createSyntheticBusinessCardImage(fixtureId);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "synthetic-integration-card.png",
      mimeType: "image/png",
      buffer: Buffer.from(card.bytes),
    });
  await expect(page.getByText("인식한 명함 정보", { exact: true })).toBeVisible(
    { timeout: 30000 },
  );
  await page
    .getByPlaceholder(
      "만난 행사, 장소, 이야기한 주제와 후속 약속을 편하게 적어주세요.",
    )
    .fill("코엑스에서 물류 실증을 논의하고 다음 주에 자료를 전달하기로 했다.");
  await page
    .getByRole("button", { name: "맥락 분석하고 연결 후보 찾기" })
    .click();
  await page
    .getByRole("radio", { name: /신규 Person 생성/ })
    .check({ timeout: 30000 });
  await page
    .getByLabel("신규 Person 이름", { exact: true })
    .fill("OCR브라우저검증");
  await page
    .getByRole("button", { name: "확인하고 Digital Card 저장" })
    .click();
  await expect(page.getByText("명함과 관계 맥락이 연결됐습니다.")).toBeVisible({
    timeout: 30000,
  });
  const cardState = await fetch(`${base}/api/workspace`).then((r) => r.json());
  const cardPerson = cardState.state.people.find(
    (p: { name: string }) => p.name === "OCR브라우저검증",
  );
  assert.equal(cardPerson.businessCards.length, 1);
  const asset = await fetch(
    `${base}/api/source-assets/${cardPerson.businessCards[0].displayAssetId}`,
  );
  assert.equal(asset.status, 200);
  assert(asset.headers.get("content-type")?.startsWith("image/"));
  await asset.arrayBuffer();
  checks.push(
    "OCR UI upload, explicit review, commit and private stored image work end to end (mock OCR)",
  );
  console.log("[browser] card committed and private image fetched");
  await page.getByRole("button", { name: "녹음", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { level: 1, name: "녹음" }),
  ).toBeVisible();
  checks.push("card and recording navigation render without runtime errors");
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobile.newPage();
  mobilePage.on("pageerror", (e) => errors.push(e.message));
  await mobilePage.goto(base);
  await expect(
    mobilePage.getByText("Browser independent task", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await mobilePage.screenshot({
    path: "test-results/integration-browser/mobile-work.png",
    fullPage: true,
  });
  const horizontalOverflow = await mobilePage.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  );
  assert.equal(horizontalOverflow, false);
  checks.push(
    "second mobile browser reads the same stored work without horizontal overflow",
  );
  const started = performance.now();
  const requests = await Promise.all(
    Array.from({ length: 6 }, () =>
      fetch(`${base}/api/workspace`).then(async (r) => ({
        status: r.status,
        state: (await r.json()).state as WorkspaceState,
      })),
    ),
  );
  assert(
    requests.every(
      (r) =>
        r.status === 200 &&
        r.state.todos.some((t) => t.text === "Browser independent task"),
    ),
  );
  report.sixClientReadBatchMs = Math.round(performance.now() - started);
  checks.push("six concurrent clients read consistent workspace data");
  assert.deepEqual(errors, []);
  report.verified = true;
} catch (error) {
  report.error =
    error instanceof Error ? error.message : "Browser verification failed";
  report.pageErrors = errors;
  process.exitCode = 1;
  const pages = browser?.contexts().flatMap((c) => c.pages()) ?? [];
  for (let i = 0; i < pages.length; i++)
    await pages[i]
      .screenshot({
        path: `test-results/integration-browser/failure-${i}.png`,
        fullPage: true,
      })
      .catch(() => {});
} finally {
  await browser?.close();
  server.kill();
  const assets =
    await sql`select storage_path from public.source_assets where workspace_id=${fixtureId} and storage_path is not null`;
  const paths = assets.map((a) => String(a.storage_path));
  assert(paths.every((path) => path.startsWith(fixtureId + "/")));
  await removeBusinessCardAssets(paths);
  await sql`delete from public.ai_call_reservations where workspace_id=${fixtureId}`;
  await sql`delete from public.workspaces where id=${fixtureId} and name=${marker}`;
  const tables =
    await sql`select table_name from information_schema.columns where table_schema='public' and column_name='workspace_id'`;
  let residual = 0;
  for (const table of tables) {
    const [row] =
      await sql`select count(*)::int as count from ${sql(`public.${table.table_name}`)} where workspace_id=${fixtureId}`;
    residual += row.count;
  }
  report.fixtureRowsRemaining = residual;
  if (residual) {
    report.verified = false;
    process.exitCode = 1;
  }
  report.reportPath = `test-results/integration-browser/result-${fixtureId}.json`;
  await writeFile(String(report.reportPath), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await closeDatabase();
}

type WorkspaceState =
  import("../../src/domain/workspace/contracts").WorkspaceState;
