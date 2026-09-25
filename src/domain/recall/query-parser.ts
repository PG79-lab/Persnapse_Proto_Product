import type { ParsedRecallQuery, RecallDateRange, RecallIntent } from "./types";

import { koreanDayRange } from "./date-range";

const stopWords = new Set([
  "그",
  "내가",
  "누구",
  "누구였지",
  "다시",
  "만난",
  "사람",
  "사람은",
  "사람을",
  "이야기",
  "이야기한",
  "했던",
  "한",
  "찾아줘",
  "알려줘",
]);

const suffixes = [
  "에서는",
  "에서",
  "으로",
  "에게",
  "하고",
  "이랑",
  "까지",
  "부터",
  "처럼",
  "보다",
  "에는",
  "라고",
  "이라고",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "와",
  "과",
  "에",
  "도",
  "의",
  "로",
];

export function normalizeRecallText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stripKoreanSuffix(value: string): string {
  for (const suffix of suffixes) {
    if (value.endsWith(suffix) && value.length - suffix.length >= 2) {
      return value.slice(0, -suffix.length);
    }
  }

  return value;
}

function koreanYearMonth(referenceTime: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
  }).formatToParts(referenceTime);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
}

function monthRange(
  year: number,
  month: number,
  label: string,
): RecallDateRange {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const twoDigits = (value: number) => String(value).padStart(2, "0");

  return {
    from: new Date(
      `${year}-${twoDigits(month)}-01T00:00:00+09:00`,
    ).toISOString(),
    to: new Date(
      `${nextYear}-${twoDigits(nextMonth)}-01T00:00:00+09:00`,
    ).toISOString(),
    label,
  };
}

function parseDateRange(
  query: string,
  referenceTime: Date,
): RecallDateRange | null {
  if (/오늘/u.test(query)) return koreanDayRange(referenceTime, 0, "오늘");
  if (/어제/u.test(query)) return koreanDayRange(referenceTime, -1, "어제");
  const explicitYearMonth = query.match(/(\d{4})년\s*(\d{1,2})월/u);

  if (explicitYearMonth) {
    const year = Number(explicitYearMonth[1]);
    const month = Number(explicitYearMonth[2]);

    if (month >= 1 && month <= 12) {
      return monthRange(year, month, `${year}년 ${month}월`);
    }
  }

  const reference = koreanYearMonth(referenceTime);

  if (/지난달/u.test(query)) {
    const month = reference.month === 1 ? 12 : reference.month - 1;
    const year = reference.month === 1 ? reference.year - 1 : reference.year;
    return monthRange(year, month, "지난달");
  }

  const monthOnly = query.match(/(?:^|\s)(\d{1,2})월(?:\s|$)/u);

  if (monthOnly) {
    const month = Number(monthOnly[1]);
    if (month >= 1 && month <= 12) {
      return monthRange(reference.year, month, `${month}월`);
    }
  }

  return null;
}

function detectIntents(query: string, hasDateRange: boolean): RecallIntent[] {
  const intents = new Set<RecallIntent>(["person_lookup"]);

  if (/행사|포럼|밋업|데모데이|partnership day|connect/u.test(query)) {
    intents.add("event");
  }
  if (/관심|주제|분야|데이터|투자|물류|바이오/u.test(query)) {
    intents.add("topic");
  }
  if (
    /코엑스|벡스코|판교|성수|강남|광화문|역삼|선릉|여의도|을지로/u.test(query)
  ) {
    intents.add("place");
  }
  if (/회사|소속|벤처스|모빌리티|파트너스|랩/u.test(query)) {
    intents.add("organization");
  }
  if (/마지막|최근/u.test(query)) {
    intents.add("recent");
  }
  if (/만남|미팅|통화|메시지|이야기|논의/u.test(query)) {
    intents.add("interaction");
  }
  if (/연락|후속|약속|보내|전달|해야|제안서|연결/u.test(query)) {
    intents.add("action");
  }
  if (hasDateRange) {
    intents.add("time");
  }

  return [...intents];
}

export function parseRecallQuery(
  query: string,
  referenceTime: Date,
): ParsedRecallQuery {
  const normalizedQuery = normalizeRecallText(query);
  const dateRange = parseDateRange(normalizedQuery, referenceTime);
  const terms = [
    ...new Set(
      normalizedQuery
        .split(" ")
        .map(stripKoreanSuffix)
        .filter((term) => term.length >= 2 && !stopWords.has(term))
        .filter((term) => !/^\d{1,4}년?$/u.test(term))
        .filter((term) => !/^\d{1,2}월$/u.test(term))
        .filter((term) => !["지난달", "오늘", "어제"].includes(term)),
    ),
  ];

  return {
    normalizedQuery,
    terms,
    intents: detectIntents(normalizedQuery, Boolean(dateRange)),
    dateRange,
    parserVersion: "structured-v1",
  };
}
