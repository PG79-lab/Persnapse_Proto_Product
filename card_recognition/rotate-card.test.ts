import { afterEach, describe, expect, it, vi } from "vitest";
import { rotateCardImage } from "./rotate-card";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("rotateCardImage", () => {
  function setup() {
    const bitmap = { width: 600, height: 300, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    const context = { translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["JPEG"], { type: "image/jpeg" })),
    );
    return { bitmap, context };
  }

  it.each([90, 180, 270] as const)(
    "encodes %i degrees with correct dimensions and closes bitmap",
    async (angle) => {
      const { bitmap, context } = setup();
      const result = await rotateCardImage(
        new File(["source"], "base.jpg"),
        angle,
        new AbortController().signal,
      );
      expect([result.width, result.height]).toEqual(
        angle === 180 ? [600, 300] : [300, 600],
      );
      expect(context.rotate).toHaveBeenCalledWith((angle * Math.PI) / 180);
      expect(context.drawImage).toHaveBeenCalledWith(bitmap, -300, -150);
      expect(result.file.type).toBe("image/jpeg");
      expect(bitmap.close).toHaveBeenCalledOnce();
    },
  );

  it("returns original bytes at 0 degrees to prevent cumulative recompression", async () => {
    const { bitmap } = setup();
    const original = new File(["original"], "base.jpg");
    expect(
      (await rotateCardImage(original, 0, new AbortController().signal)).file,
    ).toBe(original);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("does not decode an already cancelled operation", async () => {
    setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      rotateCardImage(new File([], "base.jpg"), 90, controller.signal),
    ).rejects.toThrow();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("keeps failure explicit and releases the bitmap when encoding fails", async () => {
    const { bitmap } = setup();
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(null),
    );
    await expect(
      rotateCardImage(
        new File([], "base.jpg"),
        90,
        new AbortController().signal,
      ),
    ).rejects.toThrow("명함 회전");
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
