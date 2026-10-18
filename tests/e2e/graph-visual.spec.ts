import {
  test,
  expect,
  fixtureId,
  frontendGraphFixture,
} from "../fixtures/frontend-graph";
import type { Page } from "@playwright/test";

const node = (page: Page, index: number) =>
  page.locator(`[data-node-key="person:${fixtureId(1, index)}"]`);
const position = (page: Page, index: number) =>
  node(page, index).evaluate((el) => ({
    x: el.getAttribute("data-x"),
    y: el.getAttribute("data-y"),
    transform: el.parentElement?.getAttribute("transform"),
  }));
const inspector = (page: Page) =>
  page.getByRole("complementary", { name: "선택 기록 상세" });
async function start(page: Page) {
  await page.goto("/");
  await expect(
    page.locator('.graph-svg[data-layout-settled="true"]'),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test("Graph is the default; selecting and closing keeps coordinates, center and selection", async ({
  page,
}) => {
  await start(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "관계 지도",
  );
  const before = await position(page, 1);
  await node(page, 2).press("Enter");
  await expect(
    inspector(page).getByRole("heading", { name: "이서연", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".graph-context")).toContainText("김민수");
  expect(await position(page, 1)).toEqual(before);
  await page.getByRole("button", { name: "상세 닫기", exact: true }).click();
  await expect(inspector(page)).toHaveCount(0);
  await expect(node(page, 2)).toHaveAttribute("aria-pressed", "true");
  expect(await position(page, 1)).toEqual(before);
  await expect(node(page, 2)).toBeFocused();
  await page.locator(".graph-svg").click({ position: { x: 8, y: 8 } });
  await expect(node(page, 2)).toHaveAttribute("aria-pressed", "false");
});

test("stored evidence reads in the same inspector and returns to the same person", async ({
  page,
}) => {
  await start(page);
  await node(page, 1).press("Enter");
  await inspector(page)
    .getByRole("button", { name: /가을 데모데이에서의 대화/ })
    .click();
  await expect(inspector(page).locator(".graph-source-text")).toContainText(
    "제품 소개 자료를 보내기로 했다",
  );
  await inspector(page)
    .getByRole("button", { name: "상세로 돌아가기" })
    .click();
  await expect(
    inspector(page).getByRole("heading", { name: "김민수", exact: true }),
  ).toBeVisible();
});

test("filter-out selection retains detail; global search distinguishes duplicate names", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: /^필터$/ }).click();
  await page.getByLabel("상태", { exact: true }).selectOption("success");
  await page.getByRole("button", { name: "필터 닫기" }).click();
  const search = page.getByRole("textbox", { name: "전체 인맥 검색" });
  await search.fill("모노웍스");
  await search.press("Enter");
  await expect(inspector(page)).toContainText("모노웍스");
  await expect(inspector(page)).toContainText("현재 필터 밖");
  await expect(page.locator(".graph-node")).toHaveCount(0);
  await inspector(page)
    .getByRole("button", { name: "필터 해제 후 지도에서 보기" })
    .click();
  await expect(node(page, 4)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".graph-context")).toContainText("김민수");
});

test("focus, pin, expansion, collapse and Back preserve the original layout", async ({
  page,
}) => {
  await start(page);
  const before = await position(page, 1);
  await node(page, 2).press("Enter");
  await page.getByRole("button", { name: "위치 고정", exact: true }).click();
  await page.getByRole("button", { name: "관련 기록 펼치기" }).click();
  await page.getByRole("button", { name: /참석 만남/ }).click();
  await expect(
    page.locator(`[data-node-key="interaction:${fixtureId(2, 2)}"]`),
  ).toBeVisible();
  expect(await position(page, 1)).toEqual(before);
  await page.getByRole("button", { name: /이서연.*접기/ }).click();
  await expect(
    page.locator(`[data-node-key="interaction:${fixtureId(2, 2)}"]`),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "이전 탐색", exact: true }).click();
  await expect(
    page.locator(`[data-node-key="interaction:${fixtureId(2, 2)}"]`),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "위치 고정 해제", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await position(page, 1)).toEqual(before);
});

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
  [768, 1024],
  [390, 844],
]) {
  test(`VD01 ${width}: no overflow; list, map, inspector and keyboard remain available`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await start(page);
    // Production CSS must preserve the adopted font and reserved reading column.
    await expect(page.locator(".integrated-workspace")).toHaveCSS(
      "font-family", /Persnapse Sans/,
    );
    if (width >= 960) {
      const canvas = await page.locator(".graph-canvas-layer").boundingBox();
      const overview = await page.locator(".graph-overview").boundingBox();
      expect(canvas!.x + canvas!.width).toBeLessThanOrEqual(overview!.x + 1);
      await expect(page.locator(".topbar")).toHaveCSS("height", "60px");
    }
    await page.screenshot({
      path: testInfo.outputPath(`VD01-default-${width}.png`),
    });
    await node(page, 1).press("Enter");
    await expect(inspector(page)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`VD01-selected-${width}.png`),
    });
    if (width < 960) {
      const navBox = await page
        .getByRole("navigation", { name: "모바일 메뉴" })
        .boundingBox();
      expect(navBox!.y).toBeGreaterThan(height - 80);
      const selectedBox = await node(page, 1).boundingBox();
      const inspectorBox = await inspector(page).boundingBox();
      expect(selectedBox!.y + selectedBox!.height).toBeLessThan(
        inspectorBox!.y,
      );
      await page.getByRole("button", { name: "상세 펼치기" }).click();
      await expect(inspector(page)).toHaveClass(/is-expanded/);
    }
    await page.getByRole("button", { name: "상세 닫기", exact: true }).click();
    await page.locator(".graph-presentation").click();
    await page.getByRole("textbox", { name: "지도 목록 검색" }).fill("작은숲");
    await page.locator(".graph-inline-list .graph-archive-row").click();
    await expect(inspector(page)).toContainText("한지우");
    await expect(inspector(page)).toContainText(
      "연결 이유를 확인할 만남 기록이 없습니다",
    );
  });
}

test("unregistered server API cannot reach real storage in preview", async ({
  request,
}) => {
  const response = await request.post("/api/workspace", {
    data: { operations: [] },
  });
  expect(response.status()).toBe(501);
  expect((await response.json()).code).toBe("PREVIEW_OPERATION_UNAVAILABLE");
});

test("refreshed deletion removes stale source text and deleted person detail", async ({
  page,
}) => {
  const state = frontendGraphFixture();
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      json: {
        state,
        loadedAt: "2026-10-13T03:00:00.000Z",
        capabilities: {
          storage: "server",
          aiMode: "mock",
          ocrMode: "mock",
          preview: "FG-FIXTURE-01",
        },
      },
    }),
  );
  await start(page);
  await node(page, 1).press("Enter");
  await inspector(page)
    .getByRole("button", { name: "전체 기록", exact: true })
    .click();
  await expect(inspector(page).locator(".graph-source-text")).toContainText(
    "초기 제품의 사용 경험",
  );
  state.people[0].history[0].deletedAt = "2026-10-14T03:00:00.000Z";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(inspector(page)).toContainText("기록을 열 수 없습니다");
  await expect(inspector(page)).not.toContainText("초기 제품의 사용 경험");
  state.people[0].deletedAt = "2026-10-14T03:01:00.000Z";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(inspector(page)).toContainText("이 기록을 열 수 없습니다");
  await expect(inspector(page)).not.toContainText("가온벤처스");
  await expect(node(page, 1)).toHaveCount(0);
});
