import type { CardCorners, CardPoint } from "./geometry";

export function polygonArea(points: readonly CardPoint[]): number {
  return (
    Math.abs(
      points.reduce((sum, point, i) => {
        const next = points[(i + 1) % points.length];
        return sum + point.x * next.y - next.x * point.y;
      }, 0),
    ) / 2
  );
}

const cross = (a: CardPoint, b: CardPoint, p: CardPoint) =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

// Image coordinates have a downward y axis: positive area is clockwise.
// Do not sort predictions: reversed/crossed order must remain an error.
export function isClockwiseConvex(points: readonly CardPoint[]): boolean {
  return (
    points.length === 4 &&
    points.every(
      (point, i) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        cross(point, points[(i + 1) % 4], points[(i + 2) % 4]) > 1e-9,
    )
  );
}

export function polygonIntersection(
  subject: readonly CardPoint[],
  clip: readonly CardPoint[],
): CardPoint[] {
  let output = [...subject];
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i],
      b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j],
        q = input[(j + 1) % input.length];
      const cp = cross(a, b, p),
        cq = cross(a, b, q);
      if (cp >= 0) output.push(p);
      if (cp >= 0 !== cq >= 0) {
        const t = cp / (cp - cq);
        output.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
      }
    }
  }
  return output;
}

export function boundaryMetrics(
  predicted: CardCorners | null,
  truth: CardCorners,
) {
  if (!predicted || !isClockwiseConvex(predicted))
    return {
      valid: false,
      meanErrorPercent: null,
      maxErrorPercent: null,
      iou: 0,
      success: false,
    };
  const diagonal = Math.max(
    Math.hypot(truth[0].x - truth[2].x, truth[0].y - truth[2].y),
    Math.hypot(truth[1].x - truth[3].x, truth[1].y - truth[3].y),
  );
  if (!isClockwiseConvex(truth) || diagonal <= 0)
    throw new Error("Invalid ground truth");
  const errors = Array.from({ length: 4 }, (_, shift) =>
    truth.map((point, i) => {
      const prediction = predicted[(i + shift) % 4];
      return (
        (100 * Math.hypot(point.x - prediction.x, point.y - prediction.y)) /
        diagonal
      );
    }),
  ).sort(
    (a, b) => a.reduce((s, v) => s + v, 0) - b.reduce((s, v) => s + v, 0),
  )[0];
  const intersection = polygonArea(polygonIntersection(predicted, truth));
  const iou =
    intersection / (polygonArea(predicted) + polygonArea(truth) - intersection);
  const meanErrorPercent = errors.reduce((s, v) => s + v, 0) / 4;
  const maxErrorPercent = Math.max(...errors);
  return {
    valid: true,
    meanErrorPercent,
    maxErrorPercent,
    iou,
    success: iou >= 0.985 && maxErrorPercent <= 1.5,
  };
}

export function contentPreservation(
  region: readonly CardPoint[],
  predicted: CardCorners | null,
): number {
  if (!predicted || !isClockwiseConvex(predicted)) return 0;
  const area = polygonArea(region);
  if (area <= 0) throw new Error("Invalid printed region");
  return Math.min(
    1,
    polygonArea(polygonIntersection(region, predicted)) / area,
  );
}

export function percentile(
  values: readonly number[],
  q: number,
): number | null {
  if (!values.length) return null;
  if (q <= 0 || q > 1 || values.some((v) => !Number.isFinite(v)))
    throw new Error("Invalid percentile input");
  return [...values].sort((a, b) => a - b)[Math.ceil(q * values.length) - 1];
}

export function zeroErrorUpperBound(independentSamples: number): number {
  if (!Number.isInteger(independentSamples) || independentSamples <= 0)
    throw new Error("Invalid sample count");
  return 1 - 0.05 ** (1 / independentSamples);
}
