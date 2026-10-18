import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { Minus, Plus, Scan, LocateFixed, Coffee } from "lucide-react";
import { placeGraph } from "./layout";
import { identityTone } from "./appearance";

export default function GraphCanvas({ graph, nav, dispatch }) {
  const svgRef = useRef(null),
    drag = useRef(null),
    suppressClick = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [keyboardKey, setKeyboardKey] = useState(null);
  const positions = useMemo(
    () =>
      size.width
        ? placeGraph(graph, nav.positions, size.width, size.height, nav.focus)
        : nav.positions,
    [graph, nav.positions, size, nav.focus],
  );
  useEffect(() => {
    if (positions !== nav.positions) dispatch({ type: "layout", positions });
  }, [positions, nav.positions, dispatch]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width),
        height = Math.round(entry.contentRect.height);
      if (width && height)
        setSize((current) =>
          current.width === width && current.height === height
            ? current
            : { width, height },
        );
    });
    observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, []);
  const onZoom = useEffectEvent((event) =>
    dispatch({
      type: "camera",
      camera: {
        x: event.transform.x,
        y: event.transform.y,
        k: event.transform.k,
      },
    }),
  );
  const zoom = useMemo(
    () =>
      d3
        .zoom()
        .scaleExtent([0.45, 2.5])
        .filter(
          (event) =>
            !event.button &&
            (event.type === "wheel" ||
              event.target.classList?.contains("graph-svg")),
        ),
    [],
  );
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    zoom
      .extent([
        [0, 0],
        [size.width, size.height],
      ])
      .on("zoom", (event) => onZoom(event));
    svg.call(zoom).on("dblclick.zoom", null);
    return () => {
      svg.on(".zoom", null);
    };
  }, [zoom, size]);
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const current = d3.zoomTransform(svgRef.current);
    if (
      current.x !== nav.camera.x ||
      current.y !== nav.camera.y ||
      current.k !== nav.camera.k
    ) {
      svg.call(
        zoom.transform,
        d3.zoomIdentity
          .translate(nav.camera.x, nav.camera.y)
          .scale(nav.camera.k),
      );
    }
  }, [nav.camera, zoom]);
  const select = (kind, key) =>
    dispatch({ type: "select", selection: { kind, key } });
  function zoomBy(factor) {
    d3.select(svgRef.current).call(zoom.scaleBy, factor);
  }
  function fit() {
    if (!graph.nodes.length) return;
    const points = graph.nodes.map((n) => positions[n.key]);
    const xs = points.map((p) => p.x),
      ys = points.map((p) => p.y);
    const x0 = Math.min(...xs) - 90,
      y0 = Math.min(...ys) - 60;
    const width = Math.max(...xs) - x0 + 90,
      height = Math.max(...ys) - y0 + 90;
    const k = Math.max(
      0.45,
      Math.min(1.2, (size.width - 48) / width, (size.height - 80) / height),
    );
    dispatch({
      type: "camera",
      camera: {
        x: (size.width - width * k) / 2 - x0 * k,
        y: (size.height - height * k) / 2 - y0 * k,
        k,
      },
    });
  }
  function reveal() {
    const key = nav.selection?.kind === "node" ? nav.selection.key : nav.focus;
    const point = positions[key];
    if (!point) return;
    const usableWidth = size.width;
    dispatch({
      type: "camera",
      camera: {
        ...nav.camera,
        x: usableWidth / 2 - point.x * nav.camera.k,
        y: size.height * 0.35 - point.y * nav.camera.k,
      },
    });
  }
  const k = nav.camera.k;
  const cards = size.width >= 580 && k >= 0.85;
  const labelLimit = size.width < 600 ? 9 : 13;
  return (
    <div className="graph-canvas">
      <svg
        ref={svgRef}
        className="graph-svg"
        aria-label="관계 지도 캔버스"
        data-layout-settled={
          size.width > 0 && positions === nav.positions ? "true" : "false"
        }
        onClick={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (event.target === svgRef.current)
            dispatch({ type: "select", selection: null });
        }}
      >
        <defs>
          <marker
            id="graph-introduction-arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <g transform={`translate(${nav.camera.x},${nav.camera.y}) scale(${k})`}>
          {graph.edges.map((edge) => {
            const a = positions[edge.from],
              b = positions[edge.to];
            if (!a || !b) return null;
            const selected = nav.selection?.key === edge.key;
            const related =
              nav.selection?.key === edge.from ||
              nav.selection?.key === edge.to;
            const label = edge.kind === "attended" ? "만남 참석" : "소개 기록";
            const dx = b.x - a.x,
              dy = b.y - a.y;
            const trim = cards
              ? Math.min(
                  84 / Math.max(Math.abs(dx), 1),
                  36 / Math.max(Math.abs(dy), 1),
                  0.4,
                )
              : Math.min(29 / Math.max(Math.hypot(dx, dy), 1), 0.4);
            const start = { x: a.x + dx * trim, y: a.y + dy * trim };
            const end = { x: b.x - dx * trim, y: b.y - dy * trim };
            const names = [edge.from, edge.to]
              .map((key) => graph.nodes.find((n) => n.key === key)?.label)
              .join(" → ");
            return (
              <g
                key={edge.key}
                role="button"
                tabIndex={0}
                aria-label={`${label}: ${names}`}
                aria-pressed={selected}
                className={`graph-edge ${edge.kind} ${selected || related ? "is-active" : ""}`}
                onClick={() => select("edge", edge.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select("edge", edge.key);
                  }
                }}
              >
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className="graph-edge-hit"
                  strokeWidth={16 / k}
                />
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  className="graph-edge-line"
                  vectorEffect="non-scaling-stroke"
                  markerEnd={
                    edge.kind === "introduction_record"
                      ? "url(#graph-introduction-arrow)"
                      : undefined
                  }
                />
                {(cards
                  ? selected || related || graph.edges.length < 12
                  : selected) && (
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 8 / k}
                    textAnchor="middle"
                    fontSize={11 / k}
                    className="graph-edge-label"
                  >
                    {selected || related
                      ? label
                      : edge.kind === "attended"
                        ? "참석"
                        : "소개"}
                  </text>
                )}
              </g>
            );
          })}
          {graph.nodes.map((node, index) => {
            const point = positions[node.key],
              selected = nav.selection?.key === node.key;
            if (!point) return null;
            const focus = nav.focus === node.key,
              pinned = nav.pins.includes(node.key);
            const important = selected || focus || keyboardKey === node.key;
            return (
              <g
                key={node.key}
                data-node-key={node.key}
                data-x={point.x}
                data-y={point.y}
                data-tone={identityTone(node.sourceId)}
                transform={`translate(${point.x},${point.y})`}
                role="button"
                tabIndex={0}
                aria-label={`${node.kind === "person" ? "인맥" : "만남"} ${node.label}`}
                aria-pressed={selected}
                className={`graph-node ${cards ? "is-card" : "is-compact"} ${node.kind} ${selected ? "is-selected" : ""} ${focus ? "is-center" : ""}`}
                onFocus={() => setKeyboardKey(node.key)}
                onBlur={() => setKeyboardKey(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  select("node", node.key);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select("node", node.key);
                  }
                  if (
                    [
                      "ArrowRight",
                      "ArrowDown",
                      "ArrowLeft",
                      "ArrowUp",
                    ].includes(event.key)
                  ) {
                    event.preventDefault();
                    const offset = ["ArrowLeft", "ArrowUp"].includes(event.key)
                      ? -1
                      : 1;
                    const next =
                      graph.nodes[
                        (index + offset + graph.nodes.length) %
                          graph.nodes.length
                      ];
                    svgRef.current
                      .querySelector(`[data-node-key="${next.key}"]`)
                      ?.focus();
                  }
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  drag.current = {
                    key: node.key,
                    x: event.clientX,
                    y: event.clientY,
                    origin: point,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const start = drag.current;
                  if (!start || start.key !== node.key) return;
                  const dx = event.clientX - start.x,
                    dy = event.clientY - start.y;
                  if (Math.abs(dx) + Math.abs(dy) < 5) return;
                  suppressClick.current = true;
                  dispatch({
                    type: "layout",
                    positions: {
                      ...positions,
                      [node.key]: {
                        x: start.origin.x + dx / k,
                        y: start.origin.y + dy / k,
                      },
                    },
                  });
                }}
                onPointerUp={() => {
                  drag.current = null;
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
              >
                <title>
                  {node.label}
                  {node.subtitle ? ` · ${node.subtitle}` : ""}
                </title>
                {cards ? (
                  <rect
                    x={-88}
                    y={-38}
                    width={176}
                    height={76}
                    rx={14}
                    className="graph-node-hit"
                  />
                ) : (
                  <circle r={29 / k} className="graph-node-hit" />
                )}
                {cards ? (
                  <>
                    <rect
                      x={node.kind === "person" ? -82 : -90}
                      y={-33}
                      width={node.kind === "person" ? 164 : 180}
                      height={66}
                      rx={11}
                      className="graph-node-card"
                    />
                    {(focus || selected) && (
                      <rect
                        x={-86}
                        y={-37}
                        width={172}
                        height={74}
                        rx={15}
                        className={
                          selected
                            ? "graph-selection-ring"
                            : "graph-center-ring"
                        }
                      />
                    )}
                    {focus && (
                      <g className="graph-focus-tag">
                        <rect x={-34} y={-57} width={68} height={19} rx={5} />
                        <text y={-44} textAnchor="middle" fontSize={10}>
                          탐색 중심
                        </text>
                      </g>
                    )}
                    {node.kind === "person" ? (
                      <>
                        <circle
                          cx={-52}
                          cy={-2}
                          r={18}
                          className="graph-node-shape"
                        />
                        <text
                          x={-52}
                          y={-1}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="graph-node-initial"
                          fontSize={12}
                        >
                          {node.label.slice(-2)}
                        </text>
                      </>
                    ) : (
                      <Coffee
                        x={-74}
                        y={-21}
                        width={14}
                        height={14}
                        className="graph-meeting-glyph"
                      />
                    )}
                    <text
                      x={node.kind === "person" ? -24 : -74}
                      y={node.kind === "person" ? -3 : 16}
                      fontSize={node.kind === "person" ? 15 : 12}
                      className="graph-node-label"
                    >
                      {node.label.length > (node.kind === "person" ? 7 : 14)
                        ? node.label.slice(0, node.kind === "person" ? 6 : 13) +
                          "…"
                        : node.label}
                    </text>
                    <text
                      x={node.kind === "person" ? -24 : -51}
                      y={node.kind === "person" ? 16 : -9}
                      fontSize={11}
                      className="graph-node-subtitle"
                    >
                      {(node.subtitle.split(" · ")[0] || "인물").slice(0, 10)}
                    </text>
                  </>
                ) : (
                  <>
                    {focus && (
                      <circle
                        r={32}
                        className="graph-center-ring"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    {selected && (
                      <circle
                        r={29}
                        className="graph-selection-ring"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    {node.kind === "person" ? (
                      <circle
                        r={24}
                        className="graph-node-shape"
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : (
                      <rect
                        x={-22}
                        y={-20}
                        width={44}
                        height={40}
                        rx={11}
                        className="graph-node-shape"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    {node.kind === "person" ? (
                      <text
                        textAnchor="middle"
                        dy="0.35em"
                        className="graph-node-initial"
                        fontSize={node.kind === "person" ? 13 : 16}
                      >
                        {node.label.slice(-2)}
                      </text>
                    ) : (
                      <Coffee
                        x={-10}
                        y={-10}
                        width={20}
                        height={20}
                        className="graph-meeting-glyph"
                      />
                    )}
                    {(k >= 0.75 || important || graph.nodes.length <= 20) && (
                      <text
                        y={28 + 14 / k}
                        textAnchor="middle"
                        fontSize={13 / k}
                        className="graph-node-label"
                      >
                        {node.label.length > labelLimit
                          ? node.label.slice(0, labelLimit - 1) + "…"
                          : node.label}
                      </text>
                    )}
                    {(k > 1.35 || important) && (
                      <text
                        y={28 + 32 / k}
                        textAnchor="middle"
                        fontSize={12 / k}
                        className="graph-node-subtitle"
                      >
                        {node.subtitle.length > 18
                          ? node.subtitle.slice(0, 17) + "…"
                          : node.subtitle}
                      </text>
                    )}
                  </>
                )}
                {pinned && (
                  <text
                    x={cards ? 64 : 23}
                    y={cards ? -43 : -32}
                    fontSize={11 / k}
                    className="graph-pin-label"
                  >
                    고정
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="graph-legend" aria-label="지도 범례">
        <span>
          <i className="legend-person" />
          인물
        </span>
        <span>
          <i className="legend-meeting" />
          만남
        </span>
        <span>실선 · 기록된 관계</span>
      </div>
      <div className="graph-camera-controls" aria-label="지도 보기 조절">
        <button title="축소" aria-label="지도 축소" onClick={() => zoomBy(0.8)}>
          <Minus size={16} />
        </button>
        <output>{Math.round(k * 100)}%</output>
        <button
          title="확대"
          aria-label="지도 확대"
          onClick={() => zoomBy(1.25)}
        >
          <Plus size={16} />
        </button>
        <button
          title="현재 보기 맞춤"
          aria-label="현재 보기 맞춤"
          onClick={fit}
        >
          <Scan size={17} />
        </button>
        <button
          title="선택 대상 보기"
          aria-label="선택 대상 보기"
          disabled={!nav.selection && !nav.focus}
          onClick={reveal}
        >
          <LocateFixed size={17} />
        </button>
      </div>
      {keyboardKey && (
        <span className="graph-focus-caption">
          {graph.nodes.find((n) => n.key === keyboardKey)?.label}
        </span>
      )}
    </div>
  );
}
