import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { Plus, Minus, Maximize2, MousePointer2 } from "lucide-react";
import { statuses, Empty, personInitials } from "./ui.jsx";

export default function NetworkMap({
  graph,
  links: introductions,
  selectedId,
  onSelect,
  onMeeting,
  onAdd,
  onResetFilters,
}) {
  const svgRef = useRef(null),
    layerRef = useRef(null),
    zoomRef = useRef(null),
    dragRef = useRef(null);
  const [dragged, setDragged] = useState({ signature: "", positions: {} });
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [focusedNode, setFocusedNode] = useState(null);
  const [showLabels, setShowLabels] = useState(false);
  const [showAllMeetings, setShowAllMeetings] = useState(false);
  const [showAllPeople, setShowAllPeople] = useState(false);
  const [peoplePage, setPeoplePage] = useState(0);
  const compactMeetings = graph.meetings.length > 10;
  const visibleMeetings = useMemo(
    () => (compactMeetings && !showAllMeetings ? [] : graph.meetings),
    [compactMeetings, showAllMeetings, graph.meetings],
  );
  const dense = graph.people.length + graph.meetings.length > 16;
  const peoplePageSize = 8;
  const peoplePageCount = Math.ceil(graph.people.length / peoplePageSize);
  const currentPeoplePage = Math.min(
    peoplePage,
    Math.max(0, peoplePageCount - 1),
  );
  const visiblePeople = useMemo(
    () =>
      graph.people.length <= peoplePageSize || showAllPeople
        ? graph.people
        : graph.people.slice(
            currentPeoplePage * peoplePageSize,
            (currentPeoplePage + 1) * peoplePageSize,
          ),
    [graph.people, showAllPeople, currentPeoplePage],
  );
  useEffect(() => {
    const index = graph.people.findIndex((person) => person.id === selectedId);
    if (index < 0 || showAllPeople) return;
    const frame = requestAnimationFrame(() =>
      setPeoplePage(Math.floor(index / peoplePageSize)),
    );
    return () => cancelAnimationFrame(frame);
  }, [selectedId, graph.people, showAllPeople]);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 960, height: 640 });
  // SVG's fixed desktop viewBox otherwise shrinks labels below readable CSS pixels.
  const labelScale =
    dimensions.width < 600
      ? 1
      : 1 / Math.min(dimensions.width / 960, dimensions.height / 640);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width),
        height = Math.round(entry.contentRect.height);
      if (width && height)
        setDimensions((current) =>
          current.width === width && current.height === height
            ? current
            : { width, height },
        );
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);
  const nodes = useMemo(
    () => [
      { id: "self_node", type: "self", name: "나의 연결" },
      ...visibleMeetings.map((m) => ({ ...m, type: "meeting" })),
      ...visiblePeople.map((p) => ({ ...p, type: "person" })),
    ],
    [visiblePeople, visibleMeetings],
  );
  const links = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    const meetingIds = new Set(visibleMeetings.map((meeting) => meeting.id));
    const visibleEdges = graph.edges.filter(
      (edge) => meetingIds.has(edge.meetingId) && ids.has(edge.personId),
    );
    const connected = new Set(visibleEdges.map((edge) => edge.personId));
    return [
      ...visibleMeetings.map((m) => ({
        id: `self_${m.id}`,
        source: "self_node",
        target: m.id,
        type: "meeting",
      })),
      ...visibleEdges.map((e) => ({
        id: e.id,
        source: e.meetingId,
        target: e.personId,
        type: "attendance",
      })),
      ...visiblePeople
        .filter((p) => !connected.has(p.id))
        .map((p) => ({
          id: `self_${p.id}`,
          source: "self_node",
          target: p.id,
          type: "attendance",
        })),
      ...introductions
        .filter((l) => ids.has(l.aId) && ids.has(l.bId))
        .map((l) => ({
          id: l.id,
          source: l.aId,
          target: l.bId,
          type: "introduction",
          direction: l.direction,
        })),
    ];
  }, [nodes, graph.edges, introductions, visibleMeetings, visiblePeople]);
  // Stable signature avoids rebuilding the layout for unrelated notes and todos.
  const signature = JSON.stringify({
    nodes: nodes.map(({ id, type }) => ({ id, type })),
    links: links.map(({ source, target, type }) => ({ source, target, type })),
    layoutVersion,
    dimensions,
    labelScale,
  });
  const computedPositions = useMemo(() => {
    const { nodes, links, dimensions, labelScale } = JSON.parse(signature);
    if (
      dimensions.width >= 600 &&
      nodes.every((node) => node.type !== "meeting")
    ) {
      const people = nodes.filter((node) => node.type === "person");
      const center = { x: 480, y: 275 };
      return Object.fromEntries([
        ["self_node", center],
        ...people.map((node, index) => {
          const angle = -Math.PI / 2 + (2 * Math.PI * index) / people.length;
          return [
            node.id,
            {
              x: center.x + 330 * Math.cos(angle),
              y: center.y + 190 * Math.sin(angle),
            },
          ];
        }),
      ]);
    }
    const points = nodes.map((n) => ({
      ...n,
      ...(n.type === "self" ? { fx: 480, fy: 320 } : {}),
    }));
    const simulation = d3
      .forceSimulation(points)
      .randomSource(d3.randomLcg(0.42))
      .force(
        "link",
        d3
          .forceLink(links.map((l) => ({ ...l })))
          .id((n) => n.id)
          .distance((l) =>
            l.type === "meeting" ? 185 : l.type === "introduction" ? 160 : 115,
          )
          .strength(0.55),
      )
      .force("charge", d3.forceManyBody().strength(-800))
      .force("collision", d3.forceCollide(62))
      .force("x", d3.forceX(480).strength(0.045))
      .force("y", d3.forceY(320).strength(0.065))
      .stop();
    for (let i = 0; i < 180; i++) simulation.tick();
    const extentX = d3.extent(points, (p) => p.x),
      extentY = d3.extent(points, (p) => p.y);
    const scale = Math.min(
      1,
      770 / Math.max(1, extentX[1] - extentX[0]),
      380 / Math.max(1, extentY[1] - extentY[0]),
    );
    const compact = dimensions.width < 600;
    if (compact) {
      // Portrait layout keeps touch targets and labels at their actual pixel size.
      const mobile = points.map((n) => ({
        ...n,
        fx: undefined,
        fy: undefined,
        x:
          48 +
          ((n.x - extentX[0]) / Math.max(1, extentX[1] - extentX[0])) *
            (dimensions.width - 96),
        y:
          65 +
          ((n.y - extentY[0]) / Math.max(1, extentY[1] - extentY[0])) *
            (dimensions.height - 215),
      }));
      const settle = d3
        .forceSimulation(mobile)
        .force("collision", d3.forceCollide(43).iterations(3))
        .stop();
      for (let i = 0; i < 90; i++) {
        settle.tick();
        for (const n of mobile) {
          n.x = Math.max(42, Math.min(dimensions.width - 42, n.x));
          n.y = Math.max(60, Math.min(dimensions.height - 150, n.y));
        }
      }
      settle.stop();
      return Object.fromEntries(mobile.map((n) => [n.id, { x: n.x, y: n.y }]));
    } else {
      const desktop = points.map((n) => ({
        ...n,
        fx: undefined,
        fy: undefined,
        x: 480 + (n.x - (extentX[0] + extentX[1]) / 2) * scale,
        y: 275 + (n.y - (extentY[0] + extentY[1]) / 2) * scale,
      }));
      // Re-space after fitting: fitting alone can bring names into nearby nodes.
      const settle = d3
        .forceSimulation(desktop)
        .force("collision", d3.forceCollide(55 * labelScale).iterations(3))
        .stop();
      for (let i = 0; i < 90; i++) {
        settle.tick();
        for (const n of desktop) {
          n.x = Math.max(85, Math.min(875, n.x));
          n.y = Math.max(60, Math.min(460, n.y));
        }
      }
      settle.stop();
      return Object.fromEntries(desktop.map((n) => [n.id, { x: n.x, y: n.y }]));
    }
  }, [signature]);
  const positions =
    dragged.signature === signature
      ? { ...computedPositions, ...dragged.positions }
      : computedPositions;
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const zoom = d3
      .zoom()
      .scaleExtent([0.45, 2.5])
      .filter(
        (e) =>
          !e.target.closest?.("[data-node]") &&
          (!e.button || e.type === "wheel"),
      )
      .on("zoom", (e) =>
        d3.select(layerRef.current).attr("transform", e.transform),
      );
    svg.call(zoom).on("dblclick.zoom", null);
    zoomRef.current = zoom;
    return () => {
      svg.on(".zoom", null);
    };
  }, []);
  function startDrag(event, node) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: node.id,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  }
  function moveDrag(event) {
    const drag = dragRef.current;
    if (!drag) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4)
      drag.moved = true;
    if (!drag.moved) return;
    const p = d3
      .zoomTransform(svgRef.current)
      .invert(d3.pointer(event, svgRef.current));
    setDragged((current) => ({
      signature,
      positions: {
        ...(current.signature === signature ? current.positions : {}),
        [drag.id]: { x: p[0], y: p[1] },
      },
    }));
  }
  function finishDrag(event, node) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved && event.type !== "pointercancel") activate(node);
  }
  function activate(node) {
    if (node.type === "person") onSelect(node.id);
    if (node.type === "meeting") onMeeting(node.id);
  }
  function zoomBy(factor) {
    d3.select(svgRef.current)
      .transition()
      .duration(180)
      .call(zoomRef.current.scaleBy, factor);
  }
  function reset() {
    d3.select(svgRef.current)
      .transition()
      .duration(250)
      .call(zoomRef.current.transform, d3.zoomIdentity);
    setLayoutVersion((v) => v + 1);
  }
  return (
    <div className="network-canvas" ref={containerRef}>
      {peoplePageCount > 1 && (
        <div className="graph-people-controls" aria-label="지도에 표시할 인맥">
          <span>
            {showAllPeople
              ? `인맥 전체 ${graph.people.length}명`
              : `인맥 ${currentPeoplePage * peoplePageSize + 1}–${Math.min((currentPeoplePage + 1) * peoplePageSize, graph.people.length)} / ${graph.people.length}명`}
          </span>
          {!showAllPeople && (
            <>
              <button
                type="button"
                disabled={currentPeoplePage === 0}
                onClick={() => setPeoplePage((page) => page - 1)}
              >
                이전
              </button>
              <button
                type="button"
                disabled={currentPeoplePage >= peoplePageCount - 1}
                onClick={() => setPeoplePage((page) => page + 1)}
              >
                다음
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowAllPeople((value) => !value)}
          >
            {showAllPeople ? "나눠 보기" : "전체 보기"}
          </button>
        </div>
      )}
      {(compactMeetings || (dense && visibleMeetings.length > 0)) && (
        <div className="graph-view-controls">
          {compactMeetings && (
            <button
              type="button"
              className="graph-meeting-toggle"
              aria-pressed={showAllMeetings}
              onClick={() => {
                setShowAllMeetings((current) => !current);
                setFocusedNode(null);
              }}
            >
              {showAllMeetings
                ? "인맥 중심으로 보기"
                : `만남 ${graph.meetings.length}개 표시`}
            </button>
          )}
          {dense && visibleMeetings.length > 0 && (
            <label className="graph-label-toggle">
              <input
                type="checkbox"
                checked={showLabels}
                onChange={(event) => setShowLabels(event.target.checked)}
              />
              만남 이름 모두 표시
            </label>
          )}
        </div>
      )}
      <div className="map-watermark">YOUR CONNECTIONS, CONNECTED.</div>
      <svg
        ref={svgRef}
        viewBox={
          dimensions.width < 600
            ? `0 0 ${dimensions.width} ${dimensions.height}`
            : "0 0 960 640"
        }
        aria-label="인맥 관계 지도"
        role="group"
      >
        <defs>
          <filter id="node-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow
              dx="0"
              dy="5"
              stdDeviation="7"
              floodColor="#464061"
              floodOpacity=".10"
            />
          </filter>
          <marker
            id="intro-arrow"
            markerWidth="7"
            markerHeight="7"
            refX="18"
            refY="3.5"
            orient="auto"
          >
            <path d="M0 0 L7 3.5 L0 7" fill="#988cae" />
          </marker>
        </defs>
        <g ref={layerRef}>
          {links.map((l) => {
            const a = positions[l.source],
              b = positions[l.target];
            return a && b ? (
              <line
                key={l.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={
                  focusedNode &&
                  (l.source === focusedNode || l.target === focusedNode)
                    ? "#7040ca"
                    : l.type === "introduction"
                      ? "#b4a8c6"
                      : "#ccd0d6"
                }
                opacity={
                  focusedNode &&
                  l.source !== focusedNode &&
                  l.target !== focusedNode
                    ? 0.22
                    : 1
                }
                vectorEffect="non-scaling-stroke"
                strokeWidth={l.type === "meeting" ? 1.8 : 1.3}
                strokeDasharray={l.type === "introduction" ? "5 5" : undefined}
                markerEnd={
                  l.type === "introduction" && l.direction === "a-to-b"
                    ? "url(#intro-arrow)"
                    : undefined
                }
              />
            ) : null;
          })}
          {nodes.map((node) => {
            const pos = positions[node.id];
            if (!pos) return null;
            const self = node.type === "self",
              meeting = node.type === "meeting",
              r = self ? 34 : meeting ? 24 : 22 + node.importance * 2;
            const focused = focusedNode === node.id || selectedId === node.id;
            const color = statuses[node.status]?.color || "#8877cb";
            return (
              <g
                data-node={node.id}
                key={node.id}
                transform={`translate(${pos.x},${pos.y})`}
                role={self ? undefined : "button"}
                tabIndex={self ? undefined : 0}
                aria-label={`${meeting ? "만남" : "인맥"} ${node.name}`}
                className="graph-node"
                onMouseEnter={() => setFocusedNode(node.id)}
                onMouseLeave={() => setFocusedNode(null)}
                onFocus={() => setFocusedNode(node.id)}
                onBlur={() => setFocusedNode(null)}
                onPointerDown={(e) => startDrag(e, node)}
                onPointerMove={moveDrag}
                onPointerUp={(e) => finishDrag(e, node)}
                onPointerCancel={(e) => finishDrag(e, node)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activate(node);
                  }
                }}
              >
                <title>
                  {node.name}
                  {node.company ? ` · ${node.company}` : ""}
                </title>
                {selectedId === node.id && (
                  <circle
                    r={r + 7}
                    fill="none"
                    stroke="#8975d6"
                    strokeWidth="2"
                  />
                )}
                {self && <circle r={47} fill="#eeeef1" opacity=".7" />}
                <circle
                  r={r}
                  fill={self ? "#41414c" : "#fff"}
                  stroke={meeting ? "#dedfe4" : self ? "#41414c" : "#fff"}
                  strokeWidth="2"
                  filter="url(#node-shadow)"
                />
                {meeting ? (
                  <path
                    d="M-8-7 h16 v14 h-16z M-8-3 h16 M-4-10v6 M4-10v6"
                    fill="none"
                    stroke="#6f7179"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                ) : (
                  <text
                    textAnchor="middle"
                    dy="5"
                    fontSize={(self ? 16 : 14) * labelScale}
                    fontWeight="650"
                    fill={self ? "#fff" : color}
                  >
                    {self ? "나" : personInitials(node.name)}
                  </text>
                )}
                {!self && !meeting && (
                  <circle
                    cx={r * 0.72}
                    cy={-r * 0.65}
                    r="5"
                    fill={color}
                    stroke="#fff"
                    strokeWidth="2"
                  />
                )}
                {(!meeting || !dense || showLabels || focused) && (
                  <text
                    className="node-label"
                    textAnchor="middle"
                    y={r + 20 * labelScale}
                    fontSize={14 * labelScale}
                    fontWeight="600"
                    fill={meeting ? "#60616c" : "#303239"}
                  >
                    {node.name.length > 15
                      ? `${node.name.slice(0, 15)}…`
                      : node.name}
                  </text>
                )}
                {!self &&
                  !meeting &&
                  (!dense ||
                    focused ||
                    graph.people.filter((person) => person.name === node.name)
                      .length > 1) && (
                    <text
                      textAnchor="middle"
                      y={r + 37 * labelScale}
                      fontSize={12 * labelScale}
                      fill="#596276"
                    >
                      {(node.company || node.job || "소속 미입력")
                        .split(" · ")[0]
                        .slice(0, 16)}
                    </text>
                  )}
              </g>
            );
          })}
        </g>
      </svg>
      {focusedNode && (
        <div className="graph-focus-caption" role="status">
          {nodes.find((node) => node.id === focusedNode)?.name}
        </div>
      )}
      {!graph.people.length && (
        <div className="map-empty">
          <Empty
            title={
              graph.hiddenCount
                ? "조건에 맞는 연결이 없어요"
                : "새로운 연결을 시작해보세요"
            }
            description={
              graph.hiddenCount
                ? "필터를 초기화하면 저장된 인맥을 모두 볼 수 있어요."
                : "인맥을 추가하면 만남과 소개 관계가 지도에 펼쳐집니다."
            }
            action={
              <button
                className="primary-button"
                onClick={graph.hiddenCount ? onResetFilters : onAdd}
              >
                <Plus size={16} />
                {graph.hiddenCount ? "필터 초기화" : "인맥 추가"}
              </button>
            }
          />
        </div>
      )}
      <div className="map-legend">
        <span>
          <i style={{ background: "#4f9e88" }} />
          성공
        </span>
        <span>
          <i style={{ background: "#8b79d9" }} />
          대기
        </span>
        <span className="legend-line" />
        소개 관계
      </div>
      <div className="map-controls">
        <button aria-label="지도 확대" onClick={() => zoomBy(1.25)}>
          <Plus size={17} />
        </button>
        <button aria-label="지도 축소" onClick={() => zoomBy(0.8)}>
          <Minus size={17} />
        </button>
        <button aria-label="지도 정렬 초기화" onClick={reset}>
          <Maximize2 size={17} />
        </button>
      </div>
      <span className="map-hint">
        <MousePointer2 size={12} />
        인맥을 눌러 이야기를 확인하세요
      </span>
    </div>
  );
}
