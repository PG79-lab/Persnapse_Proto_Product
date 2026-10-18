import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { mockWorkspace } from "./workspace-fixture";
import { jpegDimensions } from "../../card_recognition/jpeg-dimensions";
import { extractBusinessCardMock } from "../../src/domain/business-card/mock-ocr";
import { extractionToBusinessCardDraft } from "../../src/domain/business-card/business-card-draft";

test("integrated cards rotates encoded JPEG before OCR", async ({ page }) => {
  test.setTimeout(120_000);
  const input = "output/card-rectification/real-pilot/inputs/photo-001.png";
  test.skip(!existsSync(input), "Private real-photo fixture is local only");
  await mockWorkspace(page);
  let postedSize: { width: number; height: number } | null = null;
  await page.route("**/api/business-cards", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] });
    const request = new Request("http://localhost/api/business-cards", {
      method: "POST",
      headers: { "content-type": route.request().headers()["content-type"] },
      body: new Uint8Array(route.request().postDataBuffer()!),
    });
    const form = await request.formData();
    const display = form.get("display") as File;
    const bytes = new Uint8Array(await display.arrayBuffer());
    postedSize = jpegDimensions(bytes);
    expect(form.get("processingRecipe")).toBe("docaligner-lc100-card-v1");
    expect(postedSize?.width).toBe(Number(form.get("displayWidth")));
    expect(postedSize?.height).toBe(Number(form.get("displayHeight")));
    const draft = extractionToBusinessCardDraft(
      extractBusinessCardMock({
        filename: "rotation.jpg",
        sha256: "rotation-smoke",
      }),
      new Date().toISOString(),
    );
    await route.fulfill({
      status: 201,
      json: {
        captureId: "10000000-0000-4000-8000-000000000009",
        state: "draft",
        stage: "card_review",
        originalAssetId: "original",
        displayAssetId: "display",
        imageUrl: `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`,
        draft,
        modelDraft: draft,
        contextNote: "",
        identityCandidates: [],
        userCorrectionCount: 0,
        ocrProvider: "mock",
        ocrLatencyMs: 0,
        lastErrorCode: null,
        commitResult: null,
        createdAt: new Date().toISOString(),
      },
    });
  });
  await page.goto("/#cards");
  await page.getByLabel("명함 이미지 선택").setInputFiles(input);
  const preview = page.getByAltText("OCR에 사용할 2D 명함 이미지");
  await expect(preview).toBeVisible({ timeout: 60000 });
  const dimensions = () =>
    preview.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight };
    });
  const base = await dimensions();
  for (const angle of [90, 180, 270, 0]) {
    await page.getByRole("button", { name: "오른쪽으로 90도 회전" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: `${angle}도 회전했습니다` }),
    ).toBeVisible();
    expect(await dimensions()).toEqual(
      angle === 90 || angle === 270
        ? { width: base.height, height: base.width }
        : base,
    );
  }
  await page.getByRole("button", { name: "오른쪽으로 90도 회전" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "90도 회전했습니다" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "이 2D 이미지로 OCR 실행" }).click();
  await expect(
    page.getByRole("heading", { name: "인식한 명함 정보", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(postedSize).toEqual({ width: base.height, height: base.width });
});
