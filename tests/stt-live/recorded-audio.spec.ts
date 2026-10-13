import { expect, test } from "@playwright/test";
import { mockWorkspace } from "../e2e/workspace-fixture";

test("recordings page replays a real recording and applies a reviewed STT result", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/#recordings");
  await page.getByLabel("말하는 동안 텍스트 표시").uncheck();
  await page.getByRole("button", { name: "녹음 시작", exact: true }).click();
  await expect(page.getByLabel("녹음 시간")).toHaveText("00:04", {
    timeout: 12_000,
  });
  await page.getByRole("button", { name: "녹음 마치기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "텍스트로 변환", exact: true }),
  ).toBeEnabled();
  const audio = page.getByLabel("녹음 재생", { exact: true });
  await expect
    .poll(() =>
      audio.evaluate(
        (element: HTMLAudioElement) =>
          Number.isFinite(element.duration) && element.duration > 0,
      ),
    )
    .toBe(true);
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThan(0.3);
  await audio.evaluate((element: HTMLAudioElement) => {
    element.pause();
    element.currentTime = 1;
    return element.play();
  });
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThan(1.3);
  await page.getByLabel("녹음 변환 언어").selectOption("auto");
  await page.getByLabel("녹음 메모", { exact: true }).fill("기존 메모");
  const response = page.waitForResponse(
    (result) =>
      result.url().endsWith("/api/stt/transcribe") &&
      result.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "텍스트로 변환", exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect(page.getByLabel("녹음 인식 결과")).not.toHaveValue("");
  await expect(page.getByLabel("녹음 메모", { exact: true })).toHaveValue(
    "기존 메모",
  );
  await page.getByLabel("녹음 인식 결과").fill("확인한 녹음 내용");
  await page.getByRole("button", { name: "확인하고 메모에 추가" }).click();
  await expect(page.getByLabel("녹음 메모", { exact: true })).toHaveValue(
    "기존 메모\n확인한 녹음 내용",
  );
  await page.reload();
  await page.locator(".recording-select").first().click();
  await expect(page.getByLabel("녹음 메모", { exact: true })).toHaveValue(
    "기존 메모\n확인한 녹음 내용",
  );
  await expect
    .poll(() =>
      page
        .getByLabel("녹음 재생")
        .evaluate((element: HTMLAudioElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/stt-recordings-fixed.png",
    fullPage: true,
  });
});

test("real microphone PCM audio can be replayed and transcribed", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/#todos");
  await page.getByRole("button", { name: "기록 남기기", exact: true }).click();
  await page.getByLabel("음성 인식 언어").selectOption("auto");
  await page.getByRole("button", { name: "녹음 시작", exact: true }).click();
  await expect(page.getByText("녹음 중 4/60초", { exact: true })).toBeVisible();
  const result = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/stt/transcribe") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "녹음 끝내고 변환", exact: true })
    .click();
  const audio = page.getByLabel("녹음 다시 듣기");
  await expect(audio).toBeVisible();
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
    .toBeGreaterThan(0.3);
  await audio.evaluate((element: HTMLAudioElement) => {
    element.pause();
    element.currentTime = 0;
    return element.play();
  });
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThan(0.3);
  const response = await result;
  const payload = await response.json();
  expect(response.status(), JSON.stringify(payload)).toBe(200);
  await expect(page.getByLabel("인식 결과 · 수정 가능")).not.toHaveValue("");
});
