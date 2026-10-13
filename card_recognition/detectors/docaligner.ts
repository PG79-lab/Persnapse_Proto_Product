import type { CV } from "@techstark/opencv-js";
import type { CardPoint } from "../geometry";

export function docalignerInput(
  cv: CV,
  rgba: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 8_000_000 ||
    rgba.length !== width * height * 4
  )
    throw new Error("Invalid detector image buffer");
  const source = cv.matFromArray(height, width, cv.CV_8UC4, rgba);
  const bgr = new cv.Mat(),
    small = new cv.Mat();
  try {
    cv.cvtColor(source, bgr, cv.COLOR_RGBA2BGR);
    cv.resize(bgr, small, new cv.Size(256, 256), 0, 0, cv.INTER_LINEAR);
    const output = new Float32Array(3 * 256 * 256);
    for (let i = 0; i < 256 * 256; i++)
      for (let c = 0; c < 3; c++)
        output[c * 256 * 256 + i] = small.data[i * 3 + c] / 255;
    return output;
  } finally {
    small.delete();
    bgr.delete();
    source.delete();
  }
}

/** Official threshold → full-size resize → uint8 → Otsu → largest contour centroid.
 * This is a reference adapter, not a business-card presence classifier. */
export function docalignerCorners(
  cv: CV,
  heatmap: Float32Array,
  dims: readonly number[],
  width: number,
  height: number,
): CardPoint[] {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    dims.length !== 4 ||
    dims[0] !== 1 ||
    dims[1] !== 4 ||
    heatmap.length !== 4 * dims[2] * dims[3] ||
    width * height > 8_000_000
  )
    throw new Error("Invalid detector heatmap");
  const points: CardPoint[] = [];
  const plane = dims[2] * dims[3];
  for (let channel = 0; channel < 4; channel++) {
    const input = cv.matFromArray(
      dims[2],
      dims[3],
      cv.CV_32FC1,
      heatmap.subarray(channel * plane, (channel + 1) * plane),
    );
    const resized = new cv.Mat(),
      mask = new cv.Mat(height, width, cv.CV_8UC1),
      binary = new cv.Mat(),
      contours = new cv.MatVector(),
      hierarchy = new cv.Mat();
    try {
      cv.resize(
        input,
        resized,
        new cv.Size(width, height),
        0,
        0,
        cv.INTER_LINEAR,
      );
      for (let i = 0; i < width * height; i++)
        mask.data[i] =
          resized.data32F[i] < 0.3 ? 0 : Math.trunc(resized.data32F[i] * 255);
      cv.threshold(mask, binary, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
      cv.findContours(
        binary,
        contours,
        hierarchy,
        cv.RETR_EXTERNAL,
        cv.CHAIN_APPROX_SIMPLE,
      );
      let largest = -1;
      let centers: CardPoint[] = [];
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        try {
          if (contour.rows < 3) continue;
          const area = cv.contourArea(contour);
          if (area < largest) continue;
          const moments = cv.moments(contour);
          const point = {
            x: moments.m10 / (moments.m00 + 1e-5),
            y: moments.m01 / (moments.m00 + 1e-5),
          };
          if (area > largest) centers = [];
          largest = area;
          centers.push(point);
        } finally {
          contour.delete();
        }
      }
      if (centers.length === 1) points.push(centers[0]);
    } finally {
      hierarchy.delete();
      contours.delete();
      binary.delete();
      mask.delete();
      resized.delete();
      input.delete();
    }
  }
  return points;
}
