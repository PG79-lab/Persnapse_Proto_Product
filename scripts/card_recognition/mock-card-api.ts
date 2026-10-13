/** Local in-memory test adapter: image processing is real, OCR is explicitly mock. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { extractBusinessCardMock } from "../../src/domain/business-card/mock-ocr";
import { extractionToBusinessCardDraft } from "../../src/domain/business-card/business-card-draft";
import type { BusinessCardSessionView } from "../../src/domain/business-card/business-card-workflow";
import { businessCardUploadMetadataSchema } from "../../src/domain/business-card/business-card-workflow";

const cards = new Map<string, BusinessCardSessionView>();
const assets = new Map<string, { bytes: Buffer; type: string }>();
const requests = new Map<string, string>();

export async function mockCardApi(req: IncomingMessage, res: ServerResponse) {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (
    !path.startsWith("/api/business-cards") &&
    !path.startsWith("/api/source-assets/")
  )
    return false;
  const json = (status: number, data: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  };
  try {
    if (path.startsWith("/api/source-assets/") && req.method === "GET") {
      const asset = assets.get(path.split("/").at(-1)!);
      if (!asset) json(404, { error: "Test image not found" });
      else {
        res.writeHead(200, { "Content-Type": asset.type });
        res.end(asset.bytes);
      }
      return true;
    }
    if (path === "/api/business-cards" && req.method === "GET") {
      json(200, [...cards.values()]);
      return true;
    }
    if (path === "/api/business-cards" && req.method === "POST") {
      if (cards.size >= 5)
        throw new Error(
          "Local test supports five cards; remove previous cards or restart.",
        );
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) throw new Error("Image request too large");
        chunks.push(Buffer.from(chunk));
      }
      const form = await new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": String(req.headers["content-type"]) },
        body: Buffer.concat(chunks),
      }).formData();
      const metadata = businessCardUploadMetadataSchema.parse(
        Object.fromEntries(
          [
            "idempotencyKey",
            "referenceTime",
            "originalWidth",
            "originalHeight",
            "displayWidth",
            "displayHeight",
            "processingRecipe",
          ].map((key) => [key, form.get(key)]),
        ),
      );
      const previous = requests.get(metadata.idempotencyKey);
      if (previous) {
        json(201, cards.get(previous));
        return true;
      }
      const original = form.get("original"),
        display = form.get("display");
      if (!(original instanceof File) || !(display instanceof File))
        throw new Error("Images required");
      const captureId = randomUUID(),
        originalAssetId = randomUUID(),
        displayAssetId = randomUUID();
      const bytes = Buffer.from(await display.arrayBuffer());
      const draft = extractionToBusinessCardDraft(
        extractBusinessCardMock({
          filename: original.name,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        }),
        metadata.referenceTime,
      );
      const card: BusinessCardSessionView = {
        captureId,
        state: "draft",
        stage: "card_review",
        originalAssetId,
        displayAssetId,
        imageUrl: `/api/source-assets/${displayAssetId}`,
        draft,
        modelDraft: draft,
        fieldsConfirmedAt: null,
        contextNote: "",
        identityCandidates: [],
        userCorrectionCount: 0,
        ocrProvider: "mock",
        ocrLatencyMs: 0,
        lastErrorCode: null,
        commitResult: null,
        createdAt: new Date().toISOString(),
      };
      assets.set(originalAssetId, {
        bytes: Buffer.from(await original.arrayBuffer()),
        type: original.type,
      });
      assets.set(displayAssetId, { bytes, type: display.type });
      cards.set(captureId, card);
      requests.set(metadata.idempotencyKey, captureId);
      json(201, {
        ...card,
        testDiagnostics: {
          processingRecipe: metadata.processingRecipe,
          displayWidth: metadata.displayWidth,
          displayHeight: metadata.displayHeight,
          originalSha256: createHash("sha256")
            .update(Buffer.from(await original.arrayBuffer()))
            .digest("hex"),
          displaySha256: createHash("sha256").update(bytes).digest("hex"),
        },
      });
      return true;
    }
    if (req.method === "DELETE") {
      const id = path.split("/").at(-1)!,
        card = cards.get(id);
      if (card) {
        assets.delete(card.originalAssetId);
        assets.delete(card.displayAssetId);
        cards.delete(id);
        for (const [key, value] of requests)
          if (value === id) requests.delete(key);
      }
      json(200, { deleted: true });
      return true;
    }
    json(405, {
      error:
        "Local test: OCR is mock; DB save and external AI are disabled. Use the normal app for the full workflow.",
    });
  } catch (error) {
    json(400, {
      error: error instanceof Error ? error.message : "Local test failed",
    });
  }
  return true;
}
