import { expect, test, type Page } from "@playwright/test";
import { mockWorkspace } from "./workspace-fixture";
import { emptyWorkspace } from "../../src/features/workspace/store";

test("@integration saving a recording note persists it and shows saved confirmation", async ({
  page,
}) => {
  const state = emptyWorkspace();
  state.people.push({
    id: "20000000-0000-4000-8000-000000000001",
    name: "테스트 인맥",
    version: 1,
    deletedAt: null,
    createdAt: "2026-10-14T00:00:00Z",
    company: null,
    job: null,
    email: null,
    phone: null,
    status: "unclassified",
    importance: 3,
    relationshipCategories: [],
    history: [],
  });
  let writes = 0;
  await page.route("**/api/workspace", async (route) => {
    if (route.request().method() === "POST") {
      const mutation = route.request().postDataJSON();
      expect(mutation.operations).toHaveLength(1);
      expect(mutation.operations[0].type).toBe("note.add");
      const note = mutation.operations[0];
      state.people[0].history.push({
        id: note.id,
        text: note.text,
        date: null,
        version: 1,
        deletedAt: null,
      });
      writes++;
    }
    await route.fulfill({
      json: {
        state,
        loadedAt: new Date().toISOString(),
        capabilities: { storage: "server", aiMode: "mock", ocrMode: "mock" },
      },
    });
  });
  await page.goto("/#recordings");
  await page.getByLabel("녹음 메모", { exact: true }).fill("저장할 전사 메모");
  await page.getByLabel("녹음 관련 인맥").selectOption(state.people[0].id);
  await page
    .getByRole("button", { name: "인맥에 메모 저장", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "인맥에 메모 저장됨", exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
  await page.reload();
  expect((await page.request.get("/api/workspace")).status()).toBe(200);
  expect(state.people[0].history[0].text).toBe("저장할 전사 메모");
});

test("recording becomes available when the browser recording database never responds", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", { value: { open: () => ({}) } });
  });
  await page.goto("/#recordings");
  const start = page.getByRole("button", { name: "녹음 시작", exact: true });
  await expect(start).toBeEnabled({ timeout: 12000 });
  await expect(
    page.getByText("녹음 보관함 응답이 지연되고 있어요.", { exact: false }),
  ).toBeVisible();
});

test("@integration existing people load through the STT gateway and enable note save after selection", async ({
  page,
}) => {
  await page.goto("/#recordings");
  const people = page.getByLabel("녹음 관련 인맥");
  await expect(people.locator("option")).not.toHaveCount(1);
  await page
    .getByLabel("녹음 메모", { exact: true })
    .fill("버튼 활성화 검증 — 저장하지 않음");
  const save = page.getByRole("button", {
    name: "인맥에 메모 저장",
    exact: true,
  });
  await expect(save).toBeDisabled();
  const id = await people.locator("option").nth(1).getAttribute("value");
  await people.selectOption(id!);
  await expect(save).toBeEnabled();
});

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
