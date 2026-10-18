import * as d3 from "d3";

// D3 mutates copies only. Existing positions remain fixed when records are appended.
export function placeGraph(graph, cached, width, height, focusKey = null) {
  const missing = graph.nodes.filter((n) => !cached[n.key]);
  if (!missing.length) return cached;
  // Leave room for the bottom inspector before selection, without moving cached nodes.
  const centerY = width < 580 ? height * 0.38 : height * 0.48;
  const points = graph.nodes.map((node, index) => {
    const previous = cached[node.key];
    const angle = index * 2.399963;
    return {
      id: node.key,
      x: previous?.x ?? width / 2 + Math.cos(angle) * 160,
      y: previous?.y ?? centerY + Math.sin(angle) * 160,
      ...(previous
        ? { fx: previous.x, fy: previous.y }
        : node.key === focusKey
          ? { fx: width / 2, fy: centerY }
          : {}),
    };
  });
  const simulation = d3
    .forceSimulation(points)
    .randomSource(d3.randomLcg(0.42))
    .force(
      "link",
      d3
        .forceLink(graph.edges.map((e) => ({ source: e.from, target: e.to })))
        .id((n) => n.id)
        .distance(width >= 580 ? 200 : 155)
        .strength(0.6),
    )
    .force("charge", d3.forceManyBody().strength(-650))
    .force("collision", d3.forceCollide(width >= 580 ? 105 : 72).iterations(3))
    .force("x", d3.forceX(width / 2).strength(0.06))
    .force("y", d3.forceY(centerY).strength(0.08))
    .stop();
  for (let i = 0; i < 180; i++) simulation.tick();
  simulation.stop();
  // Compact screens keep the initial focus above the detail sheet. Only initial
  // composition changes; selection and later expansions preserve cached positions.
  if (
    width < 580 &&
    focusKey &&
    !Object.keys(cached).length &&
    points.length <= 8
  ) {
    const depths = new Map([[focusKey, 0]]);
    for (let depth = 0; depth < points.length; depth++) {
      for (const edge of graph.edges) {
        if (depths.get(edge.from) === depth && !depths.has(edge.to))
          depths.set(edge.to, depth + 1);
        if (depths.get(edge.to) === depth && !depths.has(edge.from))
          depths.set(edge.from, depth + 1);
      }
    }
    for (const point of points) {
      const depth = depths.get(point.id) ?? 2;
      const row = points.filter((p) => (depths.get(p.id) ?? 2) === depth);
      const index = row.indexOf(point);
      point.x =
        row.length === 1
          ? width / 2
          : 76 + (index * (width - 152)) / (row.length - 1);
      point.y =
        82 +
        depth * Math.min(135, (height - 215) / Math.max(2, ...depths.values()));
    }
    return Object.fromEntries(points.map((p) => [p.id, { x: p.x, y: p.y }]));
  }
  if (!Object.keys(cached).length && points.length > 1) {
    const [x0, x1] = d3.extent(points, (n) => n.x);
    const [y0, y1] = d3.extent(points, (n) => n.y);
    for (const point of points) {
      point.x =
        100 +
        ((point.x - x0) / Math.max(1, x1 - x0)) * Math.max(120, width - 200);
      point.y =
        120 +
        ((point.y - y0) / Math.max(1, y1 - y0)) * Math.max(180, height - 290);
    }
  }
  // Do not clamp individual points into overlapping piles on narrow viewports.
  // The camera and explicit Fit action own visibility; the list is always available.
  return {
    ...cached,
    ...Object.fromEntries(
      points
        .filter((n) => !cached[n.id])
        .map((n) => [n.id, { x: n.x, y: n.y }]),
    ),
  };
}
