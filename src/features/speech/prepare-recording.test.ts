import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeMonoWav, prepareRecording } from "./prepare-recording";

afterEach(() => vi.unstubAllGlobals());
describe("recorded audio preparation", () => {
  it("writes a complete mono PCM WAV header and clips PCM samples", () => {
    const buffer = encodeMonoWav(new Float32Array([-2, -0.5, 0, 0.5, 2]));
    const view = new DataView(buffer);
    expect(String.fromCharCode(...new Uint8Array(buffer).slice(0, 4))).toBe(
      "RIFF",
    );
    expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(10);
    expect([0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true))).toEqual(
      [-32768, -16384, 0, 16384, 32767],
    );
  });
  it("rejects oversized audio before decoding", async () => {
    await expect(
      prepareRecording(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)])),
    ).rejects.toThrow("10MB");
  });
  it("prepares 100 seconds within the transcription upload limit", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "AudioContext",
      class {
        close = close;
        decodeAudioData = async () => ({ length: 24000 * 100, duration: 100 });
      },
    );
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        destination = {};
        constructor(channels: number, length: number, rate: number) {
          expect([channels, length, rate]).toEqual([1, 1600000, 16000]);
        }
        createBufferSource() {
          return { buffer: null, connect() {}, start() {} };
        }
        async startRendering() {
          return { getChannelData: () => new Float32Array(1600000) };
        }
      },
    );
    const result = await prepareRecording({
      size: 4800044,
      arrayBuffer: async () => new ArrayBuffer(4),
    } as Blob);
    expect(result.size).toBe(3200044);
    expect(result.size).toBeLessThan(3900000);
    expect(close).toHaveBeenCalledOnce();
  });
  it("closes the decoder when the audio is too long or undecodable", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const decode = vi
      .fn()
      .mockResolvedValue({ length: 48000 * 101, duration: 101 });
    vi.stubGlobal(
      "AudioContext",
      class {
        close = close;
        decodeAudioData = decode;
      },
    );
    const blob = {
      size: 4,
      arrayBuffer: async () => new ArrayBuffer(4),
    } as Blob;
    await expect(prepareRecording(blob)).rejects.toThrow("100초");
    expect(close).toHaveBeenCalledOnce();
    decode.mockRejectedValueOnce(new Error("decode failed"));
    await expect(prepareRecording(blob)).rejects.toThrow(
      "음성 데이터를 읽을 수 없습니다",
    );
    expect(close).toHaveBeenCalledTimes(2);
  });
});
