import { afterEach, expect, it, vi } from "vitest";
import { graphPreviewEnabled, graphPreviewResponse } from "./frontend-graph";
afterEach(() => vi.unstubAllEnvs());
it("requires explicit local opt-in and never enables on Vercel", () => {
  vi.stubEnv("PERSNAPSE_GRAPH_PREVIEW", "1");
  vi.stubEnv("VERCEL", "");
  expect(graphPreviewEnabled()).toBe(true);
  vi.stubEnv("VERCEL", "1");
  expect(graphPreviewEnabled()).toBe(false);
});
it("terminates unsupported reads and every write before they reach real providers", async () => {
  for (const [path, method] of [
    ["/api/workspace", "POST"],
    ["/api/captures", "POST"],
    ["/api/stt/realtime-session", "POST"],
    ["/api/unknown", "GET"],
  ]) {
    const response = graphPreviewResponse(
      new Request(`http://127.0.0.1${path}`, { method }),
    );
    expect(response.status).toBe(501);
    expect((await response.json()).code).toBe("PREVIEW_OPERATION_UNAVAILABLE");
  }
  const response = graphPreviewResponse(
    new Request("http://127.0.0.1/api/workspace"),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).capabilities.preview).toBe("FG-FIXTURE-01");
});
