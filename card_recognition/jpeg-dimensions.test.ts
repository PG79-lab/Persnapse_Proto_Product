import { describe, expect, it } from "vitest";

import { jpegDimensions } from "./jpeg-dimensions";

describe("restored JPEG validation", () => {
  it("reads dimensions from a JPEG frame header", () => {
    const bytes = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x03, 0x20,
      0x04, 0xb0, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9,
    ]);
    expect(jpegDimensions(bytes)).toEqual({ width: 1200, height: 800 });
  });

  it("rejects content without a valid frame", () => {
    expect(
      jpegDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])),
    ).toBeNull();
    expect(jpegDimensions(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
});
