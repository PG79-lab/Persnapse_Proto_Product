import { expect, test } from "@playwright/test";
import { mockWorkspace } from "./workspace-fixture";
import { emptyWorkspace } from "../../src/features/workspace/store";
import type { BusinessCardDraftV1 } from "../../src/domain/business-card/business-card-draft";

test.beforeEach(async ({ page }) => {
  await mockWorkspace(page);
});

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

  await page.goto("/#todos");
  await expect(
    page.getByRole("heading", { level: 1, name: "일정/업무관리" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "기록 남기기", exact: true }).click();
  await page
    .getByLabel("관계 맥락")
    .fill("검증하늘님과 코엑스에서 물류 실증을 논의했다.");
  await expect(page.getByText("아직 Memory가 아닙니다")).toBeVisible();

  await page.getByRole("button", { name: "구조화하고 검토하기" }).click();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "구조화 결과를 직접 확인하세요",
    }),
  ).toBeVisible();
  await expect(page.getByText("검토 중 · 아직 저장되지 않음")).toBeVisible();

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
    page.getByRole("button", { name: "인맥 프로필 보기" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "방금 저장한 기억 찾기" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "방금 저장한 기억 찾기" }).click();
  await expect(page.getByLabel("AI에게 질문")).not.toHaveValue("");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/#todos$/);
});

test("registers a card in the integrated UI, restores it, and opens its profile and recall", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const workspace = emptyWorkspace();
  await mockWorkspace(page, workspace);
  const savedPersonId = "20000000-0000-4000-8000-000000000005";
  const recallQuery = "김하늘 수정님과 명함을 교환한 기억";
  let recallCalls = 0;
  await page.route("**/api/recall", (route) => {
    recallCalls++;
    return route.abort();
  });
  const captureId = "10000000-0000-4000-8000-000000000005";
  const originalAssetId = "11000000-0000-4000-8000-000000000005";
  const businessCardDraft: BusinessCardDraftV1 = {
    schemaVersion: "business-card-draft-v1",
    identity: {
      displayName: "김하늘",
      organizationName: "Persnapse Labs",
      title: "Product Lead",
      department: "Product",
      emails: ["haneul.kim@example.com"],
      phones: ["010-1234-5678", "02-111-2222", "010-9999-0000"],
      contactNumbers: [
        { type: "mobile", value: "010-1234-5678", rawLabel: "HP" },
        { type: "phone", value: "02-111-2222", rawLabel: "Tel" },
        { type: "fax", value: "02-333-4444", rawLabel: "Fax" },
        { type: "unknown", value: "010-9999-0000", rawLabel: null },
      ],
      websites: ["www.persnapse.example"],
      address: "서울특별시 강남구 테헤란로 123",
    },
    interaction: {
      interactionType: "meeting",
      occurredAt: "2026-09-16T12:00:00+09:00",
      summary: "김하늘님과 명함을 교환했다.",
      location: null,
      eventName: null,
    },
    topics: [],
    memories: [],
    actions: [],
    observedFields: [
      "identity.displayName",
      "identity.organizationName",
      "identity.title",
      "identity.department",
      "identity.emails",
      "identity.phones",
      "identity.websites",
      "identity.address",
    ],
    inferredFields: [],
  };
  await page.setContent(`
    <main style="width: 634px; height: 400px; padding: 48px; background: #fffdf7; color: #16221a; font-family: Arial, sans-serif">
      <strong style="font-size: 28px; color: #17613b">PERSNAPSE LABS</strong>
      <h1 style="margin: 64px 0 12px; font-size: 52px">김하늘</h1>
      <p style="font-size: 24px">Product Lead · Product Team</p>
    </main>
  `);
  const cardImage = await page.locator("main").screenshot({ type: "png" });

  let currentCard = {
    captureId,
    state: "draft",
    stage: "card_review",
    originalAssetId,
    displayAssetId: "12000000-0000-4000-8000-000000000005",
    imageUrl: `data:image/png;base64,${cardImage.toString("base64")}`,
    draft: businessCardDraft,
    modelDraft: businessCardDraft,
    fieldsConfirmedAt: null as string | null,
    contextNote: "",
    identityCandidates: [],
    userCorrectionCount: 0,
    ocrProvider: "naver_clova",
    ocrLatencyMs: 1763,
    lastErrorCode: null,
    commitResult: null,
    createdAt: "2026-09-16T03:00:00.000Z",
  };

  await page.route("**/api/business-cards", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: currentCard.fieldsConfirmedAt ? [currentCard] : [],
      });
      return;
    }
    expect(route.request().method()).toBe("POST");
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(currentCard),
    });
  });
  await page.route(
    `**/api/business-cards/${captureId}/confirm-fields`,
    async (route) => {
      const body = route.request().postDataJSON() as {
        draft: typeof businessCardDraft;
      };
      expect(body.draft.identity.displayName).toBe("김하늘 수정");
      currentCard = {
        ...currentCard,
        stage: "card_result",
        draft: body.draft,
        fieldsConfirmedAt: "2026-10-11T10:00:00.000Z",
      };
      await route.fulfill({ json: currentCard });
    },
  );
  await page.route(
    `**/api/business-cards/${captureId}/restore-display`,
    async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().headers()["content-type"]).toContain(
        "multipart/form-data",
      );
      await route.fulfill({ json: currentCard });
    },
  );
  let originalDownloads = 0;
  await page.route(`**/api/source-assets/${originalAssetId}`, async (route) => {
    originalDownloads++;
    await route.fulfill({ body: cardImage, contentType: "image/png" });
  });
  await page.route(
    `**/api/source-assets/${currentCard.displayAssetId}`,
    (route) => route.fulfill({ body: cardImage, contentType: "image/png" }),
  );
  await page.route(
    `**/api/business-cards/${captureId}/prepare-review`,
    async (route) => {
      expect(route.request().postDataJSON().contextNote).toContain("명함");
      currentCard = { ...currentCard, stage: "memory_review", state: "review" };
      await route.fulfill({ json: currentCard });
    },
  );
  await page.route(
    `**/api/business-cards/${captureId}/commit`,
    async (route) => {
      expect(route.request().postDataJSON().identity).toEqual({
        mode: "new",
        displayName: "김하늘 수정",
      });
      workspace.people.push({
        id: savedPersonId,
        name: "김하늘 수정",
        company: "Persnapse Labs",
        job: "Product Lead",
        email: "haneul.kim@example.com",
        phone: "010-1234-5678",
        status: "unclassified",
        importance: 3,
        relationshipCategories: [],
        version: 1,
        deletedAt: null,
        createdAt: "2026-10-12T00:00:00Z",
        history: [],
        businessCards: [
          {
            id: "card-saved",
            displayAssetId: currentCard.displayAssetId,
            originalRetained: true,
            identity: currentCard.draft.identity,
          },
        ],
      });
      await route.fulfill({
        json: {
          card: {
            ...currentCard,
            state: "committed",
            commitResult: {
              personId: savedPersonId,
              businessCardId: "card-saved",
            },
          },
          recallQuery,
          memoryDocumentStatus: "updated",
        },
      });
    },
  );

  await page.goto("/#cards");
  await expect(page.locator(".connected-capture")).toHaveCount(1);
  await expect(
    page.getByText(
      "AI가 명함을 읽고 정보를 정리합니다. 직접 확인한 뒤에만 인맥으로 저장됩니다.",
    ),
  ).toBeVisible();
  await page.getByLabel("명함 이미지 선택").setInputFiles({
    name: "synthetic-card.png",
    mimeType: "image/png",
    buffer: cardImage,
  });

  await expect(
    page.getByRole("heading", { name: "명함 테두리·2D 이미지 확인" }),
  ).toBeVisible({ timeout: 40_000 });
  if (
    await page
      .getByRole("button", { name: "이 2D 이미지로 OCR 실행" })
      .isDisabled()
  ) {
    await page.getByRole("button", { name: "지정한 영역으로 보정" }).click();
  }
  await expect(
    page.getByRole("button", { name: "이 2D 이미지로 OCR 실행" }),
  ).toBeEnabled({ timeout: 20_000 });
  await page.getByRole("button", { name: "이 2D 이미지로 OCR 실행" }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: "인식한 명함 정보" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "이름", exact: true }),
  ).toHaveValue("김하늘");
  await expect(
    page.getByRole("textbox", { name: "회사·조직", exact: true }),
  ).toHaveValue("Persnapse Labs");
  await expect(page.getByText("NAVER CLOVA OCR · 수정 가능")).toBeVisible();
  await expect(
    page.getByText("이미지 처리 완료 · NAVER CLOVA OCR"),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "이름", exact: true })
    .fill("김하늘 수정");
  await expect(page.getByRole("textbox", { name: "휴대폰 번호" })).toHaveValue(
    "010-1234-5678",
  );
  await expect(
    page.getByRole("textbox", { name: "전화번호", exact: false }),
  ).toHaveValue("02-111-2222");
  await expect(page.getByRole("textbox", { name: "팩스 번호" })).toHaveValue(
    "02-333-4444",
  );
  await expect(page.getByRole("textbox", { name: "미분류 번호" })).toHaveValue(
    "010-9999-0000",
  );
  await page.getByRole("textbox", { name: "미분류 번호" }).fill("");
  const mobileNumbers = page.getByRole("textbox", { name: "휴대폰 번호" });
  await mobileNumbers.focus();
  await mobileNumbers.press("ControlOrMeta+End");
  await mobileNumbers.press("Enter");
  await expect(mobileNumbers).toHaveValue("010-1234-5678\n");
  await mobileNumbers.pressSequentially("010-9999-0000");
  await page.getByRole("button", { name: "OK · 추출 정보 확정" }).click();
  await expect(page.getByText("확인한 명함 정보")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "김하늘 수정" }),
  ).toBeVisible();
  const confirmedNumbers = page.getByLabel("명함 연락처 번호");
  await expect(confirmedNumbers).toContainText("팩스");
  await expect(confirmedNumbers).toContainText("02-333-4444");
  expect(currentCard.draft.identity.phones).not.toContain("02-333-4444");
  expect(currentCard.draft.identity.contactNumbers).toContainEqual({
    type: "mobile",
    value: "010-9999-0000",
    rawLabel: null,
  });
  await expect(
    page.getByRole("heading", { name: "이 사람을 어디서, 왜 만났나요?" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "명함 모서리 직접 지정" }).click();
  await expect(
    page.getByRole("button", { name: "왼쪽 위 모서리" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "지정한 영역으로 보정" }).click();
  await expect(
    page.getByText("평면 보정 미리보기를 확인하세요.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "이 보정 이미지 저장" }).click();
  await expect(
    page.getByText("명함 테두리를 보정한 이미지를 저장했습니다.", {
      exact: false,
    }),
  ).toBeVisible();
  // Both editor and warp use the session capture file; the compressed stored
  // original must not be downloaded for the first manual restoration.
  expect(originalDownloads).toBe(0);

  await page.reload();
  await expect(page.getByText("확인한 명함 정보")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "김하늘 수정" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "이 사람을 어디서, 왜 만났나요?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "OK · 추출 정보 확정" }),
  ).toHaveCount(0);
  const navigation = page.getByRole("navigation", { name: "주요 메뉴" });
  await navigation
    .getByRole("button", { name: "인맥 관리", exact: true })
    .click();
  await navigation
    .getByRole("button", { name: "명함 등록", exact: true })
    .click();
  await expect(page.getByText("확인한 명함 정보")).toBeVisible();
  await page
    .getByPlaceholder(
      "만난 행사, 장소, 이야기한 주제와 후속 약속을 편하게 적어주세요.",
    )
    .fill("제품 행사에서 명함을 교환했다.");
  await page
    .getByRole("button", { name: "맥락 분석하고 연결 후보 찾기" })
    .click();
  await page.getByRole("radio", { name: /신규 Person 생성/ }).check();
  await page.getByRole("button", { name: "확인하고 인맥에 저장" }).click();
  await expect(page.getByText("인맥과 만남 기록 저장 완료")).toBeVisible();
  await page.getByRole("button", { name: "인맥 프로필 보기" }).click();
  const profile = page.getByRole("dialog", {
    name: "인맥 프로필",
    exact: true,
  });
  await expect(
    profile.getByRole("heading", { name: "김하늘 수정", exact: true }),
  ).toBeVisible();
  await profile.getByRole("button", { name: "정보", exact: true }).click();
  await expect(
    profile
      .getByRole("region", { name: "등록한 명함" })
      .getByRole("button", { name: "확대", exact: true }),
  ).toBeVisible();
  await expect(profile.getByLabel("명함 연락처 번호")).toContainText("팩스");
  await expect(profile.getByLabel("명함 연락처 번호")).toContainText(
    "02-333-4444",
  );
  await profile.getByRole("button", { name: "닫기", exact: true }).click();
  await navigation
    .getByRole("button", { name: "관계 지도", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "지도 목록 검색" })
    .fill("김하늘 수정");
  await page.locator(".graph-archive-row").click();
  await expect(
    page.getByRole("complementary", { name: "선택 기록 상세" }),
  ).toContainText("김하늘 수정");
  await navigation
    .getByRole("button", { name: "명함 등록", exact: true })
    .click();
  await page.getByRole("button", { name: "방금 저장한 기억 찾아보기" }).click();
  await expect(page).toHaveURL(/#todos$/);
  await expect(page.getByLabel("AI에게 질문")).toHaveValue(recallQuery);
  expect(recallCalls).toBe(0);
});
