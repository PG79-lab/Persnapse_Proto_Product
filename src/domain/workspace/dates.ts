import { dateSchema, timeSchema } from "./contracts";

export function kstDate(value: Date | string | null): string | null {
  if (!value) return null;
  return new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
export function kstTime(value: Date | string | null): string | null {
  if (!value) return null;
  return new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(11, 16);
}
export function kstInstant(
  date: string | null,
  time: string | null = null,
): string | null {
  if (!date) {
    if (time) throw new Error("시각에는 날짜가 필요합니다.");
    return null;
  }
  dateSchema.parse(date);
  if (time) timeSchema.parse(time);
  return new Date(`${date}T${time ?? "00:00"}:00+09:00`).toISOString();
}
