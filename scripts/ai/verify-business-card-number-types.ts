import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";

import type { ContactNumber } from "../../card_recognition/contact-numbers";
import { businessCardExtractionV1Schema } from "../../src/domain/business-card/business-card-draft";
import { evaluateContactNumberExtraction } from "../../src/domain/business-card/extraction-evaluation";
import { createOpenAiBusinessCardAdapter } from "../../src/server/ai/openai-business-card-adapter";
import { getServerEnv } from "../../src/server/env";

if (!process.argv.includes("--confirm-live"))
  throw new Error("Live synthetic OCR verification requires --confirm-live.");
const env = getServerEnv();
assert(env.OPENAI_API_KEY, "OPENAI_API_KEY is required.");
const adapter = createOpenAiBusinessCardAdapter(env.OPENAI_API_KEY);
const fixtures: {
  name: string;
  rows: [string, string, ContactNumber["type"]][];
}[] = [
  {
    name: "english-labels",
    rows: [
      ["Tel", "02-111-2222", "phone"],
      ["Fax", "02-333-4444", "fax"],
      ["Mobile", "010-5555-6666", "mobile"],
      ["HP", "010-7777-8888", "mobile"],
      ["", "010-9999-0000", "unknown"],
    ],
  },
  {
    name: "abbreviations-and-ambiguity",
    rows: [
      ["T.", "+82 2 1234 5678 ext. 12", "phone"],
      ["F.", "010-1111-2222", "fax"],
      ["H.P.", "02-555-6666", "mobile"],
      ["휴대폰", "010-3333-4444", "mobile"],
      ["Tel/Fax", "02-777-8888", "unknown"],
    ],
  },
];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHANNEL }
    : {}),
});
const results = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1300, height: 850 },
  });
  for (const fixture of fixtures) {
    // Only fixed synthetic labels and fake contacts are rendered or sent to the provider.
    await page.setContent(`<html lang="ko"><meta charset="utf-8"><style>
      body{margin:0;background:#e6e9e6;font:32px Arial,"Malgun Gothic",sans-serif;padding:30px}
      #card{box-sizing:border-box;width:1200px;height:750px;background:white;padding:65px;color:#102e20}
      h1{font-size:48px;margin:30px 0 10px}h2{font-size:26px;margin:0 0 50px}
      .row{display:flex;gap:26px;margin:22px 0}.label{width:210px;font-weight:bold}
      </style><section id="card"><strong>SYNTHETIC TEST CARD</strong><h1>테스트 인물</h1><h2>Persnapse Test Lab</h2>
      ${fixture.rows.map(([label, value]) => `<div class="row"><span class="label">${label}</span><span>${value}</span></div>`).join("")}</section></html>`);
    const bytes = new Uint8Array(
      await page.locator("#card").screenshot({ type: "png" }),
    );
    const start = performance.now();
    const extraction = businessCardExtractionV1Schema.parse(
      await adapter.execute({
        input: {
          bytes,
          filename: `${fixture.name}.png`,
          mimeType: "image/png",
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
        model: env.OPENAI_STRUCTURING_MODEL,
        signal: AbortSignal.timeout(30_000),
      }),
    );
    const expected = fixture.rows.map(([rawLabel, value, type]) => ({
      rawLabel: rawLabel || null,
      value,
      type,
    }));
    const score = evaluateContactNumberExtraction(
      expected,
      extraction.identity.contactNumbers ?? [],
    );
    results.push({
      fixture: fixture.name,
      latencyMs: Math.round(performance.now() - start),
      ...score,
    });
  }
} finally {
  await browser.close();
}
console.log(
  JSON.stringify(
    {
      provider: "openai",
      model: env.OPENAI_STRUCTURING_MODEL,
      syntheticOnly: true,
      paidCalls: fixtures.length,
      results,
    },
    null,
    2,
  ),
);
assert(
  results.every(
    (result) =>
      result.exactCount === result.expectedCount &&
      result.unexpectedCount === 0,
  ),
  "Synthetic number type verification failed.",
);
