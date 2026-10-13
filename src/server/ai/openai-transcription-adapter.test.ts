// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { transcribeAudio } from "./openai-transcription-adapter";

afterEach(() => vi.unstubAllGlobals());
const input = {
  audio: new File(["audio"], "speech.webm", { type: "audio/webm" }),
  apiKey: "test-secret",
  model: "gpt-transcribe",
  language: "ko-en" as const,
  keywords: ["Persnapse", "김민준"],
};
describe("OpenAI transcription", () => {
  it("sends language arrays and exact keywords without singular language", async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(Response.json({ text: " 안녕하세요. " }));
    vi.stubGlobal("fetch", mock);
    expect(await transcribeAudio(input)).toEqual({
      text: "안녕하세요.",
      model: "gpt-transcribe",
      provider: "openai",
    });
    const [url, options] = mock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(options.headers.Authorization).toBe("Bearer test-secret");
    expect(options.body.getAll("languages[]")).toEqual(["ko", "en"]);
    expect(options.body.get("language")).toBeNull();
    expect(options.body.getAll("keywords[]")).toEqual(input.keywords);
    expect(options.body.get("file").name).toBe("speech.webm");
  });
  it("omits language hints for auto detection", async () => {
    const mock = vi.fn().mockResolvedValue(Response.json({ text: "hello" }));
    vi.stubGlobal("fetch", mock);
    await transcribeAudio({ ...input, language: "auto" });
    expect(mock.mock.calls[0][1].body.getAll("languages[]")).toEqual([]);
  });
  it("does not expose provider error bodies or keys", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("test-secret provider details", { status: 401 }),
        ),
    );
    await expect(transcribeAudio(input)).rejects.toMatchObject({
      status: 502,
      code: "STT_PROVIDER_FAILED",
    });
  });
  it("rejects empty/invalid responses and unsupported model settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ text: " " })),
    );
    await expect(transcribeAudio(input)).rejects.toMatchObject({
      code: "STT_EMPTY_TRANSCRIPT",
    });
    await expect(
      transcribeAudio({ ...input, model: "unexpected" }),
    ).rejects.toMatchObject({ code: "STT_MODEL_UNSUPPORTED" });
  });
});
