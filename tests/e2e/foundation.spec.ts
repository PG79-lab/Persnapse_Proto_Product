import { expect, test } from "@playwright/test";
import { parseRecallQuery } from "../../src/domain/recall/query-parser";
import { buildRecallResponse } from "../../src/domain/recall/ranker";
import type { RecallCorpusPerson } from "../../src/domain/recall/types";
import { emptyWorkspace } from "../../src/features/workspace/store";
import { mockWorkspace } from "./workspace-fixture";

const personId = "20000000-0000-4000-8000-000000000001";
let recallCalls = 0;

test.beforeEach(async ({ page }) => {
  recallCalls = 0;
  const corpus: RecallCorpusPerson[] = [
    "부산 파일럿 제안서를 보내기로 했다",
    "서울 디자인 프로젝트를 논의했다",
  ].map((text, index) => ({
    id: `20000000-0000-4000-8000-00000000000${index + 1}`,
    displayName: "김민준",
    normalizedName: "김민준",
    headline: index ? "디자이너" : "물류 담당",
    organizations: [index ? "디자인연구소" : "물류연구소"],
    documentId: null,
    documentContent: text,
    evidence: [
      {
        id: `memory-${index}`,
        type: "memory_statement",
        text,
        occurredAt: "2026-09-03T00:00:00Z",
        verificationStatus: "confirmed",
        memoryStatementId: null,
        memoryDocumentId: null,
        actionStatus: null,
      },
    ],
    actions: index
      ? []
      : [
          {
            id: "50000000-0000-4000-8000-000000000001",
            kind: "commitment",
            title: "부산 파일럿 제안서 전달",
            details: null,
            dueAt: null,
            status: "pending",
          },
        ],
  }));
  const state = emptyWorkspace();
  state.people = corpus.map((person) => ({
    id: person.id,
    version: 1,
    deletedAt: null,
    name: person.displayName,
    company: person.organizations[0],
    job: person.headline,
    email: null,
    phone: null,
    status: "unclassified",
    importance: 3,
    relationshipCategories: [],
    createdAt: "2026-09-03T00:00:00Z",
    history: [
      {
        id: `note-${person.id}`,
        version: 1,
        deletedAt: null,
        date: "2026-09-03",
        text: person.documentContent,
      },
    ],
    businessCards: [
      { id: "card-test", displayAssetId: "asset-test", originalRetained: true },
    ],
  }));
  await mockWorkspace(page, state);
  await page.route("**/api/recall", (route) => {
    recallCalls++;
    const { query } = route.request().postDataJSON();
    return route.fulfill({
      json: buildRecallResponse(
        query,
        parseRecallQuery(query, new Date("2026-10-08T00:00:00Z")),
        corpus,
        1,
      ),
    });
  });
  await page.route("**/api/source-assets/asset-test", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="white"/><text x="40" y="150" font-size="40">Synthetic card</text></svg>',
    }),
  );
});

test("shows the integrated workspace and all six task menus", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "관계 지도",
  );
  for (const name of [
    "일정/업무관리",
    "관계 지도",
    "인맥 관리",
    "만남 기록",
    "명함 등록",
    "녹음",
  ])
    await expect(
      page
        .getByRole("navigation", { name: "주요 메뉴" })
        .getByRole("button", { name, exact: true }),
    ).toBeVisible();
});

for (const [oldPath, destination, heading] of [
  ["/capture", "/#cards", "명함 등록"],
  ["/people", "/#people", "인맥 관리"],
] as const) {
  test(`${oldPath} redirects to the integrated ${heading} page`, async ({
    page,
    request,
  }) => {
    const response = await request.get(oldPath, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe(destination);
    await page.goto(oldPath);
    await expect(page).toHaveURL(destination);
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
    await expect(page.locator(".integrated-workspace")).toHaveCount(1);
  });
}

test("old person links open the integrated profile and its card viewer", async ({
  page,
}) => {
  await page.goto(`/people/${personId}`);
  await expect(page).toHaveURL(`/?person=${personId}#people`);
  const profile = page.getByRole("dialog", {
    name: "인맥 프로필",
    exact: true,
  });
  await expect(
    profile.getByRole("heading", { name: "김민준", exact: true }),
  ).toBeVisible();
  await expect(
    profile.getByText("부산 파일럿 제안서를 보내기로 했다"),
  ).toBeVisible();
  await profile.getByRole("button", { name: "정보", exact: true }).click();
  const card = profile.getByRole("region", { name: "등록한 명함" });
  await expect(card.getByRole("img", { name: "표시 중인 명함" })).toBeVisible();
  await card.getByRole("button", { name: "확대", exact: true }).click();
  await expect(card.getByText("125%", { exact: true })).toBeVisible();
  await card
    .getByLabel("명함 이미지. 드래그하거나 방향키로 이동할 수 있습니다.")
    .press("ArrowRight");
  await expect(card.getByRole("img")).toHaveCSS(
    "transform",
    "matrix(1.25, 0, 0, 1.25, 24, 0)",
  );
});

test("old recall links preserve the query without automatically searching", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `/recall?q=${encodeURIComponent("부산 파일럿 제안서를 보내기로 한 사람")}`,
  );
  await expect(page).toHaveURL(/#todos$/);
  await expect(page.getByLabel("AI에게 질문")).toHaveValue(
    "부산 파일럿 제안서를 보내기로 한 사람",
  );
  expect(recallCalls).toBe(0);
  await page.getByRole("button", { name: "질문 보내기" }).click();
  await expect(
    page.getByText(/가장 관련 있는 사람은 김민준님입니다/),
  ).toBeVisible();
  await expect(page.locator(".answer-evidence")).toContainText(
    "부산 파일럿 제안서를 보내기로 했다",
  );
  await expect(page.locator(".stored-action")).toContainText(
    "부산 파일럿 제안서 전달",
  );
  expect(recallCalls).toBe(1);
});

test("keeps duplicate names ambiguous in the integrated assistant", async ({
  page,
}) => {
  await page.goto(`/?assistant=1&q=${encodeURIComponent("김민준")}#todos`);
  await page.getByRole("button", { name: "질문 보내기" }).click();
  await expect(page.getByText("인물 확인 필요", { exact: true })).toBeVisible();
  await expect(page.getByText(/여러 사람이 있습니다/)).toBeVisible();
  await expect(page.locator(".answer-person")).toHaveCount(2);
});

test("shows no-result recovery without invented evidence", async ({ page }) => {
  await page.goto(
    `/?assistant=1&q=${encodeURIComponent("고대 악기 복원 연주 전문가")}#todos`,
  );
  await page.getByRole("button", { name: "질문 보내기" }).click();
  await expect(page.getByText("관련 기록 없음", { exact: true })).toBeVisible();
  await expect(page.getByText(/찾지 못했습니다/)).toBeVisible();
  await expect(page.locator(".answer-person")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "질문 수정하기" }),
  ).toBeVisible();
});
