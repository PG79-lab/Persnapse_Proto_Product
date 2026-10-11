// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  card: vi.fn(),
  recall: vi.fn(),
  sql: vi.fn(),
}));
vi.mock("../../src/server/env", () => ({
  getServerEnv: () => ({ APP_DEFAULT_WORKSPACE_ID: "server-workspace" }),
}));
vi.mock("../../src/server/db/client", () => ({ getDatabase: () => mocks.sql }));
vi.mock("../../src/server/application/capture-service", async (original) => ({
  ...(await original<
    typeof import("../../src/server/application/capture-service")
  >()),
  createAndStructureTextCapture: mocks.capture,
}));
vi.mock(
  "../../src/server/application/business-card-service",
  async (original) => ({
    ...(await original<
      typeof import("../../src/server/application/business-card-service")
    >()),
    createAndExtractBusinessCard: mocks.card,
  }),
);
vi.mock("../../src/server/application/recall-service", () => ({
  executeRecall: mocks.recall,
}));

import { POST as createCapture } from "../../src/app/api/captures/route";
import { POST as commitCapture } from "../../src/app/api/captures/[captureId]/commit/route";
import { POST as captureCandidates } from "../../src/app/api/captures/[captureId]/candidates/route";
import { POST as uploadCard } from "../../src/app/api/business-cards/route";
import { POST as prepareCard } from "../../src/app/api/business-cards/[captureId]/prepare-review/route";
import { POST as commitCard } from "../../src/app/api/business-cards/[captureId]/commit/route";
import { POST as cardCandidates } from "../../src/app/api/business-cards/[captureId]/candidates/route";
import { POST as retryCard } from "../../src/app/api/business-cards/[captureId]/retry/route";
import { POST as recall } from "../../src/app/api/recall/route";
import { POST as feedback } from "../../src/app/api/feedback/route";
import { POST as observation } from "../../src/app/api/recall/observation/route";
import { AiTaskExecutionError } from "../../src/server/ai/runtime-router";

const id = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ captureId: id }) };
const jsonEndpoints = [
  ["/api/captures", createCapture],
  [
    `/api/captures/${id}/commit`,
    (request: Request) => commitCapture(request, context),
  ],
  [
    `/api/captures/${id}/candidates`,
    (request: Request) => captureCandidates(request, context),
  ],
  [
    `/api/business-cards/${id}/prepare-review`,
    (request: Request) => prepareCard(request, context),
  ],
  [
    `/api/business-cards/${id}/commit`,
    (request: Request) => commitCard(request, context),
  ],
  [
    `/api/business-cards/${id}/candidates`,
    (request: Request) => cardCandidates(request, context),
  ],
  [
    `/api/business-cards/${id}/retry`,
    (request: Request) => retryCard(request, context),
  ],
  ["/api/recall", recall],
  ["/api/feedback", feedback],
  ["/api/recall/observation", observation],
] as const;

function jsonRequest(path: string, body: string) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function cardForm() {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    idempotencyKey: id,
    referenceTime: "2026-10-07T10:00:00Z",
    originalWidth: "600",
    originalHeight: "400",
    displayWidth: "600",
    displayHeight: "400",
    processingRecipe: "canvas-card-v1",
  }))
    form.set(name, value);
  for (const name of ["original", "display"])
    form.set(
      name,
      new File(["synthetic fixture"], `${name}.png`, { type: "image/png" }),
    );
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_REMOTE_PROTOTYPE_ACCESS", "off");
});

describe.each(jsonEndpoints)("JSON input contract: %s", (path, handler) => {
  it.each(["", '{"private-fixture-text":'])(
    "returns 400 for an empty or malformed body without repository/provider work: %j",
    async (body) => {
      const response = await handler(jsonRequest(path, body));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_JSON" });
      expect(mocks.sql).not.toHaveBeenCalled();
      expect(mocks.capture).not.toHaveBeenCalled();
      expect(mocks.card).not.toHaveBeenCalled();
      expect(mocks.recall).not.toHaveBeenCalled();
    },
  );
});

describe("business card multipart input contract", () => {
  it.each(["original", "display"])(
    "returns 400 when %s image is missing or is a text field",
    async (name) => {
      for (const value of [null, "not-an-image"]) {
        const form = cardForm();
        if (value === null) form.delete(name);
        else form.set(name, value);
        const response = await uploadCard(
          new Request("http://localhost/api/business-cards", {
            method: "POST",
            body: form,
          }),
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          code: "BUSINESS_CARD_IMAGE_REQUIRED",
        });
        expect(mocks.card).not.toHaveBeenCalled();
        expect(mocks.sql).not.toHaveBeenCalled();
      }
    },
  );

  it("returns 400 for an unreadable multipart body", async () => {
    const response = await uploadCard(
      new Request("http://localhost/api/business-cards", {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data" },
        body: "invalid multipart",
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_FORM_DATA" });
    expect(mocks.card).not.toHaveBeenCalled();
  });

  it("passes valid files and metadata to the service using the server workspace", async () => {
    mocks.card.mockResolvedValue({ captureId: id });
    const response = await uploadCard(
      new Request("http://localhost/api/business-cards", {
        method: "POST",
        body: cardForm(),
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.card).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "server-workspace",
        originalFile: expect.any(File),
        displayFile: expect.any(File),
        originalWidth: 600,
      }),
    );
  });
});

describe("valid payloads and application failures remain distinct", () => {
  const captureBody = JSON.stringify({
    rawText: "김검증과 전시회에서 만나 제안서를 논의했다.",
    idempotencyKey: id,
  });

  it("preserves the valid text capture contract", async () => {
    mocks.capture.mockResolvedValue({ captureId: id });
    expect(
      (await createCapture(jsonRequest("/api/captures", captureBody))).status,
    ).toBe(201);
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "server-workspace",
        idempotencyKey: id,
      }),
    );
  });

  it("preserves the valid Recall contract", async () => {
    mocks.recall.mockResolvedValue({ status: "no_result" });
    expect(
      (
        await recall(
          jsonRequest(
            "/api/recall",
            JSON.stringify({ query: "김검증과의 약속" }),
          ),
        )
      ).status,
    ).toBe(200);
    expect(mocks.recall).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "server-workspace",
        queryText: "김검증과의 약속",
      }),
    );
  });

  it.each(["capture", "card", "recall"] as const)(
    "does not mislabel a %s service SyntaxError as invalid user JSON",
    async (service) => {
      mocks[service].mockRejectedValue(
        new SyntaxError("internal-private-fixture-detail"),
      );
      const response =
        service === "capture"
          ? await createCapture(jsonRequest("/api/captures", captureBody))
          : service === "recall"
            ? await recall(
                jsonRequest(
                  "/api/recall",
                  JSON.stringify({ query: "김검증과의 약속" }),
                ),
              )
            : await uploadCard(
                new Request("http://localhost/api/business-cards", {
                  method: "POST",
                  body: cardForm(),
                }),
              );
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain(
        "internal-private-fixture-detail",
      );
    },
  );
});

describe("Recall integration response contract", () => {
  it("rejects a client workspace or legacy parse payload before AI work", async () => {
    for (const body of [
      { query: "검증 질문", workspaceId: id },
      { query: "검증 질문", mode: "search", data: {} },
    ]) {
      const response = await recall(
        jsonRequest("/api/recall", JSON.stringify(body)),
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.recall).not.toHaveBeenCalled();
  });
  it("returns provider rate-limit wait metadata instead of a generic outage", async () => {
    mocks.recall.mockRejectedValue(
      new AiTaskExecutionError(
        "private fixture",
        "AI_PROVIDER_RATE_LIMITED",
        false,
        125,
      ),
    );
    const response = await recall(
      jsonRequest("/api/recall", JSON.stringify({ query: "검증 질문" })),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("125");
    expect(await response.json()).toMatchObject({
      code: "AI_PROVIDER_RATE_LIMITED",
      retryAfterSeconds: 125,
    });
  });
  it("returns 404 when the query is missing or belongs to another workspace", async () => {
    mocks.sql.mockResolvedValue([]);
    const response = await observation(
      jsonRequest(
        "/api/recall/observation",
        JSON.stringify({ queryId: id, elapsedMs: 15 }),
      ),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ recorded: false });
  });
  it("records latency only when the server-scoped update found a query", async () => {
    mocks.sql.mockResolvedValue([{ id }]);
    const response = await observation(
      jsonRequest(
        "/api/recall/observation",
        JSON.stringify({ queryId: id, elapsedMs: 15 }),
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ recorded: true });
  });
  it("does not mislabel a database outage as an invalid input", async () => {
    mocks.sql.mockRejectedValue(new Error("private fixture"));
    const response = await observation(
      jsonRequest(
        "/api/recall/observation",
        JSON.stringify({ queryId: id, elapsedMs: 15 }),
      ),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private fixture");
  });
  it("denies remote observation before accessing the database", async () => {
    const response = await observation(
      new Request("https://example.test/api/recall/observation", {
        method: "POST",
        body: JSON.stringify({ queryId: id, elapsedMs: 15 }),
      }),
    );
    expect(response.status).toBe(404);
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});
