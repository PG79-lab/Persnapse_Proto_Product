import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeTranscription } from "./realtime-transcription";
class Socket {
  static OPEN = 1;
  static latest: Socket;
  readyState = 1;
  bufferedAmount = 0;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor() {
    Socket.latest = this;
    queueMicrotask(() => this.event({ type: "session.created" }));
  }
  event(value: object) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function setup() {
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: "ephemeral-test" }),
    }),
  );
  const progress = vi.fn(),
    error = vi.fn();
  const live = await RealtimeTranscription.connect(
    "ko",
    "",
    progress,
    error,
    new AbortController().signal,
  );
  return { live, socket: Socket.latest, progress, error };
}
describe("live transcription lifecycle", () => {
  it("shows deltas before commit and replaces draft text with the final transcript", async () => {
    const { live, socket, progress } = await setup();
    live.append(new Int16Array(2400));
    socket.event({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "one",
      delta: "임시",
    });
    expect(progress).toHaveBeenLastCalledWith({
      text: "임시",
      finalized: false,
    });
    expect(
      socket.send.mock.calls.map(([value]) => JSON.parse(value).type),
    ).toEqual(["input_audio_buffer.append"]);
    const final = live.finish();
    socket.event({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "one",
      transcript: "확정된 문장",
    });
    await expect(final).resolves.toBe("확정된 문장");
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it("does not treat partial text as final when the connection fails", async () => {
    const { live, socket } = await setup();
    live.append(new Int16Array(2400));
    socket.event({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "one",
      delta: "부분 결과",
    });
    socket.onerror?.();
    await expect(live.finish()).rejects.toThrow("연결이 끊겼습니다");
  });
  it("cancellation settles a pending finalization and ignores late results", async () => {
    const { live, socket, progress } = await setup();
    live.append(new Int16Array(2400));
    const final = live.finish();
    live.close();
    await expect(final).rejects.toThrow("종료됐습니다");
    socket.event({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "one",
      transcript: "늦은 결과",
    });
    expect(progress).not.toHaveBeenCalled();
  });
  it("does not commit less than 100ms of audio", async () => {
    const { live, socket } = await setup();
    live.append(new Int16Array(100));
    await expect(live.finish()).resolves.toBe("");
    expect(socket.send).toHaveBeenCalledOnce();
  });
});
