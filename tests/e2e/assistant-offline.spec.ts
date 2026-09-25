import { expect, test } from "@playwright/test";
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
