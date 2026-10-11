import { useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Mail,
  Phone,
  Coffee,
  Users,
  FileText,
  Calendar,
} from "lucide-react";
import { todayStr, addDays, validDate } from "../domain/dates.js";
import { taskTypes } from "../domain/workspace.js";

const icons = {
  mail: Mail,
  call: Phone,
  coffee: Coffee,
  meeting: Users,
  material: FileText,
  general: Calendar,
};
export function MiniCalendar({ value, onChange, todos = [] }) {
  const [month, setMonth] = useState(() =>
    (validDate(value) ? value : todayStr()).slice(0, 7),
  );
  const [year, m] = month.split("-").map(Number);
  const offset = new Date(year, m - 1, 1, 12).getDay();
  const days = new Date(year, m, 0, 12).getDate();
  function move(n) {
    setMonth(new Date(Date.UTC(year, m - 1 + n, 1)).toISOString().slice(0, 7));
  }
  return (
    <div className="mini-calendar">
      <div className="section-heading">
        <button
          type="button"
          className="icon-button"
          aria-label="이전 달"
          onClick={() => move(-1)}
        >
          <ChevronLeft size={16} />
        </button>
        <strong>
          {year}년 {m}월
        </strong>
        <button
          type="button"
          className="icon-button"
          aria-label="다음 달"
          onClick={() => move(1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="calendar-grid">
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
          <span className="weekday" key={d}>
            {d}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = `${month}-${String(i + 1).padStart(2, "0")}`;
          return (
            <button
              type="button"
              key={day}
              aria-label={day}
              aria-pressed={value === day}
              className={`${value === day ? "selected" : ""} ${day === todayStr() ? "today" : ""}`}
              onClick={() => onChange(day)}
            >
              {i + 1}
              {todos.some((t) => t.date === day && !t.done) && <i />}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="text-button"
        onClick={() => {
          setMonth(todayStr().slice(0, 7));
          onChange(todayStr());
        }}
      >
        오늘로 이동
      </button>
    </div>
  );
}
export function ImportancePicker({ value, onChange, name = "importance" }) {
  return (
    <fieldset className="choice-field">
      <legend>중요도</legend>
      <div className="importance-choices">
        {["낮음", "관심", "보통", "중요", "매우 중요"].map((label, i) => (
          <button
            type="button"
            key={label}
            aria-pressed={Number(value) === i + 1}
            onClick={() => onChange(i + 1)}
          >
            {i + 1}
            <span>{label}</span>
          </button>
        ))}
      </div>
      <input type="hidden" name={name} value={value} />
    </fieldset>
  );
}
export default function TaskFields({
  todo = {},
  initialDate,
  compact = false,
}) {
  const [type, setType] = useState(todo.type || "general");
  const [date, setDate] = useState(todo.date || initialDate || "");
  const [time, setTime] = useState(todo.time || "");
  const [importance, setImportance] = useState(todo.importance || 3);
  const extraFields = (
    <details className="task-extra-fields" open={!compact}>
      <summary>
        유형·중요도 설정 <span>선택</span>
      </summary>
      <fieldset className="choice-field">
        <legend>할 일 유형</legend>
        <div className="type-choices">
          {Object.entries(taskTypes).map(([key, label]) => {
            const Icon = icons[key];
            return (
              <button
                type="button"
                key={key}
                aria-pressed={type === key}
                onClick={() => setType(key)}
              >
                <Icon size={17} />
                {label}
              </button>
            );
          })}
        </div>
        <input type="hidden" name="type" value={type} />
      </fieldset>
      <ImportancePicker value={importance} onChange={setImportance} />
    </details>
  );
  return (
    <>
      {!compact && extraFields}
      <section className="date-surface">
        <div className="section-heading">
          <strong>
            <CalendarDays size={17} /> 수행 날짜
          </strong>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setDate("");
              setTime("");
            }}
          >
            날짜 미정
          </button>
        </div>
        <div className="quick-choices">
          {[
            ["오늘", 0],
            ["내일", 1],
            ["일주일 뒤", 7],
          ].map(([label, n]) => (
            <button
              type="button"
              key={label}
              aria-pressed={date === addDays(todayStr(), n)}
              onClick={() => setDate(addDays(todayStr(), n))}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={compact ? "task-date-inputs" : ""}>
          <label>
            날짜
            <input
              type="date"
              name="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {!compact && (
            <MiniCalendar
              key={date?.slice(0, 7) || "undated"}
              value={date}
              onChange={setDate}
            />
          )}
          <label>
            시각
            <input
              name="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="오후 2:00"
            />
          </label>
        </div>
        <div className="quick-choices">
          {["오전 10:00", "오후 2:00", "오후 4:00", ""].map((t) => (
            <button
              type="button"
              key={t}
              aria-pressed={time === t}
              onClick={() => setTime(t)}
            >
              {t || "종일"}
            </button>
          ))}
        </div>
      </section>
      {compact && extraFields}
    </>
  );
}
