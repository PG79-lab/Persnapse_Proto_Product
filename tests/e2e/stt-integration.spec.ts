import { expect, test } from "@playwright/test";
import { mockWorkspace } from "./workspace-fixture";

test("real STT gateway accepts same-origin browser uploads", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/#todos");
  const status = await page.evaluate(async () => {
    const form = new FormData();
    form.set("audio", new File(["invalid"], "speech.webm"));
    form.set("hints", "<invalid>");
    const response = await fetch("/api/stt/transcribe", {
      method: "POST",
      headers: { "X-Persnapse-STT": "1" },
      body: form,
    });
    return response.status;
  });
  expect(status).toBe(400); // Validation rejects this sample before any paid call.
});

test("voice result is reviewed before appending to the current note", async ({
  page,
}) => {
  await page.route("**/api/**", (route) => route.abort());
  await mockWorkspace(page);
  let calls = 0;
  await page.route("**/api/stt/transcribe", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { configured: true, model: "gpt-transcribe" },
      });
    calls++;
    expect(route.request().headers()["x-persnapse-stt"]).toBe("1");
    return route.fulfill({
      json: {
        text: "김민준과 다음 주 만나기로 했다.",
        model: "gpt-transcribe",
        provider: "openai",
      },
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => {
          const context = new AudioContext();
          const tone = context.createOscillator();
          const output = context.createMediaStreamDestination();
          tone.connect(output);
          tone.start();
          await context.resume();
          return output.stream;
        },
      },
    });
  });
  await page.goto("/#todos");
  await page.getByRole("button", { name: "기록 남기기", exact: true }).click();
  await page
    .getByLabel("관계 맥락", { exact: true })
    .fill("기존에 직접 작성한 메모.");
  await page.getByRole("button", { name: "녹음 시작", exact: true }).click();
  await expect(page.getByText("녹음 중 1/100초", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await page
    .getByRole("button", { name: "녹음 끝내고 변환", exact: true })
    .click();
  await expect(page.getByLabel("인식 결과 · 수정 가능")).toHaveValue(
    "김민준과 다음 주 만나기로 했다.",
  );
  await expect(page.getByLabel("관계 맥락", { exact: true })).toHaveValue(
    "기존에 직접 작성한 메모.",
  );
  await page
    .getByLabel("관계 맥락", { exact: true })
    .fill("녹음 중 수정한 메모.");
  await page
    .getByLabel("인식 결과 · 수정 가능")
    .fill("김민준과 금요일에 만나기로 했다.");
  await page
    .getByRole("button", { name: "확인하고 입력에 추가", exact: true })
    .click();
  await expect(page.getByLabel("관계 맥락", { exact: true })).toHaveValue(
    "녹음 중 수정한 메모.\n김민준과 금요일에 만나기로 했다.",
  );
  expect(calls).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/stt-integration-mobile.png",
    fullPage: true,
  });
});
