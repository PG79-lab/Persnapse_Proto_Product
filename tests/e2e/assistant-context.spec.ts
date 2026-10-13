import { expect, test, type Page } from "@playwright/test";
import { emptyWorkspace } from "../../src/features/workspace/store";
import {
  emptyContext,
  type AssistantResponse,
  type TurnRequest,
} from "../../src/domain/assistant/contracts";
const personId = "20000000-0000-4000-8000-000000000001";
const memoryId = "40000000-0000-4000-8000-000000000001";
function answer(input: TurnRequest, version: number): AssistantResponse {
  return {
    schemaVersion: "assistant-v1",
    status: "resolved",
    sessionId: input.sessionId,
    turnId: input.requestId,
    version,
    purpose: "prepare",
    context: {
      ...emptyContext(),
      personIds: [personId],
      purpose: "prepare",
      goal: "다음 만남 준비",
    },
    sections: [
      {
        type: "fact",
        title: "진행 상황",
        text: "AI 도입 파일럿을 논의했습니다.",
        evidenceKeys: [`memory_statement:${memoryId}`],
      },
      {
        type: "suggestion",
        title: "준비 질문",
        text: "파일럿 검토에 필요한 자료가 무엇인지 확인해 보세요.",
        evidenceKeys: [`memory_statement:${memoryId}`],
      },
    ],
    coverage: {
      status: "limited",
      paths: ["structured", "keyword"],
      reasons: [
        "일부 기록의 의미 검색이 준비 중입니다. 확인 가능한 기록으로 답변했습니다.",
      ],
      total: 4,
      prepared: 2,
      asOf: "2026-10-13T03:00:00Z",
    },
    recall: {
      queryId: null,
      status: "resolved",
      answer: "민수와의 다음 만남을 준비했습니다.",
      parsedQuery: {
        normalizedQuery: input.message,
        terms: [],
        intents: ["person_lookup"],
        dateRange: null,
        parserVersion: "llm-v1",
      },
      results: [
        {
          personId,
          displayName: "민수",
          headline: null,
          organizations: ["합성 연구소"],
          score: 0,
          reason: "확인된 논의",
          evidence: [
            {
              id: memoryId,
              type: "memory_statement",
              excerpt: "AI 도입 파일럿 논의",
              occurredAt: null,
              verificationStatus: "confirmed",
              score: 0,
              memoryStatementId: memoryId,
              memoryDocumentId: null,
            },
          ],
          storedActions: [],
          suggestion: null,
        },
      ],
      latencyMs: 100,
      mode: "live",
      model: "test",
    },
  };
}
async function setup(page: Page, loseFirst = false) {
  const state = emptyWorkspace();
  state.people = [
    {
      id: personId,
      name: "민수",
      company: "합성 연구소",
      job: null,
      email: null,
      phone: null,
      status: "unclassified",
      importance: 3,
      relationshipCategories: [],
      version: 1,
      deletedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      history: [],
    },
  ];
  let version = 0;
  let activeSession = "";
  let losing = loseFirst;
  const requests: TurnRequest[] = [];
  const turns: {
    id: string;
    message: string;
    request_id: string;
    status: string;
    response: AssistantResponse;
  }[] = [];
  await page.route("**/api/**", (route) => route.abort());
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      json: {
        state,
        loadedAt: new Date().toISOString(),
        capabilities: {
          aiMode: "live",
          ocrMode: "mock",
          storage: "server",
          assistantContext: true,
        },
      },
    }),
  );
  await page.route("**/api/assistant/sessions/*", (route) => {
    const requested = route.request().url().split("/").at(-1);
    if (requested !== activeSession)
      return route.fulfill({ status: 404, json: { error: "없음" } });
    return route.fulfill({
      json: {
        sessionId: activeSession,
        version,
        context: turns.at(-1)?.response.context ?? emptyContext(),
        turns,
      },
    });
  });
  await page.route("**/api/assistant/turns", async (route) => {
    const input = route.request().postDataJSON() as TurnRequest;
    requests.push(input);
    if (input.sessionId !== activeSession) {
      activeSession = input.sessionId;
      version = 0;
      turns.length = 0;
    }
    const existing = turns.find((t) => t.request_id === input.requestId);
    const response = existing?.response ?? answer(input, ++version);
    if (!existing)
      turns.push({
        id: response.turnId,
        message: input.message,
        request_id: input.requestId,
        status: "succeeded",
        response,
      });
    if (losing) {
      losing = false;
      return route.abort();
    }
    await route.fulfill({ json: response });
  });
  await page.goto("/#todos");
  await expect(
    page.getByRole("textbox", { name: "AI에게 질문" }),
  ).toBeVisible();
  return requests;
}
async function send(page: Page, message: string) {
  await page.getByRole("textbox", { name: "AI에게 질문" }).fill(message);
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
}
test("continues, restores and resets a grounded conversation in the integrated workspace", async ({
  page,
}) => {
  const requests = await setup(page);
  await send(page, "민수와 다음 만남 준비해줘");
  await expect(page.locator(".chat-exchange")).toHaveCount(1);
  await expect(page.getByLabel("대화 대상")).toHaveValue(personId);
  await expect(
    page.getByText("AI 제안 · 준비 질문", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("검색 범위 안내")).toContainText("준비 중");
  await send(page, "질문 세 개로 줄여줘");
  await expect(page.locator(".chat-exchange")).toHaveCount(2);
  expect(requests[1].sessionId).toBe(requests[0].sessionId);
  expect(requests[1].expectedVersion).toBe(1);
  await page.reload();
  await expect(page.locator(".chat-exchange")).toHaveCount(2);
  await page
    .getByRole("button", { name: "검색 대화 비우기", exact: true })
    .click();
  await expect(page.locator(".chat-exchange")).toHaveCount(0);
  await send(page, "새로 정리해줘");
  await expect(page.locator(".chat-exchange")).toHaveCount(1);
  expect(requests[2].sessionId).not.toBe(requests[0].sessionId);
  expect(requests[2].expectedVersion).toBe(0);
});
test("replays a lost response with the same request ID instead of paying for a duplicate turn", async ({
  page,
}) => {
  const requests = await setup(page, true);
  await send(page, "민수 진행 상황");
  await expect(page.locator(".assistant-error")).toBeVisible();
  await send(page, "민수 진행 상황");
  await expect(page.locator(".chat-exchange")).toHaveCount(1);
  expect(requests).toHaveLength(2);
  expect(requests[1].requestId).toBe(requests[0].requestId);
});
test("explicit person and independent calendar conditions are submitted for the next turn", async ({
  page,
}) => {
  const requests = await setup(page);
  await page.getByLabel("대화 대상").selectOption(personId);
  await page.getByLabel("만남 날짜 조건").fill("2026-10-09");
  await page.getByLabel("기한 날짜 조건").fill("2026-10-16");
  await send(page, "이때 약속 확인");
  await expect(page.locator(".chat-exchange")).toHaveCount(1);
  expect(requests[0].contextSelection).toMatchObject({
    personIds: [personId],
    meetingRange: { from: "2026-10-09", toExclusive: "2026-10-10" },
    dueRange: { from: "2026-10-16", toExclusive: "2026-10-17" },
  });
});
