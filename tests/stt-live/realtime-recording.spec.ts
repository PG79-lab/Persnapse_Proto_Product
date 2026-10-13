import { expect, test } from "@playwright/test";
import { mockWorkspace } from "../e2e/workspace-fixture";

test("live text appears before stopping and the final transcript is added without another action", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/#recordings");
  await expect(page.getByLabel("말하는 동안 텍스트 표시")).toBeChecked();
  await page.getByLabel("실시간 인식 언어").selectOption("auto");
  await page.getByLabel("녹음 메모", { exact: true }).fill("기존 메모");
  const startedAt = Date.now();
  await page.getByRole("button", { name: "녹음 시작", exact: true }).click();
  const caption = page.getByLabel("실시간 전사").locator("p").last();
  await expect(
    page.getByRole("button", { name: "녹음 마치기", exact: true }),
  ).toBeVisible();
  // The injected public sample is English. A placeholder/connection message is
  // not evidence of a model delta; wait for actual Latin transcript characters.
  await expect(caption).toHaveText(/[A-Za-z]/, { timeout: 25000 });
  const firstTextMs = Date.now() - startedAt;
  await page.screenshot({
    path: "test-results/stt-realtime-streaming.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "녹음 마치기", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "녹음 마치기", exact: true }).click();
  const stoppedAt = Date.now();
  await expect(page.getByLabel("녹음 메모", { exact: true })).toHaveValue(
    /^기존 메모\n.+/s,
    { timeout: 30000 },
  );
  await expect(
    page.getByRole("button", { name: "텍스트로 변환", exact: true }),
  ).toHaveCount(0);
  console.log(
    JSON.stringify({
      firstTextFromStartClickMs: firstTextMs,
      finalTextFromStopMs: Date.now() - stoppedAt,
    }),
  );
  const finalText = await page
    .getByLabel("녹음 메모", { exact: true })
    .inputValue();
  await page.reload();
  await page.locator(".recording-select").first().click();
  await expect(page.getByLabel("녹음 메모", { exact: true })).toHaveValue(
    finalText,
  );
  const audio = page.getByLabel("녹음 재생", { exact: true });
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThan(0.2);
  await page.screenshot({
    path: "test-results/stt-realtime.png",
    fullPage: true,
  });
});
