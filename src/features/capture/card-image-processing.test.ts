import { describe, expect, it } from "vitest";

import { businessCardCaptureGeometry } from "./card-image-processing";

describe("business card camera guide", () => {
  it("matches the captured pixels on a 16:9 camera", () => {
    const crop = businessCardCaptureGeometry(1920, 1080, 960, 540);

    expect(crop.guideWidthPercent).toBeCloseTo(73.18, 1);
    expect(crop.guideHeightPercent).toBeCloseTo(82, 5);
    expect(crop.guideLeftPercent).toBeCloseTo((crop.sourceX / 1920) * 100, 5);
    expect(crop.guideTopPercent).toBeCloseTo((crop.sourceY / 1080) * 100, 5);
  });

  it("maps object-cover cropping when the camera is 4:3", () => {
    const crop = businessCardCaptureGeometry(1600, 1200, 960, 540);
    const scale = Math.max(960 / 1600, 540 / 1200);
    const offsetX = (960 - 1600 * scale) / 2;
    const offsetY = (540 - 1200 * scale) / 2;

    expect(crop.guideLeftPercent).toBeCloseTo(
      ((crop.sourceX * scale + offsetX) / 960) * 100,
      5,
    );
    expect(crop.guideTopPercent).toBeCloseTo(
      ((crop.sourceY * scale + offsetY) / 540) * 100,
      5,
    );
    expect(crop.sourceX).toBeGreaterThanOrEqual(0);
    expect(crop.sourceY).toBeGreaterThanOrEqual(0);
  });
});
