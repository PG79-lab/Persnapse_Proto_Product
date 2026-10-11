import { expect, test, type Page } from "@playwright/test";
import type { SearchPreparationStatus } from "../../src/domain/recall/search-preparation";
test("explicit search, evidence, feedback and retry preserve user input", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/**", (route) => route.abort());
  await page.route("**/people/**", (route) => route.abort());
  await page.route("**/api/recall", async (route) => {
    calls++;
    if (calls === 2)
      return route.fulfill({
        status: 503,
        json: { error: "검색 준비가 필요합니다." },
      });
    return route.fulfill({
      json: {
        queryId: "00000000-0000-4000-8000-000000000001",
        status: "resolved",
        answer: "김가람님과 논의했습니다.",
        analysis: "기록된 관심사를 바탕으로 다음 대화를 준비할 수 있습니다.",
        mode: "live",
        model: "test",
        latencyMs: 40,
        parsedQuery: { intents: ["person_lookup"], dateRange: null },
        results: [
          {
            personId: "person-test",
            displayName: "김가람",
            headline: "제품 담당",
            organizations: ["가온빛"],
            reason: "대전에서 양자컴퓨팅을 논의한 기록입니다.",
            evidence: [
              {
                id: "meeting-test",
                type: "interaction",
                excerpt: "대전에서 양자컴퓨팅을 논의했다.",
                occurredAt: null,
              },
            ],
            storedActions: [],
            suggestion: {
              type: "ai_suggestion",
              title: "논의한 주제로 후속 연락 검토",
              rationale: "관심사를 확인한 기록이 있습니다.",
            },
          },
        ],
      },
    });
  });
  await page.route("**/api/recall/observation", (route) =>
    route.fulfill({ json: { recorded: true } }),
  );
  await page.route("**/api/feedback", (route) =>
    route.fulfill({ json: { saved: true } }),
  );
  await page.goto("/recall?q=대전에서%20논의한%20사람");
  await expect(
    page.getByRole("button", { name: "기억 찾기", exact: true }),
  ).toBeVisible();
  expect(calls).toBe(0);
  await page.getByRole("button", { name: "기억 찾기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "김가람님과 논의했습니다." }),
  ).toBeVisible();
  await expect(
    page.getByText("대전에서 양자컴퓨팅을 논의했다.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "도움이 됐어요", exact: true })
    .click();
  await expect(page.getByText("평가를 남겼습니다. 감사합니다.")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/assistant-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(
    page.getByRole("navigation", { name: "주요 탐색" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/assistant-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "기억 찾기", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "검색 준비가 필요합니다." }),
  ).toBeVisible();
  await expect(page.getByLabel("관계 기억 검색")).toHaveValue(
    "대전에서 논의한 사람",
  );
});

test("switching input modes preserves an unfinished text note", async ({
  page,
}) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.route("**/people/**", (route) => route.abort());
  await page.goto("/capture");
  await page.getByRole("button", { name: "텍스트 메모", exact: true }).click();
  const note = page.locator("textarea:visible").first();
  await note.fill("어제 대전에서 양자컴퓨팅에 관해 이야기했다.");
  await page.getByRole("button", { name: "명함 촬영", exact: true }).click();
  await page.getByRole("button", { name: "텍스트 메모", exact: true }).click();
  await expect(note).toHaveValue("어제 대전에서 양자컴퓨팅에 관해 이야기했다.");
});

const incompletePreparation: SearchPreparationStatus = {
  mode: "live",
  ready: false,
  total: 3,
  prepared: 0,
  remaining: 3,
  retryable: 3,
  processing: 0,
};

async function interceptUnpreparedSearch(page: Page) {
  const queries: string[] = [];
  await page.route("**/api/**", (route) => route.abort());
  await page.route("**/people/**", (route) => route.abort());
  await page.route("**/api/recall", async (route) => {
    queries.push(route.request().postDataJSON().query);
    await route.fulfill({
      status: 503,
      json: {
        code: "SEARCH_NOT_READY",
        error: "저장된 기억의 검색 준비가 아직 완료되지 않았습니다.",
      },
    });
  });
  return queries;
}

test("search recovery requires explicit batches, blocks duplicate submissions and never searches automatically", async ({
  page,
}) => {
  const queries = await interceptUnpreparedSearch(page);
  let status = { ...incompletePreparation };
  let reads = 0;
  let submissions = 0;
  let releaseFirstBatch: (() => void) | undefined;
  const firstBatch = new Promise<void>((resolve) => {
    releaseFirstBatch = resolve;
  });
  await page.route("**/api/recall/preparation", async (route) => {
    if (route.request().method() === "GET") {
      reads++;
      return route.fulfill({ json: status });
    }
    submissions++;
    if (submissions === 1) await firstBatch;
    const completedCount = submissions === 1 ? 2 : 1;
    const prepared = status.prepared + completedCount;
    status = {
      ...status,
      prepared,
      ready: prepared === 3,
      remaining: 3 - prepared,
      retryable: 3 - prepared,
    };
    return route.fulfill({
      json: {
        status,
        attemptedCount: completedCount,
        completedCount,
        failureCount: 0,
        retryAfterSeconds: null,
      },
    });
  });
  await page.goto("/recall?q=행사에서%20만난%20사람");
  expect(queries).toHaveLength(0);
  expect(reads).toBe(0);
  await page.getByRole("button", { name: "기억 찾기", exact: true }).click();
  const recovery = page.getByRole("region", { name: "검색 준비 복구" });
  await expect(recovery.getByText("검색 준비 0/3명")).toBeVisible();
  expect(submissions).toBe(0);
  await recovery
    .getByRole("button", { name: "검색 준비 다시 시도", exact: true })
    .click();
  await expect.poll(() => submissions).toBe(1);
  const processing = recovery.getByRole("button", {
    name: "검색 준비 중…",
    exact: true,
  });
  await expect(processing).toBeDisabled();
  await processing.dispatchEvent("click");
  expect(submissions).toBe(1);
  releaseFirstBatch?.();
  await expect(recovery.getByText("검색 준비 2/3명")).toBeVisible();
  expect(queries).toHaveLength(1);
  await recovery
    .getByRole("button", { name: "검색 준비 다시 시도", exact: true })
    .click();
  await expect(recovery.getByText("검색 준비 3/3명")).toBeVisible();
  await expect(recovery.getByRole("status")).toContainText("기억 찾기를 다시");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  expect(queries).toHaveLength(1);
  await expect(page.getByLabel("관계 기억 검색")).toHaveValue(
    "행사에서 만난 사람",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/search-recovery-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "기억 찾기", exact: true }).click();
  await expect.poll(() => queries.length).toBe(2);
  expect(queries).toEqual(["행사에서 만난 사람", "행사에서 만난 사람"]);
});

test("a failed status read preserves the query and can recover without paid preparation", async ({
  page,
}) => {
  const queries = await interceptUnpreparedSearch(page);
  let reads = 0;
  let submissions = 0;
  await page.route("**/api/recall/preparation", async (route) => {
    if (route.request().method() === "POST") submissions++;
    reads++;
    if (reads === 1)
      return route.fulfill({
        status: 503,
        json: { error: "저장소 연결을 확인한 뒤 다시 시도해 주세요." },
      });
    return route.fulfill({
      json: {
        ...incompletePreparation,
        ready: true,
        prepared: 3,
        remaining: 0,
        retryable: 0,
      },
    });
  });
  await page.goto("/recall?q=어제%20만난%20사람");
  await page.getByRole("button", { name: "기억 찾기", exact: true }).click();
  const recovery = page.getByRole("region", { name: "검색 준비 복구" });
  await expect(recovery.getByRole("alert")).toContainText("저장소 연결");
  await recovery.getByRole("button", { name: "준비 상태 다시 확인" }).click();
  await expect(recovery.getByRole("status")).toContainText("검색 준비가 완료");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("관계 기억 검색")).toHaveValue("어제 만난 사람");
  expect(submissions).toBe(0);
  expect(queries).toHaveLength(1);
});

test("a rate limit preserves progress and requires a later explicit retry", async ({
  page,
}) => {
  const queries = await interceptUnpreparedSearch(page);
  let submissions = 0;
  await page.route("**/api/recall/preparation", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: incompletePreparation });
    submissions++;
    return route.fulfill({
      json: {
        status: {
          ...incompletePreparation,
          prepared: 1,
          remaining: 2,
          retryable: 2,
        },
        attemptedCount: 2,
        completedCount: 1,
        failureCount: 1,
        retryAfterSeconds: 1,
      },
    });
  });
  await page.goto("/recall?q=제안서를%20보낼%20사람");
  await page.getByRole("button", { name: "기억 찾기", exact: true }).click();
  const recovery = page.getByRole("region", { name: "검색 준비 복구" });
  await recovery.getByRole("button", { name: "검색 준비 다시 시도" }).click();
  await expect(recovery.getByText("검색 준비 1/3명")).toBeVisible();
  await expect(recovery.getByRole("alert")).toContainText("약 1초 후");
  await expect(
    recovery.getByRole("button", { name: "잠시 후 다시 시도" }),
  ).toBeDisabled();
  await expect(
    recovery.getByRole("button", { name: "검색 준비 다시 시도" }),
  ).toBeEnabled();
  expect(submissions).toBe(1);
  expect(queries).toHaveLength(1);
  await expect(page.getByLabel("관계 기억 검색")).toHaveValue(
    "제안서를 보낼 사람",
  );
});
