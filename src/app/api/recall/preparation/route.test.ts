import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ inspect: vi.fn(), prepare: vi.fn() }));
vi.mock("../../../../server/env", () => ({
  getServerEnv: () => ({ APP_DEFAULT_WORKSPACE_ID: "server-workspace" }),
}));
vi.mock("../../../../server/application/search-preparation-service", () => ({
  inspectSearchPreparation: mocks.inspect,
  prepareSearch: mocks.prepare,
}));
import { GET, POST } from "./route";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_REMOTE_PROTOTYPE_ACCESS", "off");
});
it("GET exposes only preparation state and never submits billable work", async () => {
  mocks.inspect.mockResolvedValue({
    mode: "live",
    ready: false,
    total: 2,
    remaining: 1,
  });
  const response = await GET(
    new Request("http://localhost/api/recall/preparation"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.inspect).toHaveBeenCalledWith("server-workspace");
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("POST cannot select a different client's workspace", async () => {
  mocks.prepare.mockResolvedValue({ attemptedCount: 0 });
  const response = await POST(
    new Request("http://localhost/api/recall/preparation", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: "other-workspace",
        personId: "other-person",
      }),
    }),
  );
  expect(response.status).toBe(200);
  expect(mocks.prepare).toHaveBeenCalledWith("server-workspace");
});
it("a disallowed remote request does not read or mutate the workspace", async () => {
  expect(
    (await GET(new Request("https://example.test/api/recall/preparation")))
      .status,
  ).toBe(404);
  expect(
    (
      await POST(
        new Request("https://example.test/api/recall/preparation", {
          method: "POST",
        }),
      )
    ).status,
  ).toBe(404);
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("database failure returns a recoverable response without leaking connection details", async () => {
  mocks.inspect.mockRejectedValue(
    new Error("postgres://sensitive-password@example.test"),
  );
  const response = await GET(
    new Request("http://localhost/api/recall/preparation"),
  );
  expect(response.status).toBe(503);
  const payload = await response.json();
  expect(payload.code).toBe("SEARCH_PREPARATION_UNAVAILABLE");
  expect(JSON.stringify(payload)).not.toContain("sensitive-password");
});
