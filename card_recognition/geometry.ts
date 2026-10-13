export interface CardPoint {
  x: number;
  y: number;
}

export type CardCorners = [CardPoint, CardPoint, CardPoint, CardPoint];

function distance(a: CardPoint, b: CardPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function orderCardCorners(points: CardPoint[]): CardCorners | null {
  if (
    points.length !== 4 ||
    points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  ) {
    return null;
  }
  const center = points.reduce(
    (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
    { x: 0, y: 0 },
  );
  const around = [...points].sort(
    (a, b) =>
      Math.atan2(a.y - center.y, a.x - center.x) -
      Math.atan2(b.y - center.y, b.x - center.x),
  );
  const topLeft = around.reduce(
    (best, point, index) =>
      point.x + point.y < around[best].x + around[best].y ? index : best,
    0,
  );
  const ordered = [...around.slice(topLeft), ...around.slice(0, topLeft)];
  const corners = ordered as CardCorners;
  const signedArea = corners.reduce((sum, point, index) => {
    const next = corners[(index + 1) % 4];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  return signedArea > 0 ? corners : null;
}

export function rectifiedCardSize(
  corners: CardCorners,
  maxLongEdge = 2600,
): { width: number; height: number } | null {
  const width = Math.max(
    distance(corners[0], corners[1]),
    distance(corners[2], corners[3]),
  );
  const height = Math.max(
    distance(corners[1], corners[2]),
    distance(corners[3], corners[0]),
  );
  if (width < 160 || height < 80) return null;
  const scale = Math.min(1, maxLongEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
