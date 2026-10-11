import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Sparkles,
  RefreshCw,
  ArrowUpRight,
  Loader2,
  AlertCircle,
  ChevronDown,
  ArrowRight,
  ContactRound,
  Plus,
} from "lucide-react";
import { MiniCalendar } from "./TaskFields.jsx";
import { Empty } from "./ui.jsx";
import { todayStr, todoInPeriod, timeOfDayMinutes } from "../domain/dates.js";
import { requestAI } from "../services/ai.js";

export function BriefingPanel({ people, todos, onEditTodo, onSelect }) {
  const [briefing, setBriefing] = useState(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(null);
  const today = todayStr();
  const context = people.map(({ id, name, job, company }) => ({
    id,
    name,
    job,
    company,
  }));
  const tasks = todos.map(
    ({ id, text, date, time, done, personId, type, importance }) => ({
      id,
      text,
      date,
      time,
      done,
      personId,
      type,
      importance,
    }),
  );
  const signature = JSON.stringify({ context, todos: tasks, today });
  const open = todos.filter((t) => !t.done);
  const overdue = open.filter((t) => t.date && t.date < today);
  const dueToday = open.filter((t) => t.date === today);
  const undated = open.filter((t) => !t.date);
  useEffect(() => () => abortRef.current?.abort(), []);
  async function generate() {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await requestAI(
        {
          task: "briefing",
          today,
          text: note,
          context,
          todos: tasks.filter((task) => !task.done),
        },
        { signal: controller.signal },
      );
      if (!controller.signal.aborted)
        setBriefing({
          ...response,
          signature,
          generatedAt: new Date().toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        });
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }
  const stale = briefing && briefing.signature !== signature;
  return (
    <section
      className="workspace-panel briefing-panel"
      aria-label="AI 업무 브리핑"
    >
      <div className="workspace-panel-title">
        <Sparkles size={19} />
        <div>
          <h2>AI 업무 브리핑</h2>
          <small>업무 우선순위와 연락할 인맥을 정리해요</small>
        </div>
      </div>
      <div className="briefing-body">
        <div className="briefing-metrics" aria-label="현재 업무 현황">
          <div>
            <span>오늘</span>
            <strong>{dueToday.length}</strong>
          </div>
          <div>
            <span>기한 지남</span>
            <strong>{overdue.length}</strong>
          </div>
          <div>
            <span>날짜 미정</span>
            <strong>{undated.length}</strong>
          </div>
        </div>
        <label className="briefing-request">
          브리핑 요청 <small>선택</small>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="예: 오늘 고객에게 연락할 업무부터 정리해줘"
          />
        </label>
        <button className="secondary-button" onClick={generate} disabled={busy}>
          {busy ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          {busy
            ? "브리핑 정리 중…"
            : briefing
              ? "브리핑 새로 만들기"
              : "업무 브리핑 만들기"}
        </button>
        {busy && (
          <button
            className="text-button"
            onClick={() => {
              abortRef.current?.abort();
              setBusy(false);
            }}
          >
            브리핑 생성 취소
          </button>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {!briefing && !busy && !error && (
          <p className="briefing-placeholder">
            저장된 할 일과 인맥을 바탕으로 요약합니다. 생성 버튼을 누르면 AI에
            요청해요.
          </p>
        )}
        {briefing && (
          <div className="briefing-result" aria-live="polite">
            <div className="briefing-result-meta">
              <span>
                {briefing.mode === "basic"
                  ? "저장된 업무 요약"
                  : "OpenAI 브리핑"}
              </span>
              <time>{briefing.generatedAt}</time>
            </div>
            {stale && (
              <p className="briefing-stale">
                <AlertCircle size={15} />
                기록이 변경됐어요. 최신 브리핑을 다시 만들어주세요.
              </p>
            )}
            <p className="briefing-summary">{briefing.result.summary}</p>
            <section>
              <h3>우선 처리할 업무</h3>
              {briefing.result.priorities.map(({ todoId, reason }, i) => {
                const todo = open.find((t) => t.id === todoId);
                return todo ? (
                  <button
                    className="briefing-row"
                    key={todoId}
                    onClick={() => onEditTodo(todo)}
                  >
                    <span className="briefing-rank">{i + 1}</span>
                    <span>
                      <strong>{todo.text}</strong>
                      <small>{reason}</small>
                    </span>
                    <ArrowUpRight size={15} />
                  </button>
                ) : null;
              })}
              {!briefing.result.priorities.some((p) =>
                open.some((t) => t.id === p.todoId),
              ) && <p className="muted">제안할 미완료 업무가 없습니다.</p>}
            </section>
            <section>
              <h3>인맥 후속 연락</h3>
              {briefing.result.followups.map(({ personId, suggestion }) => {
                const person = people.find((p) => p.id === personId);
                return person ? (
                  <button
                    className="briefing-row"
                    key={personId}
                    onClick={() => onSelect(personId)}
                  >
                    <span>
                      <strong>{person.name}</strong>
                      <small>{suggestion}</small>
                    </span>
                    <ArrowUpRight size={15} />
                  </button>
                ) : null;
              })}
              {!briefing.result.followups.some((f) =>
                people.some((p) => p.id === f.personId),
              ) && (
                <p className="muted">
                  현재 기록에서 후속 연락 제안이 없습니다.
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </section>
  );
}

export default function WorkManagement({
  people,
  todos,
  renderTodo,
  onAdd,
  onAssistantHost,
  focusSignal = 0,
  onEditTodo,
  onSelect,
  onCard,
}) {
  const [day, setDay] = useState(null);
  const [period, setPeriod] = useState("all");
  const [status, setStatus] = useState("open");
  const [mobileSelection, setMobileSelection] = useState({
    view: "work",
    signal: focusSignal,
  });
  const mobileView =
    mobileSelection.signal === focusSignal ? mobileSelection.view : "ai";
  const setMobileView = (view) =>
    setMobileSelection({ view, signal: focusSignal });
  const [calendarOpen, setCalendarOpen] = useState(false);
  function switchTab(event) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "work"
        : event.key === "End"
          ? "ai"
          : mobileView === "work"
            ? "ai"
            : "work";
    setMobileView(next);
    event.currentTarget.parentElement.querySelector(`#${next}-tab`).focus();
  }
  const today = todayStr();
  const remaining = todos.filter((t) => !t.done);
  const overdueCount = remaining.filter((t) => t.date && t.date < today).length;
  const todayCount = remaining.filter((t) => t.date === today).length;
  const undatedCount = remaining.filter((t) => !t.date).length;
  function choosePeriod(value) {
    setPeriod(value);
    setDay(null);
    setStatus("open");
    setMobileView("work");
  }
  const filtered = todos
    .filter(
      (t) =>
        (status === "all" || (status === "done" ? t.done : !t.done)) &&
        (day
          ? t.date === day
          : period === "overdue"
            ? t.date && t.date < today
            : period === "undated"
              ? !t.date
              : todoInPeriod(t, period)),
    )
    .sort(
      (a, b) =>
        (a.date || "9999").localeCompare(b.date || "9999") ||
        timeOfDayMinutes(a.time) - timeOfDayMinutes(b.time),
    );
  const groups = [
    [
      "overdue",
      "기한 지남",
      filtered.filter((t) => !t.done && t.date && t.date < today),
    ],
    ["today", "오늘", filtered.filter((t) => !t.done && t.date === today)],
    [
      "upcoming",
      "예정",
      filtered.filter((t) => !t.done && t.date && t.date > today),
    ],
    ["undated", "날짜 미정", filtered.filter((t) => !t.done && !t.date)],
    ["completed", "완료", filtered.filter((t) => t.done)],
  ].filter(([, , items]) => items.length);
  return (
    <div className="work-management-layout" data-mobile-view={mobileView}>
      <section className="work-overview" aria-label="오늘의 업무 요약">
        <div className="work-overview-intro">
          <span>
            {new Date(`${today}T12:00:00+09:00`).toLocaleDateString("ko-KR", {
              month: "long",
              day: "numeric",
              weekday: "long",
              timeZone: "Asia/Seoul",
            })}
          </span>
          <h2>
            {overdueCount
              ? "놓친 약속부터 챙겨볼까요?"
              : todayCount
                ? "오늘의 약속을 준비하세요"
                : "다음 만남을 준비하는 하루"}
          </h2>
          <p>
            {remaining.length
              ? `미완료 업무 ${remaining.length}건 · 기록된 약속과 후속 연락을 확인하세요.`
              : "명함과 만남을 남기면, 기억이 다음 행동으로 이어집니다."}
          </p>
        </div>
        <div className="work-overview-counts">
          {[
            ["today", "오늘", todayCount],
            ["overdue", "기한 지남", overdueCount],
            ["undated", "날짜 미정", undatedCount],
          ].map(([key, label, count]) => (
            <button
              key={key}
              className={key === "overdue" && count ? "needs-attention" : ""}
              aria-pressed={!day && period === key && status === "open"}
              onClick={() => choosePeriod(key)}
            >
              <span>{label}</span>
              <strong>
                {count}
                <small>건</small>
              </strong>
              <ArrowRight size={14} />
            </button>
          ))}
        </div>
      </section>
      {!people.length && (
        <section className="first-connection" aria-label="첫 관계 기록">
          <ContactRound size={24} />
          <div>
            <h2>첫 명함으로 시작하세요</h2>
            <p>명함 등록 → 만남 기록 → AI로 다시 찾기</p>
          </div>
          <button className="primary-button" onClick={onCard}>
            명함 등록하기 <ArrowRight size={16} />
          </button>
        </section>
      )}
      <div
        className="work-mobile-tabs"
        role="tablist"
        aria-label="업무 화면 선택"
      >
        <button
          id="work-tab"
          role="tab"
          tabIndex={mobileView === "work" ? 0 : -1}
          onKeyDown={switchTab}
          aria-selected={mobileView === "work"}
          aria-controls="work-pane"
          onClick={() => setMobileView("work")}
        >
          <CalendarDays size={17} />
          업무 <span>{remaining.length}</span>
        </button>
        <button
          id="ai-tab"
          role="tab"
          tabIndex={mobileView === "ai" ? 0 : -1}
          onKeyDown={switchTab}
          aria-selected={mobileView === "ai"}
          aria-controls="ai-pane"
          onClick={() => setMobileView("ai")}
        >
          <Sparkles size={17} />
          AI 어시스턴트
        </button>
      </div>
      <div
        className="work-calendar-todos"
        id="work-pane"
        aria-label="일정과 업무 목록"
      >
        <section
          className="workspace-panel work-calendar-card"
          aria-label="업무 캘린더"
        >
          <details
            open={calendarOpen}
            onToggle={(e) => setCalendarOpen(e.currentTarget.open)}
          >
            <summary className="workspace-panel-title">
              <CalendarDays size={19} />
              <div>
                <h2>업무 캘린더</h2>
                <small>날짜를 선택해 할 일을 확인하세요</small>
              </div>
              <ChevronDown size={16} className="calendar-chevron" />
            </summary>
            <MiniCalendar
              value={day}
              onChange={(d) => setDay(day === d ? null : d)}
              todos={todos}
            />
          </details>
        </section>
        <section
          className="workspace-panel work-todo-list"
          aria-label="해야 할 일"
        >
          <div className="work-quick-periods" aria-label="업무 빠른 필터">
            {[
              ["all", "전체", remaining.length],
              [
                "today",
                "오늘",
                remaining.filter((t) => t.date === today).length,
              ],
              [
                "overdue",
                "기한 지남",
                remaining.filter((t) => t.date && t.date < today).length,
              ],
            ].map(([key, label, count]) => (
              <button
                key={key}
                aria-pressed={!day && period === key && status === "open"}
                onClick={() => {
                  setPeriod(key);
                  setDay(null);
                  setStatus("open");
                }}
              >
                {label}
                <span>{count}</span>
              </button>
            ))}
          </div>
          <details className="work-filter-details">
            <summary>
              {day
                ? `${day} · `
                : {
                    tomorrow: "내일 · ",
                    week: "이번 주 · ",
                    month: "이번 달 · ",
                  }[period] || ""}
              기간·완료 필터
              {status === "done"
                ? " · 완료"
                : status === "all"
                  ? " · 모든 상태"
                  : ""}
            </summary>
            <div className="list-toolbar">
              <select
                aria-label="업무 기간"
                value={day ? "selected" : period}
                onChange={(e) => {
                  setDay(null);
                  setPeriod(e.target.value);
                }}
              >
                {day && <option value="selected">{day}</option>}
                {[
                  ["all", "전체"],
                  ["today", "오늘"],
                  ["tomorrow", "내일"],
                  ["week", "이번 주"],
                  ["month", "이번 달"],
                  ["overdue", "기한 지남"],
                  ["undated", "날짜 미정"],
                ].map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                aria-label="일정 상태"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="open">미완료 할 일</option>
                <option value="done">완료한 할 일</option>
                <option value="all">모든 상태</option>
              </select>
            </div>
          </details>
          <div className="schedule-heading">
            <h2>{day || (status === "done" ? "완료한 일정" : "해야 할 일")}</h2>
            <span>{filtered.length}건</span>
            <button
              className="icon-button"
              aria-label="목록에 할 일 추가"
              onClick={() => onAdd(day)}
            >
              <Plus size={17} />
            </button>
          </div>
          {(day || period !== "all" || status !== "open") && (
            <div className="active-task-filter">
              <span>
                {day ||
                  {
                    today: "오늘",
                    tomorrow: "내일",
                    week: "이번 주",
                    month: "이번 달",
                    overdue: "기한 지남",
                    undated: "날짜 미정",
                    all: "전체 기간",
                  }[period]}{" "}
                ·{" "}
                {status === "done"
                  ? "완료"
                  : status === "all"
                    ? "모든 상태"
                    : "미완료"}
              </span>
              <button onClick={() => choosePeriod("all")}>전체 보기</button>
            </div>
          )}
          <div className="work-todo-items cg-scroll">
            {groups.map(([key, label, items]) => (
              <section
                className={`work-task-group ${key}`}
                key={key}
                aria-label={`${label} 업무`}
              >
                <h3>
                  {day || label}
                  <span>{items.length}</span>
                </h3>
                {items.map((todo) => renderTodo(todo))}
              </section>
            ))}
            {!filtered.length && (
              <Empty
                title="일정이 없어요"
                description="날짜와 업무를 기록하고 다음 행동을 준비하세요."
                action={
                  <button
                    className="secondary-button"
                    onClick={() => onAdd(day)}
                  >
                    할 일 추가
                  </button>
                }
              />
            )}
          </div>
        </section>
      </div>
      <div className="work-ai-column" id="ai-pane" aria-label="AI 업무 지원">
        <div className="work-chat-host" ref={onAssistantHost} />
        <details className="work-briefing-details">
          <summary>
            <Sparkles size={17} />
            <span>AI 업무 브리핑</span>
            <ChevronDown size={16} />
          </summary>
          <BriefingPanel
            people={people}
            todos={todos}
            onEditTodo={onEditTodo}
            onSelect={onSelect}
          />
        </details>
      </div>
    </div>
  );
}
