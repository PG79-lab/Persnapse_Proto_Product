// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../../../server/env", () => ({
  getServerEnv: () => ({ OPENAI_API_KEY: "permanent-server-secret" }),
}));
import { POST } from "./route";
afterEach(() => vi.unstubAllGlobals());
const request = (origin = "http://localhost") =>
  new Request("http://localhost/api/stt/realtime-session", {
    method: "POST",
    headers: {
      Origin: origin,
      "X-Persnapse-STT": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ language: "ko-en", hints: "Persnapse" }),
  });
describe("ephemeral live transcription credentials", () => {
  it("returns only a short-lived token configured for live transcription", async () => {
    const provider = vi
      .fn()
      .mockResolvedValue(
        Response.json({ value: "ephemeral-token", expires_at: 100 }),
      );
    vi.stubGlobal("fetch", provider);
    const response = await POST(request());
    const result = await response.json();
    expect(result).toEqual({
      token: "ephemeral-token",
      expiresAt: 100,
      model: "gpt-live-transcribe",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    const config = JSON.parse(provider.mock.calls[0][1].body);
    expect(config.session.audio.input.format.rate).toBe(24000);
    expect(config.session.audio.input.turn_detection).toBeNull();
    expect(config.session.audio.input.transcription.languages).toEqual([
      "ko",
      "en",
    ]);
    expect(config.expires_after.seconds).toBe(60);
  });
  it("rejects other origins before issuing credentials", async () => {
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    expect((await POST(request("https://elsewhere.example"))).status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });
  it("does not expose provider error details or permanent keys", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("permanent-server-secret", { status: 401 }),
        ),
    );
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("permanent-server-secret");
  });
});
