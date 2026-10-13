import { afterEach, describe, expect, it, vi } from "vitest";
import { PcmRecorder, pcmWavHeader } from "./pcm-recorder";
afterEach(() => vi.unstubAllGlobals());

describe("PCM recording finalization", () => {
  it("builds WAV sizes from actual frames rather than the elapsed timer", () => {
    const view = new DataView(pcmWavHeader(112000, 16000));
    expect(view.getUint32(40, true)).toBe(224000);
    expect(view.getUint32(4, true)).toBe(224036);
    expect(view.getUint32(24, true)).toBe(16000);
  });
  it("waits for the worklet's final packet before emitting a complete WAV", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: vi.fn(),
      close: vi.fn(),
    };
    const connect = vi.fn(),
      disconnect = vi.fn();
    vi.stubGlobal(
      "AudioContext",
      class {
        sampleRate = 16000;
        audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
        destination = {};
        close = close;
        resume = vi.fn().mockResolvedValue(undefined);
        createMediaStreamSource() {
          return { connect, disconnect };
        }
        createGain() {
          return { gain: { value: 1 }, connect, disconnect };
        }
      },
    );
    vi.stubGlobal(
      "AudioWorkletNode",
      class {
        port = port;
        connect = connect;
        disconnect = disconnect;
      },
    );
    const recorder = await PcmRecorder.create({} as MediaStream);
    const data = vi.fn(),
      stopped = vi.fn();
    recorder.ondataavailable = data;
    recorder.onstop = stopped;
    recorder.start();
    recorder.stop();
    expect(data).not.toHaveBeenCalled();
    port.onmessage?.({
      data: { type: "samples", samples: new Int16Array([1, -1, 0]) },
    });
    port.onmessage?.({ data: { type: "stopped" } });
    expect(data.mock.calls[0][0].data.size).toBe(50);
    expect(data.mock.calls[0][0].data.type).toBe("audio/wav");
    expect(recorder.duration).toBe(3 / 16000);
    expect(stopped).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
  it("does not emit a header-only recording with zero captured samples", async () => {
    const port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: vi.fn(),
      close: vi.fn(),
    };
    vi.stubGlobal(
      "AudioContext",
      class {
        sampleRate = 16000;
        audioWorklet = { addModule: async () => {} };
        destination = {};
        close = async () => {};
        resume = async () => {};
        createMediaStreamSource() {
          return { connect() {}, disconnect() {} };
        }
        createGain() {
          return { gain: { value: 1 }, connect() {}, disconnect() {} };
        }
      },
    );
    vi.stubGlobal(
      "AudioWorkletNode",
      class {
        port = port;
        connect() {}
        disconnect() {}
      },
    );
    const recorder = await PcmRecorder.create({} as MediaStream);
    const data = vi.fn();
    recorder.ondataavailable = data;
    recorder.start();
    recorder.stop();
    port.onmessage?.({ data: { type: "stopped" } });
    expect(data).not.toHaveBeenCalled();
  });
});
