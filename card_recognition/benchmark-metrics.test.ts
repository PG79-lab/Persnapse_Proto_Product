import { describe, expect, it } from "vitest";
import {
  boundaryMetrics,
  contentPreservation,
  percentile,
  zeroErrorUpperBound,
} from "./benchmark-metrics";
import type { CardCorners } from "./geometry";

const square: CardCorners = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];
describe("benchmark definitions from independent analytical answers", () => {
  it("reports exact and cyclically shifted predictions as exact", () => {
    const shifted: CardCorners = [square[2], square[3], square[0], square[1]];
    expect(boundaryMetrics(shifted, square)).toMatchObject({
      meanErrorPercent: 0,
      maxErrorPercent: 0,
      iou: 1,
      success: true,
    });
    expect(contentPreservation(square, square)).toBe(1);
  });
  it("computes a known 10px translation and rectangular intersection", () => {
    const moved = square.map((p) => ({ x: p.x + 10, y: p.y })) as CardCorners;
    const result = boundaryMetrics(moved, square);
    expect(result.meanErrorPercent).toBeCloseTo(1000 / Math.sqrt(20000), 10);
    expect(result.maxErrorPercent).toBeCloseTo(result.meanErrorPercent!, 10);
    expect(result.iou).toBeCloseTo(9000 / 11000, 10);
    expect(contentPreservation(square, moved)).toBeCloseTo(0.9, 10);
  });
  it("keeps absent, reversed and crossed predictions in the failure denominator", () => {
    for (const points of [
      null,
      [square[0], square[3], square[2], square[1]],
      [square[0], square[2], square[1], square[3]],
    ] as (CardCorners | null)[])
      expect(boundaryMetrics(points, square)).toMatchObject({
        valid: false,
        iou: 0,
        success: false,
        meanErrorPercent: null,
      });
  });
  it("uses nearest rank and independent-sample zero error confidence limit", () => {
    expect(percentile([5, 1, 4, 2, 3], 0.95)).toBe(5);
    expect(percentile([], 0.95)).toBeNull();
    expect(zeroErrorUpperBound(20)).toBeCloseTo(0.13910834, 7);
    expect(zeroErrorUpperBound(300)).toBeCloseTo(0.00993608, 7);
  });
});
