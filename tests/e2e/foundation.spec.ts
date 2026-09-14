import { expect, test } from "@playwright/test";

test("shows the Persnapse foundation", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "관계의 맥락",
  );
  await expect(page.getByLabel("Persnapse core loop")).toContainText("Recall");
});
