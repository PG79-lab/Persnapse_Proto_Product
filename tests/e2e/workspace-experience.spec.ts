import { expect, test, type Page } from "@playwright/test";
import { emptyWorkspace } from "../../src/features/workspace/store";
import type { WorkspaceState } from "../../src/domain/workspace/contracts";
import { mockWorkspace as mockWorkspaceSession } from "./workspace-fixture";

function fixture(): WorkspaceState {
  const state = emptyWorkspace();
  state.people = ["한지민", "윤서준"].map((name, i) => ({
    id: `20000000-0000-4000-8000-00000000000${i + 1}`,
    version: 1,
    deletedAt: null,
    name,
    company: i ? "북쪽 스튜디오" : "보라 연구소",
    job: "파트너",
    email: `person${i}@example.test`,
    phone: null,
    status: "unclassified",
    importance: 3,
    relationshipCategories: [],
    history: [],
    createdAt: "2026-01-01T00:00:00Z",
  }));
  state.meetings = [
    {
      id: "30000000-0000-4000-8000-000000000001",
      version: 1,
      deletedAt: null,
      name: "제품 연구 모임",
      date: "2026-09-01",
      occurredAt: "2026-09-01T00:00:00Z",
      placeType: "expo",
      guests: ["게스트 홍길동"],
      description: "물류 파일럿 도입을 논의했습니다.",
      eventUrl: null,
      imageUrl: null,
      imageSourceUrl: null,
    },
  ];
  state.edges = [
    {
      id: "edge1",
      personId: state.people[0].id,
      meetingId: state.meetings[0].id,
      deletedAt: null,
    },
  ];
  state.todos = ["제안서 전달", "미정 후속 연락"].map((text, i) => ({
    id: `40000000-0000-4000-8000-00000000000${i + 1}`,
    version: 1,
    deletedAt: null,
    text,
    date: i ? null : "2020-01-01",
    time: null,
    done: false,
    source: "task",
    kind: "follow_up",
    personId: state.people[0].id,
    personName: state.people[0].name,
    type: "general",
    importance: 3,
    createdAt: "2026-01-01T00:00:00Z",
  }));
  return state;
}
async function mockWorkspace(page: Page, state = fixture()) {
  await mockWorkspaceSession(page, state);
}
test("summary filters pending work and restores the full list", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/#todos");
  const overview = page.getByRole("region", { name: "오늘의 업무 요약" });
  await overview.getByRole("button", { name: /날짜 미정/ }).click();
  await expect(page.locator(".work-todo-items .todo-item")).toHaveCount(1);
  await expect(page.locator(".work-todo-items")).toContainText(
    "미정 후속 연락",
  );
  await page
    .locator(".active-task-filter")
    .getByRole("button", { name: "전체 보기" })
    .click();
  await expect(page.locator(".work-todo-items .todo-item")).toHaveCount(2);
  await expect(page.locator(".work-calendar-card details")).not.toHaveAttribute(
    "open",
    "",
  );
  await page.locator(".work-calendar-card summary").click();
  await expect(
    page.getByRole("button", { name: "다음 달", exact: true }),
  ).toBeVisible();
});
test("people search, follow-up filtering and recovery work independently of global search", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/#people");
  await page
    .getByRole("textbox", { name: "인맥 목록 검색" })
    .fill("person1@example.test");
  await expect(page.locator(".people-table-row")).toHaveCount(1);
  await expect(page.locator(".people-table-row")).toContainText("윤서준");
  await page.getByRole("button", { name: /후속 업무 있는 인맥/ }).click();
  await expect(page.getByText("조건에 맞는 인맥이 없어요")).toBeVisible();
  await page.getByRole("button", { name: "필터 초기화" }).click();
  await expect(page.locator(".people-table-row")).toHaveCount(2);
  await page.getByRole("textbox", { name: "전체 인맥 검색" }).fill("없는인물");
  await expect(page.locator(".people-table-row")).toHaveCount(2);
  await page.getByRole("textbox", { name: "전체 인맥 검색" }).press("Escape");
  await expect(page.locator(".search-results")).toHaveCount(0);
});
test("meeting search matches attendee, guest and context, with empty-state recovery", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/#meetings");
  const search = page.getByRole("textbox", { name: "만남 기록 검색" });
  for (const query of ["한지민", "홍길동", "파일럿"]) {
    await search.fill(query);
    await expect(page.locator(".record-card")).toHaveCount(1);
  }
  await search.fill("없는기록");
  await expect(page.getByText("찾는 만남이 없어요")).toBeVisible();
  await page.getByRole("button", { name: "검색·기간 초기화" }).click();
  await expect(page.locator(".record-card")).toHaveCount(1);
});
test("navigation supports reload and browser back without losing the destination", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/#people");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "인맥 관리",
  );
  await page
    .getByRole("navigation", { name: "주요 메뉴", exact: true })
    .getByRole("button", { name: "만남 기록", exact: true })
    .click();
  await expect(page).toHaveURL(/#meetings$/);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "만남 기록",
  );
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "인맥 관리",
  );
});
test("capture actions retain their visual styles inside the integrated shell", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/#cards");
  await expect(
    page.getByRole("list", { name: "명함 등록 순서" }),
  ).toBeVisible();
  const capture = page.getByRole("button", { name: "명함 촬영", exact: true });
  await expect(capture).toBeVisible();
  await expect(capture).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "이미지 업로드", exact: true }),
  ).toHaveCount(1);
  await expect(page.getByText("진행 중인 명함", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.locator('.capture-journey [aria-current="step"]'),
  ).toContainText("명함 올리기");
  const style = await capture.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el).color,
  }));
  expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(style.color).toBe("rgb(255, 255, 255)");
  await expect(
    page.getByText("NAVER CLOVA OCR로 인식하며", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByRole("main")).toHaveCount(1);
});
test("map filtering explains hidden people and offers a reset", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/#map");
  await expect(page.locator(".graph-context")).toContainText("한지민");
  await page.getByRole("button", { name: /필터/ }).click();
  await page
    .getByRole("group", { name: "지도 필터", exact: true })
    .getByLabel("상태")
    .selectOption("success");
  await expect(page.getByText("조건에 맞는 연결이 없어요")).toBeVisible();
  await page
    .getByRole("group", { name: "지도 필터", exact: true })
    .getByRole("button", { name: "필터 초기화", exact: true })
    .click();
  await page.getByRole("button", { name: "필터 닫기" }).click();
  await expect(
    page.getByRole("button", { name: "인맥 한지민", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "만남 제품 연구 모임", exact: true })
    .focus();
  await expect(page.locator(".graph-focus-caption")).toHaveText(
    "제품 연구 모임",
  );
  await page
    .getByRole("navigation", { name: "주요 메뉴", exact: true })
    .getByRole("button", { name: "인맥 관리", exact: true })
    .click();
  await expect(page).toHaveURL(/#people$/);
});
test("dense relationship map limits the initial slice and exposes remaining meetings through expansion", async ({
  page,
}) => {
  const state = fixture();
  state.meetings = Array.from({ length: 12 }, (_, index) => ({
    ...state.meetings[0],
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: `제품 모임 ${index + 1}`,
  }));
  state.edges = state.meetings.map((meeting, index) => ({
    id: `edge-${index}`,
    personId: state.people[0].id,
    meetingId: meeting.id,
    deletedAt: null,
  }));
  await mockWorkspace(page, state);
  await page.goto("/#map");
  await expect(
    page.getByRole("button", { name: /^만남 제품 모임/ }),
  ).toHaveCount(11);
  await expect(page.locator(".graph-statusbar")).toContainText(
    "목록에서 접근 가능",
  );
  await page.getByRole("button", { name: "관련 기록 펼치기" }).click();
  await page.getByRole("button", { name: /참석 만남/ }).click();
  await expect(
    page.getByRole("button", { name: /^만남 제품 모임/ }),
  ).toHaveCount(12);
  await page.getByRole("button", { name: /한지민.*접기/ }).click();
  await expect(
    page.getByRole("button", { name: /^만남 제품 모임/ }),
  ).toHaveCount(11);
});

test("large relationship map keeps omitted people accessible in the list and explicit full view", async ({
  page,
}) => {
  const state = fixture();
  state.people = Array.from({ length: 17 }, (_, index) => ({
    ...state.people[0],
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: `테스트 인맥 ${index + 1}`,
  }));
  await mockWorkspace(page, state);
  await page.goto("/#map");
  await expect(page.locator(".graph-archive-row")).toHaveCount(17);
  await expect(page.locator('.graph-node[role="button"]')).toHaveCount(2);
  await expect(page.locator(".graph-statusbar")).toContainText(
    "16개는 목록에서 접근 가능",
  );
  await page
    .getByRole("textbox", { name: "지도 목록 검색" })
    .fill("테스트 인맥 17");
  await page.locator(".graph-archive-row").click();
  await expect(
    page.getByRole("complementary", { name: "선택 기록 상세" }),
  ).toContainText("테스트 인맥 17");
  await page.getByRole("button", { name: "상세 닫기", exact: true }).click();
  await page.getByRole("button", { name: "전체 보기", exact: true }).click();
  await expect(page.locator('.graph-node[role="button"]')).toHaveCount(18);
});

test("mobile AI tab opens the composer and examples remain actionable", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#todos");
  await page.getByRole("tab", { name: "AI 어시스턴트", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "오늘의 업무 요약" }),
  ).not.toBeVisible();
  const examples = page.locator(".assistant-examples button");
  await expect(examples).toHaveCount(3);
  // The adopted layout scrolls the welcome examples inside the conversation.
  await examples.last().scrollIntoViewIfNeeded();
  const lastExample = await examples.last().boundingBox();
  const composer = await page.locator(".connected-composer").boundingBox();
  expect(
    lastExample && composer && lastExample.y + lastExample.height <= composer.y,
  ).toBe(true);
  await page.getByRole("button", { name: "제안서를 보내기로 한 사람" }).click();
  await expect(page.getByRole("textbox", { name: "AI에게 질문" })).toHaveValue(
    "제안서를 보내기로 한 사람",
  );
  await expect(
    page.getByRole("textbox", { name: "AI에게 질문" }),
  ).toBeFocused();
  await expect(page.locator("#work-pane")).not.toBeVisible();
  const send = await page
    .getByRole("button", { name: "질문 보내기" })
    .boundingBox();
  const navigation = await page
    .getByRole("navigation", { name: "모바일 메뉴" })
    .boundingBox();
  expect(send && navigation && send.y + send.height <= navigation.y).toBe(true);
});
test("recorded audio stays in this browser after reload and can be removed", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/#recordings");
  await page.getByLabel("음성 파일").setInputFiles({
    name: "sample.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF\u0000\u0000\u0000\u0000WAVEfmt "),
  });
  await expect(
    page.getByRole("region", { name: "이 브라우저의 녹음 목록" }),
  ).toContainText("sample");
  await expect(page.locator(".recording-select")).toContainText(
    "이 브라우저에 보관",
  );
  await page.reload();
  await expect(
    page.getByRole("region", { name: "이 브라우저의 녹음 목록" }),
  ).toContainText("sample");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "sample 삭제" }).click();
  await expect(
    page.getByRole("region", { name: "이 브라우저의 녹음 목록" }),
  ).toContainText("아직 녹음이 없어요");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "이 브라우저의 녹음 목록" }),
  ).toContainText("아직 녹음이 없어요");
});

test("empty workspace offers a working first-card path", async ({ page }) => {
  await mockWorkspace(page, emptyWorkspace());
  await page.goto("/#todos");
  await page
    .getByRole("button", { name: "명함 등록하기", exact: true })
    .click();
  await expect(page).toHaveURL(/#cards$/);
  await expect(
    page.getByRole("button", { name: "이미지 업로드", exact: true }),
  ).toBeVisible();
});
test("AI no-result recovery edits the query without repeating a paid request", async ({
  page,
}) => {
  await mockWorkspace(page);
  let calls = 0;
  await page.route("**/api/recall", (route) => {
    calls++;
    return route.fulfill({
      json: {
        status: "no_result",
        answer: "저장된 기록에서 찾지 못했습니다.",
        results: [],
      },
    });
  });
  await page.goto("/#todos");
  await page.getByRole("textbox", { name: "AI에게 질문" }).fill("물류 담당자");
  await page.getByRole("button", { name: "질문 보내기" }).click();
  await page.getByRole("button", { name: "질문 수정하기" }).click();
  await expect(page.getByRole("textbox", { name: "AI에게 질문" })).toHaveValue(
    "물류 담당자",
  );
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "검색 대화 비우기" }).click();
  await expect(page.locator(".chat-exchange")).toHaveCount(0);
});
test("AI recall shows its evidence and opens the person's pending work", async ({
  page,
}) => {
  const state = fixture();
  await mockWorkspace(page, state);
  await page.route("**/api/recall", (route) =>
    route.fulfill({
      json: {
        queryId: null,
        status: "resolved",
        answer: "한지민님과의 약속을 찾았습니다.",
        results: [
          {
            personId: state.people[0].id,
            displayName: "한지민",
            organizations: ["보라 연구소"],
            headline: "파트너",
            reason: "제품 연구 모임에서 제안서 전달을 약속했습니다.",
            evidence: [
              {
                id: "evidence-1",
                type: "interaction",
                excerpt: "제품 연구 모임에서 물류 파일럿 도입을 논의했습니다.",
                occurredAt: "2026-09-01T00:00:00Z",
              },
            ],
            storedActions: [
              {
                id: state.todos[0].id,
                kind: "commitment",
                title: "제안서 전달",
                status: "pending",
              },
            ],
            suggestion: null,
          },
        ],
      },
    }),
  );
  await page.goto("/#todos");
  await page
    .getByRole("textbox", { name: "AI에게 질문" })
    .fill("제안서를 보내기로 한 사람");
  await page.getByRole("button", { name: "질문 보내기" }).click();
  await expect(
    page.getByText("제품 연구 모임에서 물류 파일럿 도입을 논의했습니다."),
  ).toBeVisible();
  await page.getByRole("button", { name: "이 사람의 할 일 확인하기" }).click();
  await expect(
    page.locator('.profile-tabs button[aria-pressed="true"]'),
  ).toContainText("할 일");
  await expect(page.locator(".profile-todo").first()).toContainText(
    "제안서 전달",
  );
});
for (const width of [390, 768, 1440])
  test(`six views fit ${width}px without horizontal overflow or runtime errors`, async ({
    page,
  }) => {
    await mockWorkspace(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    for (const section of [
      "todos",
      "map",
      "people",
      "meetings",
      "cards",
      "recordings",
    ]) {
      await page.goto(`/#${section}`);
      await expect(page.locator(".page-content")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      if (section === "recordings")
        await expect(page.locator(".recording-capability-note")).toContainText(
          "결과를 확인한 뒤 메모에 추가합니다",
        );
    }
    expect(errors).toEqual([]);
  });
