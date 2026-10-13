import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingTranscription } from "./recording-transcription";
const prepared = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock("./prepare-recording", () => ({ prepareRecording: prepared.decode }));
const blob = new Blob(["audio"]);
const props = {
  blob,
  fallbackUrl: "blob:original",
  audioRef: null,
  disabled: false,
  availableCharacters: 2000,
  onApply: vi.fn(),
  onDuration: vi.fn(),
};
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  prepared.decode.mockResolvedValue(new Blob(["wav"], { type: "audio/wav" }));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:wav");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  request = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ text: "인식 결과" }) });
  vi.stubGlobal("fetch", request);
  props.onApply.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function convert() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "텍스트로 변환" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "텍스트로 변환" }));
}
describe("recording page transcription", () => {
  it("uses a playable WAV and reviews the transcript before applying", async () => {
    render(<RecordingTranscription {...props} />);
    await convert();
    expect(screen.getByLabelText("녹음 재생")).toHaveAttribute(
      "src",
      "blob:wav",
    );
    const result = await screen.findByLabelText("녹음 인식 결과");
    expect(props.onApply).not.toHaveBeenCalled();
    fireEvent.change(result, { target: { value: "수정한 결과" } });
    fireEvent.click(
      screen.getByRole("button", { name: "확인하고 메모에 추가" }),
    );
    expect(props.onApply).toHaveBeenCalledWith("수정한 결과");
    expect(request.mock.calls[0][1].body.get("audio").name).toBe("speech.wav");
  });
  it("retains playable audio and allows retry after provider failure", async () => {
    request.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "서버 오류" }),
    });
    render(<RecordingTranscription {...props} />);
    await convert();
    await screen.findByText("서버 오류");
    expect(screen.getByLabelText("녹음 재생")).toHaveAttribute(
      "src",
      "blob:wav",
    );
    await convert();
    await screen.findByLabelText("녹음 인식 결과");
  });
  it("discards a late response after cancelling or selecting another clip", async () => {
    let resolve!: (value: unknown) => void;
    request.mockReturnValueOnce(
      new Promise((value) => {
        resolve = value;
      }),
    );
    const { unmount } = render(<RecordingTranscription {...props} />);
    await convert();
    fireEvent.click(screen.getByRole("button", { name: "변환 취소" }));
    await act(async () =>
      resolve({ ok: true, json: async () => ({ text: "늦은 결과" }) }),
    );
    expect(screen.queryByLabelText("녹음 인식 결과")).not.toBeInTheDocument();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:wav");
  });
});
