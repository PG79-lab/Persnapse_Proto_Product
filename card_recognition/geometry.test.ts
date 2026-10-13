import { describe, expect, it } from "vitest";

import { orderCardCorners, rectifiedCardSize } from "./geometry";

describe("card geometry", () => {
  it("orders a tilted card clockwise from the top left", () => {
    const corners = orderCardCorners([
      { x: 970, y: 620 },
      { x: 185, y: 110 },
      { x: 125, y: 580 },
      { x: 900, y: 70 },
    ]);
    expect(corners).toEqual([
      { x: 185, y: 110 },
      { x: 900, y: 70 },
      { x: 970, y: 620 },
      { x: 125, y: 580 },
    ]);
    expect(corners && rectifiedCardSize(corners)).toEqual({
      width: 846,
      height: 554,
    });
  });

  it("rejects degenerate inputs instead of warping uncertain text", () => {
    expect(orderCardCorners([{ x: 0, y: 0 }])).toBeNull();
    expect(
      rectifiedCardSize([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 0, y: 10 },
      ]),
    ).toBeNull();
  });
});
