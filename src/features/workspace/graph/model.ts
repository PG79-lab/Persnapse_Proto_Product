import type { WorkspaceState } from "../../../domain/workspace/contracts";

export type NodeKey = `person:${string}` | `interaction:${string}`;
export type GraphNode = {
  key: NodeKey;
  sourceId: string;
  kind: "person" | "interaction";
  label: string;
  subtitle: string;
  date: string | null;
};
export type GraphEdge = {
  key: string;
  from: NodeKey;
  to: NodeKey;
  kind: "attended" | "introduction_record";
  recordId: string;
};
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };
export type Selection =
  { kind: "node"; key: NodeKey } | { kind: "edge"; key: string } | null;
export type Point = { x: number; y: number };
export type Camera = Point & { k: number };
export type GraphFilter = {
  status: string;
  importance: string;
  place: string;
  month: string;
  category: string;
  year: string;
  includeUndated: boolean;
};
export type Expansion = {
  id: string;
  anchor: NodeKey;
  kind: GraphNode["kind"];
  keys: NodeKey[];
};
export type GraphFrame = {
  focus: NodeKey | null;
  selection: Selection;
  inspectorOpen: boolean;
  filters: GraphFilter;
  expansions: Expansion[];
  positions: Record<string, Point>;
  pins: NodeKey[];
  camera: Camera;
  presentation: "map" | "list";
  listScroll: number;
};
export type GraphNavigation = GraphFrame & {
  initialized: boolean;
  history: GraphFrame[];
  revision: number;
};
export const defaultFilters: GraphFilter = {
  status: "all",
  importance: "all",
  place: "all",
  month: "all",
  category: "all",
  year: "all",
  includeUndated: true,
};
export function initialNavigation(): GraphNavigation {
  return {
    focus: null,
    selection: null,
    inspectorOpen: false,
    filters: { ...defaultFilters },
    expansions: [],
    positions: {},
    pins: [],
    camera: { x: 0, y: 0, k: 1 },
    history: [],
    initialized: false,
    revision: 0,
    presentation: "map",
    listScroll: 0,
  };
}

// Never invent self, organization, event or topic IDs from names or profile strings.
export function workspaceGraph(state: WorkspaceState): Graph {
  const people = state.people.filter((p) => !p.deletedAt);
  const meetings = state.meetings.filter((m) => !m.deletedAt);
  const pids = new Set(people.map((p) => p.id)),
    mids = new Set(meetings.map((m) => m.id));
  return {
    nodes: [
      ...people.map((p) => ({
        key: `person:${p.id}` as NodeKey,
        sourceId: p.id,
        kind: "person" as const,
        label: p.name,
        subtitle: [p.company, p.job].filter(Boolean).join(" · "),
        date: null,
      })),
      ...meetings.map((m) => ({
        key: `interaction:${m.id}` as NodeKey,
        sourceId: m.id,
        kind: "interaction" as const,
        label: m.name,
        subtitle: m.date ?? "날짜 미정",
        date: m.date,
      })),
    ],
    edges: [
      ...state.edges
        .filter(
          (e) => !e.deletedAt && pids.has(e.personId) && mids.has(e.meetingId),
        )
        .map((e) => ({
          key: `attendance:${e.id}`,
          from: `person:${e.personId}` as NodeKey,
          to: `interaction:${e.meetingId}` as NodeKey,
          kind: "attended" as const,
          recordId: e.id,
        })),
      ...state.personLinks
        .filter((e) => pids.has(e.aId) && pids.has(e.bId))
        .map((e) => ({
          key: `introduction:${e.id}`,
          from: `person:${e.aId}` as NodeKey,
          to: `person:${e.bId}` as NodeKey,
          kind: "introduction_record" as const,
          recordId: e.id,
        })),
    ],
  };
}

export function filterGraph(
  graph: Graph,
  state: WorkspaceState,
  filters: GraphFilter,
): Graph {
  const allowedPeople = new Set(
    state.people
      .filter(
        (p) =>
          !p.deletedAt &&
          (filters.status === "all" || p.status === filters.status) &&
          (filters.importance === "all" ||
            p.importance === Number(filters.importance)) &&
          (filters.category === "all" ||
            (filters.category === "unclassified"
              ? !p.relationshipCategories.length
              : p.relationshipCategories.includes(filters.category as never))),
      )
      .map((p) => `person:${p.id}`),
  );
  const interactions = graph.nodes.filter(
    (n) =>
      n.kind === "interaction" &&
      (filters.place === "all" ||
        state.meetings.find((m) => m.id === n.sourceId)?.placeType ===
          filters.place) &&
      (n.date
        ? (filters.year === "all" || n.date.startsWith(filters.year + "-")) &&
          (filters.month === "all" ||
            Number(n.date.slice(5, 7)) === Number(filters.month))
        : filters.includeUndated),
  );
  const mids = new Set(interactions.map((n) => n.key));
  const connected = new Set(
    graph.edges
      .filter((e) => e.kind === "attended" && mids.has(e.to))
      .map((e) => e.from),
  );
  const people = graph.nodes.filter(
    (n) =>
      n.kind === "person" &&
      allowedPeople.has(n.key) &&
      ((filters.year === "all" &&
        filters.month === "all" &&
        filters.place === "all") ||
        connected.has(n.key)),
  );
  const pids = new Set(people.map((n) => n.key));
  const usedMeetings = new Set(
    graph.edges
      .filter((e) => e.kind === "attended" && pids.has(e.from))
      .map((e) => e.to),
  );
  const nodes = [
    ...people,
    ...interactions.filter(
      (n) =>
        (filters.status === "all" &&
          filters.category === "all" &&
          filters.importance === "all") ||
        usedMeetings.has(n.key),
    ),
  ];
  const ids = new Set(nodes.map((n) => n.key));
  return {
    nodes,
    edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
  };
}

export function neighbors(graph: Graph, key: NodeKey): NodeKey[] {
  return [
    ...new Set(
      graph.edges.flatMap((e) =>
        e.from === key ? [e.to] : e.to === key ? [e.from] : [],
      ),
    ),
  ];
}

export function visibleGraph(
  graph: Graph,
  nav: GraphNavigation,
): Graph & { hiddenCount: number } {
  const sorted = [...graph.nodes].sort(
    (a, b) =>
      (b.date ?? "").localeCompare(a.date ?? "") || a.key.localeCompare(b.key),
  );
  const nearby = nav.focus ? neighbors(graph, nav.focus) : [];
  const base = nav.focus
    ? [
        ...new Set([
          nav.focus,
          ...nearby,
          ...nearby.flatMap((key) => neighbors(graph, key)),
        ]),
      ].slice(0, 12)
    : sorted.slice(0, 20).map((n) => n.key);
  const keys = new Set<NodeKey>([
    ...base,
    ...nav.expansions.flatMap((e) => e.keys),
    ...nav.pins,
  ]);
  if (nav.selection?.kind === "node") keys.add(nav.selection.key);
  if (nav.selection?.kind === "edge") {
    const edge = graph.edges.find((e) => e.key === nav.selection?.key);
    if (edge) {
      keys.add(edge.from);
      keys.add(edge.to);
    }
  }
  const nodes = graph.nodes.filter((n) => keys.has(n.key));
  const visible = new Set(nodes.map((n) => n.key));
  return {
    nodes,
    edges: graph.edges.filter((e) => visible.has(e.from) && visible.has(e.to)),
    hiddenCount: graph.nodes.length - nodes.length,
  };
}

export type GraphAction =
  | { type: "initialize"; key: NodeKey | null }
  | { type: "select"; selection: Selection }
  | { type: "close" }
  | { type: "focus"; key: NodeKey | null }
  | { type: "filter"; filters: GraphFilter }
  | { type: "expand"; expansion: Expansion; revision: number }
  | { type: "collapse"; id: string }
  | { type: "back" }
  | { type: "layout"; positions: Record<string, Point> }
  | { type: "camera"; camera: Camera }
  | { type: "pin"; key: NodeKey }
  | { type: "presentation"; value: "map" | "list" }
  | { type: "scroll"; value: number };

function navigate(
  state: GraphNavigation,
  patch: Partial<GraphFrame>,
): GraphNavigation {
  const { history, revision, initialized, ...frame } = state;
  return {
    ...state,
    initialized,
    ...patch,
    history: [...history, frame].slice(-40),
    revision: revision + 1,
  };
}
export function graphReducer(
  state: GraphNavigation,
  action: GraphAction,
): GraphNavigation {
  switch (action.type) {
    case "initialize":
      return state.initialized
        ? state
        : { ...state, initialized: true, focus: action.key };
    case "select":
      return {
        ...state,
        selection: action.selection,
        inspectorOpen: action.selection !== null,
      };
    case "close":
      return { ...state, inspectorOpen: false };
    case "focus":
      return action.key === state.focus
        ? state
        : navigate(state, { focus: action.key, expansions: [] });
    case "filter":
      return JSON.stringify(state.filters) === JSON.stringify(action.filters)
        ? state
        : navigate(state, { filters: action.filters, expansions: [] });
    case "expand": {
      if (action.revision !== state.revision) return state;
      const old = state.expansions.find((e) => e.id === action.expansion.id);
      if (
        old &&
        JSON.stringify(old.keys) === JSON.stringify(action.expansion.keys)
      )
        return state;
      return navigate(state, {
        expansions: [
          ...state.expansions.filter((e) => e.id !== action.expansion.id),
          action.expansion,
        ],
      });
    }
    case "collapse":
      return state.expansions.some((e) => e.id === action.id)
        ? navigate(state, {
            expansions: state.expansions.filter((e) => e.id !== action.id),
          })
        : state;
    case "back": {
      const previous = state.history.at(-1);
      return previous
        ? {
            ...previous,
            initialized: true,
            history: state.history.slice(0, -1),
            revision: state.revision + 1,
          }
        : state;
    }
    case "layout":
      return { ...state, positions: action.positions };
    case "camera":
      return { ...state, camera: action.camera };
    case "pin":
      return {
        ...state,
        pins: state.pins.includes(action.key)
          ? state.pins.filter((k) => k !== action.key)
          : [...state.pins, action.key],
      };
    case "presentation":
      return { ...state, presentation: action.value };
    case "scroll":
      return { ...state, listScroll: action.value };
  }
}
