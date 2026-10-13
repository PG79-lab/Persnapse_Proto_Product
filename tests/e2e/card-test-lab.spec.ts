import { expect, test } from "@playwright/test";
import { mockWorkspace } from "./workspace-fixture";
import { writeFile } from "node:fs/promises";

test("compares real models in the integrated local test panel without OCR or saving", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await mockWorkspace(page);
  let writes = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/") && request.method() !== "GET") writes++;
  });
  await page.goto("/?cardTest=1#cards");
  const lab = page.getByRole("region", { name: "명함 외곽 로컬 테스트" });
  await expect(lab).toBeVisible();
  await expect(lab.getByLabel("검출 모델")).toHaveValue("docaligner-lc100");
  await lab.getByRole("button", { name: "합성 샘플 불러오기" }).click();
  await expect(lab.getByAltText("테스트 촬영 이미지")).toBeVisible();
  const outcomes: {
    engine: string;
    status: string | null;
    measurement: string | null;
  }[] = [];
  for (const engine of ["legacy", "docaligner-t8", "docaligner-lc100"]) {
    await lab.getByLabel("검출 모델").selectOption(engine);
    await lab.getByRole("button", { name: "외곽·복원 테스트 실행" }).click();
    await expect(lab.getByRole("status")).toContainText("테스트 완료", {
      timeout: 40_000,
    });
    await expect(lab.getByLabel("테스트 측정 결과")).toContainText(engine);
    if (engine === "legacy") {
      await expect(lab.getByAltText("테스트 보정 미리보기")).toBeVisible();
      await expect(
        lab.getByRole("link", { name: "보정 JPEG 다운로드" }),
      ).toHaveAttribute("href", /^blob:/);
    } else {
      await expect(lab.getByLabel("테스트 측정 결과")).toContainText(
        "최대 모델 응답",
      );
    }
    outcomes.push({
      engine,
      status: await lab.getByRole("status").textContent(),
      measurement: await lab.getByLabel("테스트 측정 결과").textContent(),
    });
  }
  expect(writes).toBe(0);
  await writeFile(
    testInfo.outputPath("test-lab-results.json"),
    JSON.stringify({ outcomes, apiWrites: writes }, null, 2),
  );
  await page.screenshot({
    path: testInfo.outputPath("card-test-lab.png"),
    fullPage: true,
  });
});

test("reports missing model assets and keeps the selected local image", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.route("**/models/**", (route) =>
    route.fulfill({ status: 404, body: "not found" }),
  );
  await page.goto("/?cardTest=1#cards");
  const lab = page.getByRole("region", { name: "명함 외곽 로컬 테스트" });
  await lab.getByRole("button", { name: "합성 샘플 불러오기" }).click();
  await expect(lab.getByAltText("테스트 촬영 이미지")).toBeVisible();
  await lab.getByLabel("검출 모델").selectOption("docaligner-t8");
  await lab.getByRole("button", { name: "외곽·복원 테스트 실행" }).click();
  await expect(
    lab.getByRole("button", { name: "외곽·복원 테스트 실행" }),
  ).toBeEnabled({ timeout: 30_000 });
  await expect(lab.getByRole("status")).toContainText(
    /404|fetch|failed|load|error/i,
  );
  await expect(lab.getByAltText("테스트 촬영 이미지")).toBeVisible();
  await expect(lab.getByAltText("테스트 보정 미리보기")).toHaveCount(0);
});
