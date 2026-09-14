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
