import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceInput } from "./voice-input";
vi.mock("./pcm-recorder", () => ({
  PcmRecorder: { create: async () => new Recorder() },
}));

class Recorder {
  static isTypeSupported = () => true;
  static latest: Recorder;
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    Recorder.latest = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"]) });
    this.onstop?.();
  }
  dispose() {}
}
let stopTrack: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stopTrack = vi.fn();
  vi.stubGlobal("AudioWorkletNode", class {});
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi
        .fn()
        .mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }),
    },
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ configured: true }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function begin() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "녹음 시작" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "녹음 시작" }));
  await screen.findByRole("button", { name: "녹음 끝내고 변환" });
}
describe("short voice input", () => {
  it("reviews and edits the result before explicitly applying it", async () => {
    const apply = vi.fn();
    render(<VoiceInput onApply={apply} />);
    await begin();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: "김민준과 만났다." }),
    });
    fireEvent.click(screen.getByRole("button", { name: "녹음 끝내고 변환" }));
    const review = await screen.findByLabelText("인식 결과 · 수정 가능");
    expect(apply).not.toHaveBeenCalled();
    fireEvent.change(review, { target: { value: "김민준과 오늘 만났다." } });
    fireEvent.click(
      screen.getByRole("button", { name: "확인하고 입력에 추가" }),
    );
    expect(apply).toHaveBeenCalledWith("김민준과 오늘 만났다.");
    expect(stopTrack).toHaveBeenCalled();
  });
  it("discards a delayed response after cancellation", async () => {
    render(<VoiceInput onApply={vi.fn()} />);
    await begin();
    let resolve!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(
      new Promise((value) => {
        resolve = value;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "녹음 끝내고 변환" }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await act(async () =>
      resolve({ ok: true, json: async () => ({ text: "늦은 결과" }) }),
    );
    expect(
      screen.queryByLabelText("인식 결과 · 수정 가능"),
    ).not.toBeInTheDocument();
  });
  it("releases microphone permission granted after cancellation", async () => {
    let resolve!: (value: unknown) => void;
    navigator.mediaDevices.getUserMedia = vi.fn().mockReturnValue(
      new Promise((value) => {
        resolve = value;
      }),
    );
    render(<VoiceInput onApply={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "녹음 시작" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "녹음 시작" }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await act(async () => resolve({ getTracks: () => [{ stop: stopTrack }] }));
    expect(stopTrack).toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "녹음 끝내고 변환" }),
    ).not.toBeInTheDocument();
  });
  it("keeps oversized text for review instead of silently truncating", async () => {
    const apply = vi.fn();
    render(<VoiceInput onApply={apply} availableCharacters={3} />);
    await begin();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: "긴 인식 결과입니다." }),
    });
    fireEvent.click(screen.getByRole("button", { name: "녹음 끝내고 변환" }));
    await screen.findByLabelText("인식 결과 · 수정 가능");
    expect(
      screen.getByRole("button", { name: "확인하고 입력에 추가" }),
    ).toBeDisabled();
    expect(apply).not.toHaveBeenCalled();
  });
});
