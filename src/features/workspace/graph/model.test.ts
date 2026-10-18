import { describe, expect, it } from "vitest";
import { frontendGraphFixture, fixtureId } from "../preview/fixture";
import {
  defaultFilters,
  filterGraph,
  graphReducer,
  initialNavigation,
  visibleGraph,
  workspaceGraph,
  type Graph,
  type GraphNavigation,
  type NodeKey,
} from "./model";
import { placeGraph } from "./layout";

const p = (i: number): NodeKey => `person:${fixtureId(1, i)}`;
const m = (i: number): NodeKey => `interaction:${fixtureId(2, i)}`;
describe("workspace graph records", () => {
  it("preserves duplicate-name identities and creates no self or profile-derived relationship", () => {
    const graph = workspaceGraph(frontendGraphFixture());
    expect(
      graph.nodes.filter((n) => n.label === "김민수").map((n) => n.key),
    ).toEqual([p(1), p(4)]);
    expect(graph.nodes).toHaveLength(12);
    expect(graph.edges).toHaveLength(9);
    expect(
      graph.edges.filter(
        (e) => [p(7), p(8)].includes(e.from) || [p(7), p(8)].includes(e.to),
      ),
    ).toHaveLength(0);
    expect(new Set(graph.nodes.map((n) => n.kind))).toEqual(
      new Set(["person", "interaction"]),
    );
  });
  it("removes archived and dangling records without reviving them through history or pin", () => {
    const state = frontendGraphFixture();
    state.people[0].deletedAt = "2026-10-14T00:00:00Z";
    const graph = workspaceGraph(state);
    const nav = { ...initialNavigation(), focus: p(1), pins: [p(1)] };
    expect(visibleGraph(graph, nav).nodes.some((n) => n.key === p(1))).toBe(
      false,
    );
    expect(graph.edges.some((e) => e.from === p(1) || e.to === p(1))).toBe(
      false,
    );
  });
  it("filters actual dates and explicitly includes undated records", () => {
    const state = frontendGraphFixture();
    state.meetings[0].date = null;
    const graph = workspaceGraph(state);
    expect(
      filterGraph(graph, state, {
        ...defaultFilters,
        year: "2026",
        includeUndated: false,
      }).nodes.some((n) => n.key === p(1)),
    ).toBe(false);
    expect(
      filterGraph(graph, state, {
        ...defaultFilters,
        year: "2026",
        includeUndated: true,
      }).nodes.some((n) => n.key === p(1)),
    ).toBe(true);
    expect(workspaceGraph(state).nodes.find((n) => n.key === m(1))?.date).toBe(
      null,
    );
    state.meetings[0].date = "2026-01-02";
    expect(
      filterGraph(workspaceGraph(state), state, {
        ...defaultFilters,
        month: "10",
        includeUndated: false,
      }).nodes.some((n) => n.key === p(1)),
    ).toBe(false);
  });
});

describe("T01–T08 navigation", () => {
  it("separates selection, center, close and blank clear without moving the camera", () => {
    const initial = {
      ...initialNavigation(),
      focus: p(2),
      camera: { x: 12, y: 40, k: 1.4 },
      positions: { [p(1)]: { x: 10, y: 20 } },
    };
    const selected = graphReducer(initial, {
      type: "select",
      selection: { kind: "node", key: p(1) },
    });
    const closed = graphReducer(selected, { type: "close" });
    expect(closed.selection).toEqual(selected.selection);
    expect(closed.focus).toBe(p(2));
    expect(closed.positions).toBe(initial.positions);
    expect(closed.camera).toBe(initial.camera);
    expect(closed.history).toHaveLength(0);
    expect(closed.inspectorOpen).toBe(false);
    expect(
      graphReducer(closed, { type: "select", selection: null }).selection,
    ).toBe(null);
  });
  it("keeps out-of-filter selection readable without silently relaxing the filter", () => {
    const state = frontendGraphFixture(),
      graph = workspaceGraph(state);
    const selected = graphReducer(initialNavigation(), {
      type: "select",
      selection: { kind: "node", key: p(1) },
    });
    const nav = graphReducer(selected, {
      type: "filter",
      filters: { ...defaultFilters, status: "success" },
    });
    expect(nav.selection).toEqual(selected.selection);
    expect(
      visibleGraph(filterGraph(graph, state, nav.filters), nav).nodes,
    ).toHaveLength(0);
    expect(graph.nodes.some((n) => n.key === nav.selection?.key)).toBe(true);
  });
  it("rejects stale expansion and deduplicates the same scope request", () => {
    const initial = initialNavigation();
    const expansion = {
      id: "a",
      anchor: p(1),
      kind: "interaction" as const,
      keys: [m(1)],
    };
    const next = graphReducer(initial, {
      type: "filter",
      filters: { ...defaultFilters, year: "2026" },
    });
    expect(
      graphReducer(next, {
        type: "expand",
        revision: initial.revision,
        expansion,
      }),
    ).toBe(next);
    const expanded = graphReducer(next, {
      type: "expand",
      revision: next.revision,
      expansion,
    });
    expect(
      graphReducer(expanded, {
        type: "expand",
        revision: expanded.revision,
        expansion,
      }),
    ).toBe(expanded);
  });
  it("collapse respects overlapping expansion, selection and pinned references", () => {
    const graph: Graph = {
      nodes: [p(1), p(2), p(3), p(4)].map((key) => ({
        key,
        sourceId: key.split(":")[1],
        kind: "person",
        label: key,
        subtitle: "",
        date: null,
      })),
      edges: [],
    };
    let nav: GraphNavigation = {
      ...initialNavigation(),
      focus: p(1),
      expansions: [
        { id: "a", anchor: p(1), kind: "person" as const, keys: [p(2), p(3)] },
        { id: "b", anchor: p(1), kind: "person" as const, keys: [p(3), p(4)] },
      ],
    };
    nav = graphReducer(nav, { type: "collapse", id: "a" });
    expect(visibleGraph(graph, nav).nodes.map((n) => n.key)).toEqual([
      p(1),
      p(3),
      p(4),
    ]);
    nav = graphReducer(nav, { type: "pin", key: p(3) });
    nav = graphReducer(nav, {
      type: "select",
      selection: { kind: "node", key: p(4) },
    });
    nav = graphReducer(nav, { type: "collapse", id: "b" });
    expect(visibleGraph(graph, nav).nodes.map((n) => n.key)).toEqual([
      p(1),
      p(3),
      p(4),
    ]);
  });
  it("Back restores coordinates, pin, camera and selection rather than server records", () => {
    const initial = {
      ...initialNavigation(),
      focus: p(1),
      pins: [p(1)],
      positions: { [p(1)]: { x: 22, y: 33 } },
      camera: { x: 44, y: 55, k: 1.5 },
      listScroll: 140,
    };
    let nav = graphReducer(initial, { type: "focus", key: p(2) });
    nav = graphReducer(nav, { type: "pin", key: p(2) });
    nav = graphReducer(nav, { type: "camera", camera: { x: 0, y: 0, k: 1 } });
    nav = graphReducer(nav, { type: "back" });
    expect(nav).toMatchObject({
      focus: p(1),
      pins: [p(1)],
      positions: initial.positions,
      camera: initial.camera,
      listScroll: 140,
      history: [],
    });
  });
});

it("layout is deterministic, preserves existing coordinates on expansion and does not mutate canonical records", () => {
  const graph = workspaceGraph(frontendGraphFixture());
  const copy = structuredClone(graph);
  const first = { nodes: graph.nodes.slice(0, 4), edges: [] };
  const positions = placeGraph(first, {}, 960, 650);
  expect(placeGraph(first, {}, 960, 650)).toEqual(positions);
  const expanded = placeGraph(graph, positions, 960, 650);
  for (const node of first.nodes)
    expect(expanded[node.key]).toEqual(positions[node.key]);
  expect(graph).toEqual(copy);
});
