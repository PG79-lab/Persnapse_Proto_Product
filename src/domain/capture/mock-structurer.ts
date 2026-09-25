import {
  captureDraftSchemaVersion,
  type CaptureDraftV1,
} from "./capture-draft";
import type { CaptureStructuringInput } from "./capture-workflow";

import { koreanDayRange } from "../recall/date-range";

const locations = [
  "코엑스",
  "벡스코",
  "판교",
  "성수",
  "강남",
  "광화문",
  "역삼",
  "선릉",
  "여의도",
  "부산",
  "서울",
];

const topicDictionary = [
  "AI Agent",
  "AI 에이전트",
  "물류 실증",
  "부산 물류",
  "SaaS",
  "투자",
  "파트너십",
  "사업개발",
  "데이터",
  "바이오",
  "모빌리티",
];

function firstMatch(value: string, expression: RegExp): string | null {
  return value.match(expression)?.[1]?.trim() || null;
}

function unique(values: Array<string | null>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function findDisplayName(rawText: string): string | null {
  return (
    firstMatch(
      rawText,
      /(?:이름|성함)\s*[:：]\s*([가-힣A-Za-z][가-힣A-Za-z ]{1,40})/u,
    ) ??
    firstMatch(rawText, /(?:의|와|과)\s*([가-힣]{2,4})(?=\s|을|를|과|와)/u) ??
    firstMatch(
      rawText,
      /([가-힣]{2,4})\s*(?:님|대표|이사|팀장|리드|매니저|담당자)/u,
    )
  );
}

function findOrganization(rawText: string, displayName: string | null) {
  const labeled = firstMatch(
    rawText,
    /(?:회사|소속|조직)\s*[:：]\s*([가-힣A-Za-z0-9&.\- ]{2,80})/u,
  );

  if (labeled) {
    return labeled;
  }

  if (displayName) {
    const escapedName = displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matched = firstMatch(
      rawText,
      new RegExp(
        `([가-힣A-Za-z0-9&.\\-]+(?:\\s+[가-힣A-Za-z0-9&.\\-]+){0,2})의\\s*${escapedName}`,
        "u",
      ),
    );
    const tokens = matched?.split(/\s+/u) ?? [];

    while (
      tokens.length > 1 &&
      /(?:에서|에서는|에는|오늘|어제)$/u.test(tokens[0])
    ) {
      tokens.shift();
    }

    return tokens.join(" ") || null;
  }

  return null;
}

function findTitle(rawText: string, displayName: string | null): string | null {
  const labeled = firstMatch(
    rawText,
    /(?:직책|역할)\s*[:：]\s*([가-힣A-Za-z0-9&.\- ]{2,60})/u,
  );

  if (labeled) {
    return labeled;
  }

  if (!displayName) {
    return null;
  }

  const escapedName = displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return firstMatch(
    rawText,
    new RegExp(
      `${escapedName}\\s*((?:사업개발\\s*)?(?:대표|이사|팀장|리드|매니저|담당자))`,
      "u",
    ),
  );
}

function findEvent(rawText: string): string | null {
  const matched = firstMatch(
    rawText,
    /([가-힣A-Za-z0-9&.\- ]{2,40}(?:포럼|밋업|컨퍼런스|행사|데모데이))/u,
  );

  return matched?.replace(/^\d{4}[.\-]\d{1,2}[.\-]\d{1,2}\s*/u, "") ?? null;
}

function findOccurredAt(rawText: string, referenceTime: string): string | null {
  const date = rawText.match(/\b(\d{4})[.-](\d{1,2})[.-](\d{1,2})\b/u);

  if (!date) {
    const relative = /어제/u.test(rawText)
      ? -1
      : /오늘/u.test(rawText)
        ? 0
        : null;
    return relative === null
      ? null
      : koreanDayRange(new Date(referenceTime), relative, "").from;
  }

  const [, year, month, day] = date;
  return new Date(
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T12:00:00+09:00`,
  ).toISOString();
}

function candidateSentences(rawText: string): string[] {
  return rawText
    .split(/(?<=[.!?。])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function structureTextCaptureMock(
  input: CaptureStructuringInput,
): CaptureDraftV1 {
  const rawText = input.rawText.trim();
  const displayName = findDisplayName(rawText);
  const organizationName = findOrganization(rawText, displayName);
  const title = findTitle(rawText, displayName);
  const eventName = findEvent(rawText);
  const location =
    locations.find((candidate) => rawText.includes(candidate)) ?? null;
  const occurredAt = findOccurredAt(rawText, input.referenceTime);
  const topics = unique(
    topicDictionary.map((topic) =>
      rawText
        .toLocaleLowerCase("ko-KR")
        .includes(topic.toLocaleLowerCase("ko-KR"))
        ? topic
        : null,
    ),
  ).slice(0, 12);
  const sentences = candidateSentences(rawText);
  const memorySentences = sentences
    .filter((sentence) => /관심|필요|찾고|원하|고민|중요/u.test(sentence))
    .slice(0, 4);
  const actionSentences = sentences
    .filter((sentence) => /보내|전달|연락|소개|공유|후속|약속/u.test(sentence))
    .slice(0, 4);
  const inferredFields = unique([
    occurredAt ? "interaction.occurredAt" : null,
    displayName ? "identityHint.displayName" : null,
    organizationName ? "identityHint.organizationName" : null,
    title ? "identityHint.title" : null,
    eventName ? "interaction.eventName" : null,
    location ? "interaction.location" : null,
    topics.length > 0 ? "topics" : null,
    memorySentences.length > 0 ? "memories" : null,
    actionSentences.length > 0 ? "actions" : null,
  ]);

  return {
    schemaVersion: captureDraftSchemaVersion,
    identityHint: {
      displayName,
      organizationName,
      title,
    },
    interaction: {
      interactionType: eventName ? "event" : "meeting",
      occurredAt,
      summary: rawText.slice(0, 2_000),
      location,
      eventName,
    },
    topics,
    memories: memorySentences.map((body) => ({
      statementType: /관심/u.test(body) ? "interest" : "context",
      body: body.slice(0, 1_000),
      occurredAt,
    })),
    actions: actionSentences.map((titleValue) => ({
      kind: /기로\s*했|약속/u.test(titleValue)
        ? ("commitment" as const)
        : ("follow_up" as const),
      title: titleValue.replace(/[.!?。]+$/u, "").slice(0, 240),
      details: null,
      dueAt: null,
    })),
    inferredFields,
  };
}
