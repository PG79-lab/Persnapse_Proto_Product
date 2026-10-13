import { expect, test, type Page } from "@playwright/test";
import { mockWorkspace } from "./workspace-fixture";

async function setup(page: Page, fail = false) {
  await page.route("**/api/**", (route) => route.abort());
  await mockWorkspace(page);
  await page.route("**/api/stt/realtime-session", (route) =>
    route.fulfill({
      json: { token: "temporary-test", model: "gpt-live-transcribe" },
    }),
  );
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
  await page.routeWebSocket(
    "wss://api.openai.com/v1/realtime?intent=transcription",
    (socket) => {
      socket.send(JSON.stringify({ type: "session.created" }));
      let shown = false;
      socket.onMessage((message) => {
        const event = JSON.parse(String(message));
        if (event.type === "input_audio_buffer.append" && !shown) {
          shown = true;
          socket.send(
            JSON.stringify({
              type: "conversation.item.input_audio_transcription.delta",
              item_id: "one",
              delta: "임시 텍스트",
            }),
          );
          if (fail) socket.send(JSON.stringify({ type: "error" }));
        }
        if (event.type === "input_audio_buffer.commit")
          socket.send(
            JSON.stringify({
              type: "conversation.item.input_audio_transcription.completed",
              item_id: "one",
              transcript: "확정된 녹음 내용",
            }),
          );
      });
    },
  );
}
test("start/stop automatically adds the final text and preserves notes edited while recording", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/#recordings");
  await page.getByLabel("녹음 메모", { exact: true }).fill("기존 메모");
  await page.getByRole("button", { name: "녹음 시작", exact: true }).click();
  await expect(page.getByLabel("실시간 전사")).toContainText("임시 텍스트");
  await page
    .getByLabel("녹음 메모", { exact: true })
    .fill("녹음 중 수정한 메모");
  await page.getByRole("button", { name: "녹음 마치기", exact: true }).click();
  await expect(page.getByLabel("녹음 메모", { exact: true })).toHaveValue(
    "녹음 중 수정한 메모\n확정된 녹음 내용",
  );
  await expect(
    page.getByRole("button", { name: "텍스트로 변환", exact: true }),
  ).toHaveCount(0);
});
test("a provider failure preserves WAV without automatically saving partial text", async ({
  page,
}) => {
  await setup(page, true);
  await page.goto("/#recordings");
  await page.getByLabel("녹음 메모", { exact: true }).fill("기존 메모");
  await page.getByRole("button", { name: "녹음 시작", exact: true }).click();
  await expect(page.getByLabel("실시간 전사")).toContainText("임시 텍스트");
  await page.getByRole("button", { name: "녹음 마치기", exact: true }).click();
  await expect(page.getByLabel("녹음 메모", { exact: true })).toHaveValue(
    "기존 메모",
  );
  await expect(page.locator(".recording-select")).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .getByLabel("녹음 재생")
        .evaluate((element: HTMLAudioElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await expect(
    page.getByRole("button", { name: "텍스트로 변환", exact: true }),
  ).toBeEnabled();
});
