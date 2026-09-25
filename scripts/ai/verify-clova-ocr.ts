import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createSyntheticBusinessCardImage } from "./synthetic-business-card-image";
import { businessCardExtractionV1Schema } from "../../src/domain/business-card/business-card-draft";
import { createClovaBusinessCardAdapter } from "../../src/server/ai/clova-business-card-adapter";
import { getServerEnv } from "../../src/server/env";

if (!process.argv.includes("--confirm-live")) {
  console.error(
    "CLOVA OCR live verification requires --confirm-live; this guard prevents accidental paid calls.",
  );
  process.exit(2);
}

const environment = getServerEnv();
assert(environment.CLOVA_OCR_INVOKE_URL, "CLOVA_OCR_INVOKE_URL is required.");
assert(environment.CLOVA_OCR_SECRET, "CLOVA_OCR_SECRET is required.");

const image = await createSyntheticBusinessCardImage();
const startedAt = performance.now();
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 20_000);

try {
  const adapter = createClovaBusinessCardAdapter({
    invokeUrl: environment.CLOVA_OCR_INVOKE_URL,
    secret: environment.CLOVA_OCR_SECRET,
  });
  const output = await adapter.execute({
    input: {
      bytes: image.bytes,
      filename: "synthetic-business-card.png",
      mimeType: "image/png",
      sha256: createHash("sha256").update(image.bytes).digest("hex"),
    },
    model: "clova-ocr",
    signal: controller.signal,
  });
  const extraction = businessCardExtractionV1Schema.parse(output);
  const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
  const contactCount =
    extraction.identity.emails.length + extraction.identity.phones.length;

  assert(
    extraction.identity.displayName || extraction.identity.organizationName,
    "CLOVA OCR did not detect a name or organization from the synthetic card.",
  );
  assert(contactCount > 0, "CLOVA OCR did not detect a contact field.");

  console.log(
    JSON.stringify(
      {
        verified: true,
        inputClassification: "synthetic-only",
        provider: "naver_clova",
        schema: extraction.schemaVersion,
        detectedFieldCount: extraction.observedFields.length,
        hasDisplayName: Boolean(extraction.identity.displayName),
        hasOrganization: Boolean(extraction.identity.organizationName),
        emailCount: extraction.identity.emails.length,
        phoneCount: extraction.identity.phones.length,
        websiteCount: extraction.identity.websites.length,
        latencyMs,
        metFiveSecondGoal: latencyMs <= 5_000,
        secretValuesLogged: false,
      },
      null,
      2,
    ),
  );
} finally {
  clearTimeout(timeout);
}
