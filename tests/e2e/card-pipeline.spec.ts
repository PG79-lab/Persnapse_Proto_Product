import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { mockWorkspace } from "./workspace-fixture";
import { extractBusinessCardMock } from "../../src/domain/business-card/mock-ocr";
import { extractionToBusinessCardDraft } from "../../src/domain/business-card/business-card-draft";

test("camera capture waits for manual rectification and image acceptance before OCR when LC100 is unavailable", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await mockWorkspace(page);
  const image = await readFile(
    "tests/fixtures/card_recognition/lab/sample.png",
  );
  const dataUrl = `data:image/png;base64,${image.toString("base64")}`;
  await page.addInitScript(
    ({ dataUrl }) => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          const image = new Image();
          image.src = dataUrl;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          canvas.getContext("2d")!.drawImage(image, 0, 0);
          return canvas.captureStream(10);
        },
      });
      Object.defineProperty(window, "ImageCapture", {
        value: class {
          async takePhoto() {
            return (await fetch(dataUrl)).blob();
          }
        },
      });
    },
    { dataUrl },
  );
  await page.route("**/models/**", (route) =>
    route.fulfill({ status: 404, body: "missing model" }),
  );
  let ocrRequests = 0;
  await page.route("**/api/business-cards", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    ocrRequests++;
    expect(route.request().postData()).toContain("manual-card-v1");
    const draft = extractionToBusinessCardDraft(
      extractBusinessCardMock({
        filename: "camera.png",
        sha256: "camera-smoke",
      }),
      new Date().toISOString(),
    );
    await route.fulfill({
      status: 201,
      json: {
        captureId: "10000000-0000-4000-8000-000000000007",
        state: "draft",
        stage: "card_review",
        originalAssetId: "original",
        displayAssetId: "display",
        imageUrl: dataUrl,
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
  await page.getByRole("button", { name: "명함 촬영", exact: true }).click();
  await expect(page.getByRole("button", { name: "촬영하기" })).toBeEnabled();
  await page.getByRole("button", { name: "촬영하기" }).click();
  await page.getByRole("button", { name: "이 사진으로 인식" }).click();
  await expect(
    page.getByRole("heading", { name: "명함 테두리·2D 이미지 확인" }),
  ).toBeVisible({ timeout: 30_000 });
  expect(ocrRequests).toBe(0);
  await expect(
    page.getByRole("button", { name: "이 2D 이미지로 OCR 실행" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "지정한 영역으로 보정" }).click();
  await expect(page.getByAltText("OCR에 사용할 2D 명함 이미지")).toBeVisible({
    timeout: 20_000,
  });
  expect(ocrRequests).toBe(0);
  await page.getByRole("button", { name: "이 2D 이미지로 OCR 실행" }).click();
  await expect(
    page.getByRole("heading", { name: "인식한 명함 정보", exact: true }),
  ).toBeVisible();
  expect(ocrRequests).toBe(1);
});
