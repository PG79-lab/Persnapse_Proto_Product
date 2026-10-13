import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import manifest from "../../card_recognition/models/manifest.json" with { type: "json" };
import { mockWorkspace } from "./workspace-fixture";

test("loads real FP32 models in a dedicated WASM Worker from the production cards workspace", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await mockWorkspace(page);
  await page.goto("/#cards");
  await expect(page.locator(".connected-capture")).toBeVisible();
  const bundle = await build({
    stdin: {
      contents:
        "import {CardInferenceClient} from './card_recognition/runtime/inference-client'; Object.assign(window,{CardInferenceClient});",
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const measurements = await page.evaluate(async (models) => {
    const api = window as unknown as {
      CardInferenceClient: typeof import("../../card_recognition/runtime/inference-client").CardInferenceClient;
    };
    const rows = [];
    for (const model of models) {
      const client = new api.CardInferenceClient();
      try {
        const ready = await client.prepare(model.staticUrl);
        for (let i = 0; i < 20; i++) {
          const input = new Float32Array(3 * 256 * 256).fill(i / 20);
          const output = await client.infer(input);
          if (
            !output.data.length ||
            output.data.some((v) => !Number.isFinite(v))
          )
            throw new Error("Invalid heatmap");
          rows.push({
            modelId: model.id,
            iteration: i,
            inferenceMs: output.inferenceMs,
            dims: output.dims,
            ready,
          });
        }
      } finally {
        client.dispose();
      }
    }
    return rows;
  }, manifest.models);
  expect(measurements).toHaveLength(40);
  await writeFile(
    testInfo.outputPath("model-production.json"),
    JSON.stringify(
      { status: "PASS", runtime: "1.30.0", device: "PC Chrome", measurements },
      null,
      2,
    ),
  );
  const error = await page.evaluate(async () => {
    const api = window as unknown as {
      CardInferenceClient: typeof import("../../card_recognition/runtime/inference-client").CardInferenceClient;
    };
    const client = new api.CardInferenceClient();
    try {
      await client.prepare("/models/missing/model.onnx");
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "unknown";
    } finally {
      client.dispose();
    }
  });
  expect(error).toBeTruthy();
  await expect(page.locator(".connected-capture")).toBeVisible();
});
