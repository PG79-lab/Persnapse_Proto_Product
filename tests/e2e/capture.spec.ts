import { expect, test } from "@playwright/test";

const draft = {
  schemaVersion: "capture-draft-v1",
  identityHint: {
    displayName: "검증하늘",
    organizationName: "검증 모빌리티",
    title: "사업개발 리드",
  },
  interaction: {
    interactionType: "event",
    occurredAt: "2026-09-15T12:00:00+09:00",
    summary: "물류 실증과 후속 자료 전달을 논의했다.",
    location: "코엑스",
    eventName: "스마트 물류 포럼",
  },
  topics: ["물류 실증"],
  memories: [
    {
      statementType: "context",
      body: "물류 실증 파트너를 찾고 있다.",
      occurredAt: "2026-09-15T12:00:00+09:00",
    },
  ],
  actions: [
    {
      kind: "commitment",
      title: "후속 자료 전달",
      details: null,
      dueAt: null,
    },
  ],
  inferredFields: [
    "identityHint.displayName",
    "interaction.location",
    "topics",
  ],
} as const;

test("reviews a text capture and requires an explicit identity decision", async ({
  page,
}) => {
  const captureId = "10000000-0000-4000-8000-000000000004";

  await page.route("**/api/captures", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        captureId,
        state: "review",
        rawText: "검증하늘님과 코엑스에서 물류 실증을 논의했다.",
        modelDraft: draft,
        draft,
        identityCandidates: [],
        userCorrectionCount: 0,
        lastErrorCode: null,
        commitResult: null,
        createdAt: "2026-09-15T12:00:00.000Z",
      }),
    });
  });

  await page.route("**/api/captures/*/commit", async (route) => {
    const body = route.request().postDataJSON() as {
      identity: { mode: string; displayName?: string };
    };
    expect(body.identity).toEqual({
      mode: "new",
      displayName: "검증하늘",
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        capture: {
          captureId,
          state: "committed",
          rawText: "검증하늘님과 코엑스에서 물류 실증을 논의했다.",
          modelDraft: draft,
          draft,
          identityCandidates: [],
          userCorrectionCount: 0,
          lastErrorCode: null,
          commitResult: {
            kind: "text_capture_v1",
            personId: "20000000-0000-4000-8000-000000000099",
            interactionId: "60000000-0000-4000-8000-000000000099",
            organizationId: null,
            eventId: null,
            topicIds: [],
            memoryIds: [],
            actionIds: [],
            committedAt: "2026-09-15T12:00:00.000Z",
          },
          createdAt: "2026-09-15T12:00:00.000Z",
        },
        memoryDocumentStatus: "updated",
        recallQuery: "물류 실증",
      }),
    });
  });

  await page.route("**/api/captures/*/candidates", async (route) => {
    const body = route.request().postDataJSON() as {
      draft: typeof draft;
    };
    expect(body.draft.identityHint.displayName).toBe("검증하늘");

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        identityCandidates: [
          {
            personId: "20000000-0000-4000-8000-000000000010",
            displayName: "기존 Person 후보",
            headline: null,
            organizationName: "기존 검증 조직",
            organizationTitle: "파트너",
            signals: ["소속 일치"],
          },
        ],
      }),
    });
  });

  await page.goto("/capture");
  await expect(
    page.getByRole("heading", { level: 1, name: "만남을 관계 기억으로" }),
  ).toBeVisible();
  await expect(page.getByText("아직 Memory가 아닙니다")).toBeVisible();

  await page.getByRole("button", { name: "구조화하고 검토하기" }).click();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "구조화 결과를 직접 확인하세요",
    }),
  ).toBeVisible();
  await expect(page.getByText("Draft · 미저장")).toBeVisible();

  await page.getByRole("button", { name: "확인하고 Memory 저장" }).click();
  await expect(
    page.getByText(
      "기존 Person 연결 또는 신규 Person 생성을 직접 선택해 주세요.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "수정값으로 후보 다시 찾기" }).click();
  const existingCandidate = page.getByRole("radio", {
    name: /기존 Person 후보/,
  });
  await expect(existingCandidate).toBeVisible();
  await expect(existingCandidate).not.toBeChecked();
  await expect(
    page.getByRole("radio", { name: /신규 Person 생성/ }),
  ).not.toBeChecked();

  await page.getByRole("radio", { name: /신규 Person 생성/ }).check();
  await page.getByRole("button", { name: "확인하고 Memory 저장" }).click();

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "검토한 관계 기억이 저장되었습니다.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Person Context 보기" }),
  ).toHaveAttribute("href", "/people/20000000-0000-4000-8000-000000000099");
  await expect(
    page.getByRole("link", { name: "방금 저장한 기억 찾기" }),
  ).toBeVisible();
});
