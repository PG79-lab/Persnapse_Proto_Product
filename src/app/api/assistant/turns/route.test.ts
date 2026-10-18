import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), access: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../../../server/application/assistant-service", () => ({
  executeAssistantTurn: mocks.execute,
}));
vi.mock("../../../../server/env", () => ({
  getServerEnv: () => ({ APP_DEFAULT_WORKSPACE_ID: "w" }),
}));
vi.mock("../../../../server/security/prototype-access", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../server/security/prototype-access")
  >("../../../../server/security/prototype-access");
  return { ...actual, assertPrototypeAccess: mocks.access };
});
import { POST } from "./route";
import { AssistantError } from "../../../../domain/assistant/contracts";
const input = {
  sessionId: "60000000-0000-4000-8000-000000000001",
  requestId: "70000000-0000-4000-8000-000000000001",
  expectedVersion: 0,
  message: "민수 진행 상황",
};
const request = (body: unknown) =>
  new Request("http://localhost/api/assistant/turns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => vi.resetAllMocks());
describe("assistant turn API", () => {
  it("keeps resolved status separate from HTTP processing", async () => {
    mocks.execute.mockResolvedValue({
      schemaVersion: "assistant-v1",
      status: "resolved",
    });
    expect((await POST(request(input))).status).toBe(200);
    expect(mocks.access).toHaveBeenCalledOnce();
    mocks.execute.mockResolvedValue({ status: "processing", turnId: "t" });
    expect((await POST(request(input))).status).toBe(202);
  });
  it("validates input before starting model work", async () => {
    expect(
      (await POST(request({ ...input, workspaceId: "foreign" }))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({ ...input, contextSelection: { personIds: ["invented"] } }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("returns no-store conflicts for another active turn", async () => {
    mocks.execute.mockRejectedValue(
      new AssistantError("SESSION_BUSY", "진행 중"),
    );
    const response = await POST(request(input));
    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});
