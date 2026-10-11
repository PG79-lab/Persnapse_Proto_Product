import { newPerson, uid, active } from "./model.js";
import { validDate, todayStr, normalizeTimeInput } from "./dates.js";
import { taskMeta } from "./task-options.js";

export function addPerson(state, input, makeId = uid) {
  if (!input.name?.trim()) throw new Error("이름을 입력해주세요.");
  const person = newPerson({ ...input, name: input.name.trim() }, makeId);
  return { ...state, people: [...state.people, person] };
}
export function meetingEditorDefaults(state, meeting, today = todayStr()) {
  const livePeople = new Set(
    state.people.filter(active).map((person) => person.id),
  );
  const archivedPeople = new Set(
    state.people.filter((person) => !active(person)).map((person) => person.id),
  );
  return {
    date: meeting ? meeting.date || "" : today,
    personIds: meeting
      ? [
          ...new Set(
            state.edges
              .filter(
                (edge) =>
                  active(edge) &&
                  edge.meetingId === meeting.id &&
                  livePeople.has(edge.personId),
              )
              .map((edge) => edge.personId),
          ),
        ]
      : [],
    preservedPersonIds: meeting
      ? [
          ...new Set(
            state.edges
              .filter(
                (edge) =>
                  active(edge) &&
                  edge.meetingId === meeting.id &&
                  archivedPeople.has(edge.personId),
              )
              .map((edge) => edge.personId),
          ),
        ]
      : [],
  };
}
export function saveMeeting(state, input, id = null, newId = uid("meeting")) {
  if (!input.name?.trim() || (input.date && !validDate(input.date)))
    throw new Error("만남 이름과 날짜를 확인해주세요.");
  if (id && !state.meetings.some((m) => m.id === id && active(m)))
    throw new Error("만남이 삭제되었습니다.");
  const previous = id ? state.meetings.find((m) => m.id === id) : null;
  const ids = [...new Set(input.personIds || [])];
  const archivedPeople = new Set(
    state.people.filter((person) => !active(person)).map((person) => person.id),
  );
  const hasPreservedAttendance = Boolean(
    id &&
    state.edges.some(
      (edge) =>
        edge.meetingId === id &&
        active(edge) &&
        archivedPeople.has(edge.personId),
    ),
  );
  const guests =
    input.guests === undefined
      ? previous?.guests || []
      : normalizeGuests(input.guests);
  if (
    (!ids.length && !guests.length && !hasPreservedAttendance) ||
    ids.some((id) => !state.people.some((p) => p.id === id && active(p)))
  )
    throw new Error("함께한 인맥을 선택하거나 게스트 이름을 입력해주세요.");
  const meeting = {
    id: id || newId,
    name: input.name.trim(),
    date: input.date || null,
    placeType: input.placeType || "unclassified",
    ...(input.guests !== undefined ? { guests } : {}),
  };
  for (const key of ["eventUrl", "imageUrl", "imageSourceUrl"]) {
    if (input[key] !== undefined)
      meeting[key] = normalizeMeetingUrl(input[key]);
  }
  if (input.description !== undefined) {
    if (
      typeof input.description !== "string" ||
      input.description.length > 2000
    )
      throw new Error("만남 설명은 2,000자 이내로 입력해주세요.");
    meeting.description = input.description.trim();
  }
  const existing = state.edges.filter((e) => e.meetingId === meeting.id);
  const edges = state.edges.map((e) =>
    e.meetingId !== meeting.id || archivedPeople.has(e.personId)
      ? e
      : {
          ...e,
          deletedAt: ids.includes(e.personId) ? null : new Date().toISOString(),
        },
  );
  for (const personId of ids)
    if (!existing.some((e) => e.personId === personId))
      edges.push({ id: uid("attendance"), personId, meetingId: meeting.id });
  return {
    ...state,
    meetings: id
      ? state.meetings.map((m) => (m.id === id ? { ...m, ...meeting } : m))
      : [...state.meetings, meeting],
    edges,
  };
}
function normalizeGuests(value) {
  const names = typeof value === "string" ? value.split(/\r?\n/) : value;
  if (
    !Array.isArray(names) ||
    names.some((name) => typeof name !== "string" || name.trim().length > 100)
  )
    throw new Error("게스트 이름은 한 명씩, 100자 이내로 입력해주세요.");
  const guests = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (guests.length > 50)
    throw new Error("게스트는 최대 50명까지 입력할 수 있습니다.");
  return guests;
}
function normalizeMeetingUrl(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("행사·이미지 주소를 확인해주세요.");
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      throw new Error("invalid url");
    return url.href;
  } catch {
    throw new Error(
      "행사·이미지 주소는 https://로 시작하는 공개 주소를 입력해주세요.",
    );
  }
}
export function editTodo(state, id, input) {
  if (!input.text?.trim() || (input.date && !validDate(input.date)))
    throw new Error("일정 내용과 날짜를 확인해주세요.");
  const time = normalizeTimeInput(input.time);
  if (time === null) throw new Error("올바른 시각을 입력해주세요.");
  return {
    ...state,
    todos: state.todos.map((t) =>
      t.id === id && active(t)
        ? {
            ...t,
            text: input.text.trim(),
            date: input.date || null,
            time: time || null,
            ...taskMeta({
              type: input.type || t.type,
              importance: input.importance || t.importance,
            }),
          }
        : t,
    ),
  };
}
export function addNote(state, personId, text, id = uid("history")) {
  if (!text.trim()) return state;
  if (state.people.some((p) => p.history.some((h) => h.id === id)))
    return state;
  return {
    ...state,
    people: state.people.map((p) =>
      p.id === personId && active(p)
        ? {
            ...p,
            history: [
              { id, text: text.trim(), date: todayStr() },
              ...p.history,
            ],
          }
        : p,
    ),
  };
}
