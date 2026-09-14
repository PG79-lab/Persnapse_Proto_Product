import { expect, test } from "@playwright/test";

test("shows the Persnapse foundation", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "관계의 맥락",
  );
  await expect(page.getByLabel("Persnapse core loop")).toContainText("Recall");
});

test("opens a seeded person memory with timeline and evidence", async ({
  page,
}) => {
  await page.goto("/people");

  await expect(
    page.getByRole("heading", { level: 1, name: "만난 사람과 맥락" }),
  ).toBeVisible();
  await expect(page.getByText("합성 Golden Dataset")).toBeVisible();

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
    page.getByRole("heading", { level: 1, name: "관계 기억에서 다시 찾기" }),
  ).toBeVisible();
  await expect(
    page.getByText(/가장 관련 있는 사람은 김민준님입니다/),
  ).toBeVisible();
  await expect(page.getByText(/확인된 근거 ·/).first()).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "저장된 다음 행동" }).first(),
  ).toBeVisible();
  await expect(page.getByText("실행하지 않음").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "AI가 제안한 후속" }).first(),
  ).toBeVisible();
  await expect(page.getByText(/자동 실행하지 않습니다/).first()).toBeVisible();
});

test("keeps duplicate names ambiguous until context is added", async ({
  page,
}) => {
  await page.goto("/recall?q=%EA%B9%80%EB%AF%BC%EC%A4%80");

  await expect(page.getByText("동명이인 구분이 필요합니다.")).toBeVisible();
  await expect(page.getByText(/여러 사람이 있습니다/)).toBeVisible();
  await expect(
    page.locator('a[href^="/people/"]').filter({ hasText: "김민준" }),
  ).toHaveCount(2);
});
