import { afterEach, describe, expect, it, vi } from "vitest";

import { captureBusinessCardFrame } from "./card-image-processing";

afterEach(() => vi.restoreAllMocks());

describe("business card camera fallback", () => {
  it("captures the full camera frame even when the preview has another aspect ratio", async () => {
    const video = document.createElement("video");
    Object.defineProperties(video, {
      videoWidth: { value: 1600 },
      videoHeight: { value: 1200 },
      clientWidth: { value: 960 },
      clientHeight: { value: 540 },
    });
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["photo"], { type: "image/jpeg" })),
    );

    const photo = await captureBusinessCardFrame(video);

    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1600, 1200);
    expect(photo.type).toBe("image/jpeg");
    expect(photo.size).toBeGreaterThan(0);
  });

  it("refuses to capture before the camera frame is ready", async () => {
    await expect(
      captureBusinessCardFrame(document.createElement("video")),
    ).rejects.toThrow("카메라 화면이 준비되지 않았습니다.");
  });
});
