export function todayStr(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(y, m - 1, d);
  return (
    y >= 1 &&
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
}
export function addDays(value, days) {
  if (!validDate(value)) throw new Error("유효하지 않은 날짜입니다.");
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function normalizeTimeInput(raw) {
  if (!raw?.trim()) return "";
  const match = raw
    .trim()
    .match(/^(오전|오후|am|pm)?\s*(\d{1,2})\s*[:시]\s*(\d{1,2})?\s*분?$/i);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = Number(match[3] || 0);
  if (minute > 59 || hour > 23 || (match[1] && (hour < 1 || hour > 12)))
    return null;
  if (match[1]) hour = (hour % 12) + (/오후|pm/i.test(match[1]) ? 12 : 0);
  return `${hour >= 12 ? "오후" : "오전"} ${hour % 12 || 12}:${String(minute).padStart(2, "0")}`;
}
export function timeOfDayMinutes(value) {
  const normalized = normalizeTimeInput(value);
  if (!normalized) return -1;
  const [, period, hour, minute] = normalized.match(
    /^(오전|오후) (\d{1,2}):(\d{2})$/,
  );
  return (
    ((Number(hour) % 12) + (period === "오후" ? 12 : 0)) * 60 + Number(minute)
  );
}
export function todoInPeriod(
  todo,
  tab,
  today = todayStr(),
  selectedDate = today,
) {
  if (tab === "all") return true;
  if (!validDate(todo.date)) return false;
  if (tab === "today") return todo.date === selectedDate;
  if (tab === "tomorrow") return todo.date === addDays(today, 1);
  if (tab === "month") return todo.date.slice(0, 7) === today.slice(0, 7);
  const weekday = new Date(`${today}T12:00:00`).getDay();
  const monday = addDays(today, -(weekday + 6) % 7);
  return (
    tab === "week" && todo.date >= monday && todo.date <= addDays(monday, 6)
  );
}
export const meetingYear = (m) =>
  validDate(m?.date) ? Number(m.date.slice(0, 4)) : null;
export const meetingMonth = (m) =>
  validDate(m?.date) ? Number(m.date.slice(5, 7)) : null;
