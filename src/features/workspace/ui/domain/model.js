import { todayStr, validDate, normalizeTimeInput } from "./dates.js";
import { taskMeta } from "./task-options.js";
import {
  matchesRelationshipCategory,
  normalizeRelationshipCategories,
} from "./relationship-categories.js";

export const uid = () => crypto.randomUUID();
export const emptyState = () => ({
  people: [],
  meetings: [],
  edges: [],
  personLinks: [],
  todos: [],
  messages: [],
  appliedRequestIds: [],
  conflicts: [],
});
export const active = (item) => !item.deletedAt;
export function activeState(state) {
  const people = state.people.filter(active),
    meetings = state.meetings.filter(active);
  const pids = new Set(people.map((p) => p.id)),
    mids = new Set(meetings.map((m) => m.id));
  return {
    ...state,
    people,
    meetings,
    edges: state.edges.filter(
      (e) => active(e) && pids.has(e.personId) && mids.has(e.meetingId),
    ),
    personLinks: state.personLinks.filter(
      (l) => active(l) && pids.has(l.aId) && pids.has(l.bId),
    ),
    todos: state.todos.filter(
      (t) =>
        active(t) && (!t.personId || pids.has(t.personId) || t.legacyOrphan),
    ),
  };
}
export function selectGraph(
  state,
  {
    statusFilter,
    importanceFilter,
    placeFilter,
    categoryFilter = "all",
    year = null,
    month = null,
  } = {},
) {
  const live = activeState(state);
  const scoped =
    year != null || (placeFilter && Object.values(placeFilter).some((v) => !v));
  const meetings = live.meetings.filter(
    (m) =>
      (!placeFilter || placeFilter[m.placeType || "unclassified"]) &&
      (year == null ||
        (validDate(m.date) &&
          Number(m.date.slice(0, 4)) === year &&
          (month == null || Number(m.date.slice(5, 7)) === month))),
  );
  const mids = new Set(meetings.map((m) => m.id));
  const connected = new Set(
    live.edges.filter((e) => mids.has(e.meetingId)).map((e) => e.personId),
  );
  const hiddenReasons = {};
  const people = live.people.filter((p) => {
    const reasons = [];
    if (statusFilter && !statusFilter[p.status || "unclassified"])
      reasons.push("상태 필터");
    if (importanceFilter && !importanceFilter[p.importance || 3])
      reasons.push("중요도 필터");
    if (!matchesRelationshipCategory(p, categoryFilter))
      reasons.push("관계 용도 필터");
    if (scoped && !connected.has(p.id))
      reasons.push("선택한 날짜·장소에 맞는 만남 기록 없음");
    if (reasons.length) hiddenReasons[p.id] = reasons.join(", ");
    return !reasons.length;
  });
  const pids = new Set(people.map((p) => p.id));
  const edges = live.edges.filter(
    (e) => mids.has(e.meetingId) && pids.has(e.personId),
  );
  const categoryScoped =
    categoryFilter != null &&
    categoryFilter !== "all" &&
    !(Array.isArray(categoryFilter) && categoryFilter.includes("all")) &&
    !(typeof categoryFilter === "object" && categoryFilter.all);
  const visibleMeetingIds = new Set(edges.map((e) => e.meetingId));
  return {
    people,
    meetings: categoryScoped
      ? meetings.filter((m) => visibleMeetingIds.has(m.id))
      : meetings,
    edges,
    personLinks: live.personLinks.filter(
      (link) => pids.has(link.aId) && pids.has(link.bId),
    ),
    hiddenCount: live.people.length - people.length,
    hiddenReasons,
  };
}
export const selectPerson = (state, id) =>
  state.people.find((p) => p.id === id && active(p)) || null;
export const toggleTodo = (state, id) => ({
  ...state,
  todos: state.todos.map((t) =>
    t.id === id && active(t) ? { ...t, done: !t.done } : t,
  ),
});
export function patchPerson(state, id, patch) {
  if (patch.relationshipCategories !== undefined)
    patch = {
      ...patch,
      relationshipCategories: normalizeRelationshipCategories(
        patch.relationshipCategories,
      ),
    };
  return {
    ...state,
    people: state.people.map((p) =>
      p.id === id && active(p)
        ? {
            ...p,
            ...patch,
            fieldRevisions: {
              ...p.fieldRevisions,
              ...Object.fromEntries(
                Object.keys(patch).map((k) => [
                  k,
                  (p.fieldRevisions?.[k] || 0) + 1,
                ]),
              ),
            },
          }
        : p,
    ),
  };
}
export function setDeleted(
  state,
  collection,
  ids,
  deleted = true,
  now = new Date().toISOString(),
) {
  return {
    ...state,
    [collection]: state[collection].map((item) =>
      ids.includes(item.id)
        ? {
            ...item,
            deletedAt: deleted ? now : null,
            lifecycleRevision: (item.lifecycleRevision || 0) + 1,
          }
        : item,
    ),
  };
}
export function addTodo(
  state,
  { date, time, name, text, personIdOverride, type, importance },
  makeId = uid,
) {
  if (!text?.trim() || (date && !validDate(date)))
    throw new Error(
      "일정 내용과 유효한 날짜를 입력해주세요. 날짜는 비워둘 수 있습니다.",
    );
  const normalized = normalizeTimeInput(time);
  if (normalized === null)
    throw new Error(
      "시각은 00:00~23:59 또는 오전/오후 1:00~12:59로 입력해주세요.",
    );
  let person = personIdOverride ? selectPerson(state, personIdOverride) : null;
  if (personIdOverride && !person)
    throw new Error("삭제되었거나 없는 인맥입니다.");
  let next = state;
  if (!person && name?.trim()) {
    person = newPerson({ name: name.trim() }, makeId);
    next = { ...state, people: [...state.people, person] };
  }
  return {
    ...next,
    todos: [
      ...next.todos,
      {
        id: makeId("todo"),
        personId: person?.id || null,
        personName: person?.name || null,
        text: text.trim(),
        date: date || null,
        time: normalized || null,
        done: false,
        createdAt: todayStr(),
        ...taskMeta({ type, importance }),
      },
    ],
  };
}
export function newPerson(input, makeId = uid) {
  return {
    id: makeId("person"),
    name: input.name,
    job: input.job || null,
    phone: input.phone || null,
    email: input.email || null,
    importance: 3,
    status: "pending",
    history: [],
    createdAt: todayStr(),
    ...(input.company !== undefined ? { company: input.company || null } : {}),
    ...(input.relationshipCategories !== undefined
      ? {
          relationshipCategories: normalizeRelationshipCategories(
            input.relationshipCategories,
          ),
        }
      : {}),
  };
}
