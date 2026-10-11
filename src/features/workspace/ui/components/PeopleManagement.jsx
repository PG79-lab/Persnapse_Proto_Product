import { useMemo, useState } from "react";
import { ArrowUpRight, Plus, Search, ContactRound, X } from "lucide-react";
import { Avatar, Status, statuses, Empty } from "./ui.jsx";
import {
  relationshipCategories,
  personCategories,
} from "../domain/relationship-categories.js";
import { todayStr, timeOfDayMinutes } from "../domain/dates.js";

export default function PeopleManagement({
  people,
  state,
  selectedId,
  onSelect,
  onAdd,
  onCard,
}) {
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [followupOnly, setFollowupOnly] = useState(false);
  const pendingPeople = new Set(
    state.todos.filter((task) => !task.done).map((task) => task.personId),
  );
  const filtered = people.filter(
    (p) =>
      (status === "all" || p.status === status) &&
      (category === "all" || personCategories(p).includes(category)) &&
      (!followupOnly || pendingPeople.has(p.id)) &&
      [p.name, p.company, p.job, p.email, p.phone]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const context = useMemo(() => {
    const entries = new Map(
      people.map((p) => [p.id, { meetings: [], tasks: [] }]),
    );
    const meetings = new Map(state.meetings.map((m) => [m.id, m]));
    for (const edge of state.edges) {
      const entry = entries.get(edge.personId),
        meeting = meetings.get(edge.meetingId);
      if (entry && meeting && (!meeting.date || meeting.date <= todayStr()))
        entry.meetings.push(meeting);
    }
    for (const task of state.todos)
      if (!task.done) entries.get(task.personId)?.tasks.push(task);
    for (const entry of entries.values()) {
      entry.meetings.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      entry.tasks.sort(
        (a, b) =>
          (a.date || "9999").localeCompare(b.date || "9999") ||
          timeOfDayMinutes(a.time) - timeOfDayMinutes(b.time),
      );
    }
    return entries;
  }, [people, state]);
  return (
    <section className="content-card" aria-label="인맥 관리 목록">
      <div className="people-discovery">
        <label className="inline-search">
          <Search size={18} />
          <input
            aria-label="인맥 목록 검색"
            placeholder="이름, 회사, 연락처로 찾기"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button aria-label="인맥 검색 초기화" onClick={() => setQuery("")}>
              <X size={16} />
            </button>
          )}
        </label>
        <button
          className="followup-toggle"
          aria-pressed={followupOnly}
          onClick={() => setFollowupOnly(!followupOnly)}
        >
          후속 업무 있는 인맥{" "}
          <span>{people.filter((p) => pendingPeople.has(p.id)).length}</span>
        </button>
        <button className="secondary-button" onClick={onCard}>
          <ContactRound size={16} />
          명함으로 추가
        </button>
      </div>
      <div className="list-toolbar">
        <div className="filter-pills">
          <button
            aria-pressed={status === "all"}
            className={status === "all" ? "active" : ""}
            onClick={() => setStatus("all")}
          >
            전체
          </button>
          {Object.entries(statuses).map(([key, s]) => (
            <button
              key={key}
              className={status === key ? "active" : ""}
              aria-pressed={status === key}
              onClick={() => setStatus(key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <select
          aria-label="인맥 관계 용도"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="all">모든 용도</option>
          {Object.entries(relationshipCategories).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <span className="muted">{filtered.length}명의 인맥</span>
      </div>
      <div className="people-table">
        <div className="people-table-heading">
          <span>인맥</span>
          <span>관계 상태</span>
          <span>최근 만남</span>
          <span>다음 할 일</span>
          <span />
        </div>
        {filtered.map((p) => {
          const { meetings, tasks } = context.get(p.id);
          const meeting = meetings[0],
            task = tasks[0];
          return (
            <button
              className={`people-table-row ${selectedId === p.id ? "is-selected" : ""}`}
              key={p.id}
              onClick={(e) =>
                onSelect(
                  p.id,
                  e.target.closest(".person-next-task") ? "tasks" : "activity",
                )
              }
            >
              <span className="person-cell">
                <Avatar person={p} />
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {[p.company, p.job].filter(Boolean).join(" · ") ||
                      "직함 미입력"}
                  </small>
                  <span className="people-category-labels">
                    {personCategories(p)
                      .map((k) => relationshipCategories[k])
                      .join(" · ") || "용도 미분류"}
                  </span>
                </span>
              </span>
              <Status value={p.status} />
              <span className="person-recent-meeting">
                <strong>{meeting?.name || "만남 기록 없음"}</strong>
                <small>
                  {meeting
                    ? meeting.date || "날짜 미정"
                    : "프로필에서 기록을 확인하세요"}
                </small>
              </span>
              <span className="person-next-task">
                <strong>{task?.text || "예정된 할 일 없음"}</strong>
                <small
                  className={
                    task?.date && task.date < todayStr() ? "overdue" : ""
                  }
                >
                  {task
                    ? `${task.date === todayStr() ? "오늘" : task.date || "날짜 미정"}${task.time ? ` · ${task.time}` : ""}`
                    : p.email || p.phone || "연락처 미등록"}
                </small>
              </span>
              <ArrowUpRight size={17} />
            </button>
          );
        })}
      </div>
      {!filtered.length && (
        <Empty
          title={
            status !== "all" || category !== "all" || query || followupOnly
              ? "조건에 맞는 인맥이 없어요"
              : "아직 인맥이 없어요"
          }
          description={
            status !== "all" || category !== "all" || query || followupOnly
              ? "검색어나 필터를 바꾸어 확인해보세요. 저장된 인맥은 유지됩니다."
              : "새로운 인맥을 추가하거나 다른 검색어로 찾아보세요."
          }
          action={
            status !== "all" || category !== "all" || query || followupOnly ? (
              <button
                className="secondary-button"
                onClick={() => {
                  setStatus("all");
                  setCategory("all");
                  setQuery("");
                  setFollowupOnly(false);
                }}
              >
                필터 초기화
              </button>
            ) : (
              <button className="primary-button" onClick={onAdd}>
                <Plus size={15} />
                인맥 추가
              </button>
            )
          }
        />
      )}
    </section>
  );
}
