// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const config = vi.hoisted(() => ({
  OPENAI_API_KEY: "test-secret",
  OPENAI_TRANSCRIPTION_MODEL: "gpt-transcribe",
}));
vi.mock("../../../../server/env", () => ({ getServerEnv: () => config }));
import { GET, POST } from "./route";

function request(form?: FormData, extraHeaders = {}) {
  const body = form ?? new FormData();
  if (!form) body.set("audio", new File(["audio"], "speech.webm"));
  return new Request("http://localhost/api/stt/transcribe", {
    method: "POST",
    headers: { "X-Persnapse-STT": "1", ...extraHeaders },
    body,
  });
}
beforeEach(() => {
  config.OPENAI_API_KEY = "test-secret";
});
afterEach(() => vi.unstubAllGlobals());
describe("STT endpoint", () => {
  it("accepts matching browser Host/Origin forwarded to a different backend port", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ text: "전사 결과" })),
    );
    const form = new FormData();
    form.set("audio", new File(["audio"], "speech.webm"));
    const upload = new Request("http://localhost:3201/api/stt/transcribe", {
      method: "POST",
      body: form,
      headers: {
        Host: "127.0.0.1:3200",
        Origin: "http://127.0.0.1:3200",
        "X-Persnapse-STT": "1",
      },
    });
    expect((await POST(upload)).status).toBe(200);
  });
  it("reports configuration without exposing the key or calling OpenAI", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const response = await GET(
      new Request("http://localhost/api/stt/transcribe"),
    );
    expect(await response.json()).toEqual({
      configured: true,
      model: "gpt-transcribe",
    });
    expect(mock).not.toHaveBeenCalled();
  });
  it("transcribes a valid upload without persisting audio", async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(Response.json({ text: "김민준과 만났습니다." }));
    vi.stubGlobal("fetch", mock);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      text: "김민준과 만났습니다.",
      provider: "openai",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects cross-origin and unmarked requests before provider calls", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    expect(
      (await POST(request(undefined, { Origin: "https://another.example" })))
        .status,
    ).toBe(403);
    expect(
      (await POST(request(undefined, { "X-Persnapse-STT": "" }))).status,
    ).toBe(403);
    expect(mock).not.toHaveBeenCalled();
  });
  it("rejects missing keys and unsupported files", async () => {
    config.OPENAI_API_KEY = "";
    expect((await POST(request())).status).toBe(503);
    config.OPENAI_API_KEY = "test-secret";
    const body = new FormData();
    body.set("audio", new File(["bad"], "speech.ogg"));
    expect((await POST(request(body))).status).toBe(400);
  });
  it("limits body bytes even without Content-Length", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4_000_001));
        controller.close();
      },
    });
    const upload = new Request("http://localhost/api/stt/transcribe", {
      method: "POST",
      headers: {
        "X-Persnapse-STT": "1",
        "Content-Type": "multipart/form-data; boundary=test",
      },
      body,
      duplex: "half",
    } as RequestInit);
    const response = await POST(upload);
    expect(response.status).toBe(413);
  });
  it("rejects malformed keyword hints", async () => {
    const body = new FormData();
    body.set("audio", new File(["audio"], "speech.webm"));
    body.set("hints", "<bad>");
    expect((await POST(request(body))).status).toBe(400);
  });
});
