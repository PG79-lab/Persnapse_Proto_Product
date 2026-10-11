import { expect, test } from "@playwright/test";
import { parseRecallQuery } from "../../src/domain/recall/query-parser";
import { buildRecallResponse } from "../../src/domain/recall/ranker";
import type { RecallCorpusPerson } from "../../src/domain/recall/types";

// UI regressions use a bounded synthetic corpus; do not write query logs to the
// shared workspace or spend provider calls as a side effect of npm test:e2e.
test.beforeEach(async ({ page }) => {
  const corpus: RecallCorpusPerson[] = [
    "부산 파일럿 제안서를 보내기로 했다",
    "서울 디자인 프로젝트를 논의했다",
  ].map((text, index) => ({
    id: `20000000-0000-4000-8000-00000000000${index + 1}`,
    displayName: "김민준",
    normalizedName: "김민준",
    headline: index ? "디자이너" : "물류 담당",
    organizations: [index ? "디자인연구소" : "물류연구소"],
    documentId: null,
    documentContent: text,
    evidence: [
      {
        id: `40000000-0000-4000-8000-00000000000${index + 1}`,
        type: "memory_statement",
        text,
        occurredAt: "2026-09-03T00:00:00Z",
        verificationStatus: "confirmed",
        memoryStatementId: null,
        memoryDocumentId: null,
        actionStatus: null,
      },
    ],
    actions: index
      ? []
      : [
          {
            id: "50000000-0000-4000-8000-000000000001",
            kind: "commitment",
            title: "부산 파일럿 제안서 전달",
            details: null,
            dueAt: null,
            status: "pending",
          },
        ],
  }));
  await page.route("**/api/recall", (route) => {
    const { query } = route.request().postDataJSON();
    return route.fulfill({
      json: buildRecallResponse(
        query,
        parseRecallQuery(query, new Date("2026-10-08T00:00:00Z")),
        corpus,
        1,
      ),
    });
  });
});

test("shows the integrated workspace and all six task menus", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "일정/업무관리",
  );
  for (const name of [
    "일정/업무관리",
    "관계 지도",
    "인맥 관리",
    "만남 기록",
    "명함 등록",
    "녹음",
  ])
    await expect(
      page.getByRole("button", { name, exact: true }).first(),
    ).toBeVisible();
});

test("opens a seeded person memory with timeline and evidence", async ({
  page,
}) => {
  await page.goto("/people");

  await expect(
    page.getByRole("heading", { level: 1, name: "만난 사람과 맥락" }),
  ).toBeVisible();
  await expect(
    page.getByText("저장된 관계 기억", { exact: true }),
  ).toBeVisible();

  await page
    .locator('a[href="/people/20000000-0000-4000-8000-000000000001"]')
    .click();

  await expect(
    page.getByRole("heading", { level: 1, name: "김민준" }),
  ).toBeVisible();
  await expect(page.getByText("동명이인 · 소속과 맥락으로 구분")).toBeVisible();
  await expect(page.getByText("부산 파일럿 제안서 전달")).toBeVisible();
  await expect(page.getByText("2026년 9월 3일")).toBeVisible();
  await expect(page.getByText(/확인됨 · 메모/).first()).toBeVisible();
});

test("recalls a person from context with evidence and safe actions", async ({
  page,
}) => {
  await page.goto(
    "/recall?q=%EB%B6%80%EC%82%B0%20%ED%8C%8C%EC%9D%BC%EB%9F%BF%20%EC%A0%9C%EC%95%88%EC%84%9C%EB%A5%BC%20%EB%B3%B4%EB%82%B4%EA%B8%B0%EB%A1%9C%20%ED%95%9C%20%EC%82%AC%EB%9E%8C",
  );

  await expect(
    page.getByRole("heading", { level: 1, name: "기억을 찾고, 다음 행동으로" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "기억 찾기", exact: true }).click();
  await expect(
    page.getByText(/가장 관련 있는 사람은 김민준님입니다/),
  ).toBeVisible();
  await page
    .getByText(/^확인된 근거 \d/)
    .first()
    .click();
  await expect(page.getByText(/확인된 근거 ·/).first()).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "저장된 다음 행동" }).first(),
  ).toBeVisible();
  await expect(page.getByText("실행하지 않음").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "후속 연락 안내" }).first(),
  ).toBeVisible();
  await expect(page.getByText(/자동 실행하지 않습니다/).first()).toBeVisible();
});

test("keeps duplicate names ambiguous until context is added", async ({
  page,
}) => {
  await page.goto("/recall?q=%EA%B9%80%EB%AF%BC%EC%A4%80");
  await page.getByRole("button", { name: "기억 찾기", exact: true }).click();

  await expect(page.getByText("구분 필요", { exact: true })).toBeVisible();
  await expect(page.getByText(/여러 사람이 있습니다/)).toBeVisible();
  await expect(
    page.locator('a[href^="/people/"]').filter({ hasText: "김민준" }),
  ).toHaveCount(2);
});

test("shows an explicit no-result state without invented evidence", async ({
  page,
}) => {
  await page.goto(
    "/recall?q=%EA%B3%A0%EB%8C%80%20%EC%95%85%EA%B8%B0%20%EB%B3%B5%EC%9B%90%20%EC%97%B0%EC%A3%BC%20%EC%A0%84%EB%AC%B8%EA%B0%80",
  );
  await page.getByRole("button", { name: "기억 찾기", exact: true }).click();

  await expect(page.getByText("결과 없음")).toBeVisible();
  await expect(page.getByText(/찾지 못했습니다/)).toBeVisible();
  await expect(page.locator('a[href^="/people/"]')).toHaveCount(0);
});
