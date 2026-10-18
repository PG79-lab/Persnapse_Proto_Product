/** One paired live comparison through the existing server/cost guard; no retries. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const output = resolve(
  "output/card-rectification/optimization-quality-2026-10-13",
);
const base = "http://127.0.0.1:3002";
const report = {
  scope: "photo-001 only; same existing server configuration; max two attempts",
  rows: [],
  finalCommit: false,
};
try {
  const preflight = await fetch(`${base}/api/business-cards`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!preflight.ok)
    throw new Error(
      `Server/DB preflight HTTP ${preflight.status}; no OCR submitted`,
    );
  const metadata = JSON.parse(
    await readFile(resolve(output, "ocr-input-metadata.json"), "utf8"),
  );
  // Transcribed before reading either OCR response. Company omitted as ambiguous.
  const truth = {
    displayName: "양성혁",
    email: "team@koreainsider.kr",
    phoneDigits: ["01084577063", "8201084577063", "821084577063"],
  };
  await writeFile(
    resolve(output, "ocr-truth.json"),
    JSON.stringify({ status: "PROVISIONAL_SINGLE_AUTHOR", truth }, null, 2),
  );
  const original = await readFile(resolve(output, "ocr-original.jpg"));
  for (const variant of ["before", "after"]) {
    const form = new FormData();
    form.set("idempotencyKey", randomUUID());
    form.set("referenceTime", new Date().toISOString());
    form.set("originalWidth", String(metadata.originalWidth));
    form.set("originalHeight", String(metadata.originalHeight));
    form.set("displayWidth", String(metadata[`${variant}Width`]));
    form.set("displayHeight", String(metadata[`${variant}Height`]));
    form.set(
      "processingRecipe",
      variant === "before" ? "canvas-card-v1" : "docaligner-lc100-card-v1",
    );
    form.set(
      "original",
      new File([original], "quick-pilot-original.jpg", { type: "image/jpeg" }),
    );
    form.set(
      "display",
      new File(
        [await readFile(resolve(output, `ocr-${variant}.jpg`))],
        `quick-pilot-${variant}.jpg`,
        { type: "image/jpeg" },
      ),
    );
    const start = Date.now();
    const response = await fetch(`${base}/api/business-cards`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(25000),
    });
    const payload = await response.json();
    const identity = payload.draft?.identity;
    const row = {
      variant,
      httpStatus: response.status,
      elapsedMs: Date.now() - start,
      provider: payload.ocrProvider ?? null,
      payload,
      scores: identity
        ? {
            name: identity.displayName === truth.displayName,
            email: identity.emails.some((e) => e.toLowerCase() === truth.email),
            phone: identity.phones.some((p) =>
              truth.phoneDigits.includes(p.replace(/\D/g, "")),
            ),
          }
        : null,
    };
    report.rows.push(row);
    if (payload.captureId) {
      const cleanup = await fetch(
        `${base}/api/business-cards/${payload.captureId}`,
        { method: "DELETE", signal: AbortSignal.timeout(8000) },
      );
      row.cleanupStatus = cleanup.status;
    }
    await writeFile(
      resolve(output, "ocr-live.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        variant,
        httpStatus: row.httpStatus,
        elapsedMs: row.elapsedMs,
        provider: row.provider,
        scores: row.scores,
        cleanupStatus: row.cleanupStatus,
      }),
    );
    if (!response.ok) break;
  }
} catch (error) {
  report.error = error.message;
  console.log(
    JSON.stringify({ status: "PARTIAL_OR_NOT_RUN", reason: error.message }),
  );
}
await writeFile(
  resolve(output, "ocr-live.json"),
  JSON.stringify(report, null, 2),
);
