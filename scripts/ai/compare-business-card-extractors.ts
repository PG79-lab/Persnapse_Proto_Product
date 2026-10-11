import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createSyntheticBusinessCardImage } from "./synthetic-business-card-image";
import type { BusinessCardExtractionV1 } from "../../src/domain/business-card/business-card-draft";
import { businessCardExtractionV1Schema } from "../../src/domain/business-card/business-card-draft";
import { evaluateBusinessCardExtraction } from "../../src/domain/business-card/extraction-evaluation";
import { createClovaBusinessCardAdapter } from "../../src/server/ai/clova-business-card-adapter";
import { createOpenAiBusinessCardAdapter } from "../../src/server/ai/openai-business-card-adapter";
import { getServerEnv } from "../../src/server/env";

if (!process.argv.includes("--confirm-live")) {
  throw new Error("Live provider comparison requires --confirm-live.");
}

const env = getServerEnv();
assert(env.CLOVA_OCR_INVOKE_URL && env.CLOVA_OCR_SECRET);
assert(env.OPENAI_API_KEY);

const clova = createClovaBusinessCardAdapter({
  invokeUrl: env.CLOVA_OCR_INVOKE_URL,
  secret: env.CLOVA_OCR_SECRET,
});
const vision = createOpenAiBusinessCardAdapter(env.OPENAI_API_KEY);
const expected: Record<
  "standard" | "compact",
  BusinessCardExtractionV1["identity"]
> = {
  standard: {
    displayName: "김하늘",
    organizationName: "PERSNAPSE LABS",
    title: "Product Lead",
    department: "Product Team",
    emails: ["haneul.kim@example.com"],
    phones: ["010-1234-5678"],
    websites: ["www.persnapse.example"],
    address: "서울특별시 강남구 테헤란로 123",
  },
  compact: {
    displayName: "박준서",
    organizationName: "ORBIT STUDIO",
    title: "Business Development",
    department: null,
    emails: ["junseo.park@example.com"],
    phones: ["010-9876-5432"],
    websites: [],
    address: null,
  },
};

const results: Array<{
  layout: string;
  degradation: string;
  candidate: string;
  latencyMs: number;
  presentFields?: number;
  matchedPresentFields?: number;
  correctionFields?: number;
  falsePositiveFields?: number;
  errorCode?: string;
}> = [];

for (const layout of ["standard", "compact"] as const) {
  for (const degradation of ["none", "gaussian"] as const) {
    const image = await createSyntheticBusinessCardImage(
      "",
      layout,
      degradation,
    );
    const mimeType = degradation === "gaussian" ? "image/jpeg" : "image/png";
    const input = {
      bytes: image.bytes,
      filename: `synthetic-${layout}-${degradation}.${degradation === "gaussian" ? "jpg" : "png"}`,
      mimeType,
      sha256: createHash("sha256").update(image.bytes).digest("hex"),
    };
    const candidates = [
      {
        name: "clova_general",
        run: (signal: AbortSignal) =>
          clova.execute({ input, model: "clova-ocr", signal }),
      },
      {
        name: "openai_vision",
        run: (signal: AbortSignal) =>
          vision.execute({
            input,
            model: env.OPENAI_STRUCTURING_MODEL,
            signal,
          }),
      },
    ];
    for (const candidate of candidates) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);
      const started = performance.now();
      try {
        const extraction = businessCardExtractionV1Schema.parse(
          await candidate.run(controller.signal),
        );
        const scored = evaluateBusinessCardExtraction(
          expected[layout],
          extraction.identity,
        );
        results.push({
          layout,
          degradation,
          candidate: candidate.name,
          latencyMs: Math.round(performance.now() - started),
          presentFields: scored.presentFields,
          matchedPresentFields: scored.matchedPresentFields,
          correctionFields: scored.correctionFields,
          falsePositiveFields: scored.falsePositiveFields,
        });
      } catch (error) {
        results.push({
          layout,
          degradation,
          candidate: candidate.name,
          latencyMs: Math.round(performance.now() - started),
          errorCode:
            error instanceof Error &&
            "code" in error &&
            typeof error.code === "string"
              ? error.code
              : error instanceof Error
                ? error.name
                : "UNKNOWN_ERROR",
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  }
}

console.log(
  JSON.stringify(
    {
      inputClassification: "synthetic-only",
      paidProviderCalls: results.length,
      model: env.OPENAI_STRUCTURING_MODEL,
      results,
      note: "Synthetic examples do not establish real-card accuracy or p95 latency.",
    },
    null,
    2,
  ),
);
