import Link from "next/link";
import { connection } from "next/server";

import { AppShell } from "../../components/app-shell";
import type {
  RecallEvidenceType,
  RecallIntent,
  RecallResponse,
} from "../../domain/recall/types";
import { executeRecall } from "../../server/application/recall-service";
import { getServerEnv } from "../../server/env";

const suggestedQueries = [
  "부산 파일럿 제안서를 보내기로 한 사람",
  "코엑스 물류 실증 행사에서 만난 사람",
  "지난달 동남아 시장 리서치를 이야기한 사람",
  "김민준",
];

const intentLabels: Record<RecallIntent, string> = {
  action: "후속 행동",
  event: "행사",
  interaction: "상호작용",
  organization: "소속",
  person_lookup: "사람",
  place: "장소",
  recent: "최근",
  time: "시간",
  topic: "주제",
};

const evidenceLabels: Record<RecallEvidenceType, string> = {
  action_item: "저장된 행동",
  affiliation: "소속",
  event: "행사",
  interaction: "만남 기록",
  memory_statement: "관계 기억",
  person_profile: "프로필",
};

const occurredAtFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const dueAtFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
});

function firstSearchValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function ResultSummary({ response }: { response: RecallResponse }) {
  const statusLabel = {
    ambiguous: "구분 필요",
    no_result: "결과 없음",
    resolved: "근거로 찾음",
  }[response.status];
  const summaryClassName =
    response.status === "ambiguous"
      ? "mt-8 rounded-[2rem] border border-amber-300 bg-amber-50/80 p-6 sm:p-8"
      : "mt-8 rounded-[2rem] border border-[var(--border)] bg-white/80 p-6 sm:p-8";

  return (
    <>
      <section className={summaryClassName} aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="rounded-full bg-[var(--foreground)] px-3 py-1 text-xs font-semibold text-white">
            {statusLabel}
          </span>
          <span className="text-xs text-[var(--muted)]">
            {response.latencyMs}ms · 로컬 시맨틱 모드
          </span>
        </div>
        {response.status === "ambiguous" ? (
          <p className="mt-4 text-sm font-semibold text-amber-800">
            동명이인 구분이 필요합니다.
          </p>
        ) : null}
        <h2 className="mt-3 text-2xl leading-9 font-semibold tracking-[-0.03em]">
          {response.answer}
        </h2>
        <div className="mt-5 flex flex-wrap gap-2">
          {response.parsedQuery.intents.map((intent) => (
            <span
              key={intent}
              className="rounded-full border border-[var(--border)] bg-white/70 px-3 py-1 text-xs text-[var(--muted)]"
            >
              {intentLabels[intent]}
            </span>
          ))}
          {response.parsedQuery.dateRange ? (
            <span className="rounded-full border border-[var(--border)] bg-white/70 px-3 py-1 text-xs text-[var(--muted)]">
              {response.parsedQuery.dateRange.label}
            </span>
          ) : null}
        </div>
      </section>

      {response.results.length > 0 ? (
        <ol className="mt-6 space-y-5">
          {response.results.map((result, index) => (
            <li
              key={result.personId}
              className="rounded-[2rem] border border-[var(--border)] bg-[var(--surface)]/90 p-6 shadow-[0_18px_55px_rgba(24,45,32,0.05)] sm:p-8"
            >
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="flex items-start gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-sm font-semibold text-[var(--accent)]">
                    {index + 1}
                  </span>
                  <div>
                    <Link
                      href={`/people/${result.personId}`}
                      className="text-2xl font-semibold tracking-[-0.03em] hover:text-[var(--accent)]"
                    >
                      {result.displayName}
                    </Link>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {result.headline ?? "역할 확인 중"}
                    </p>
                    {result.organizations.length > 0 ? (
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        {result.organizations.join(" · ")}
                      </p>
                    ) : null}
                  </div>
                </div>
                <span className="rounded-full bg-[var(--confirmed-soft)] px-3 py-1 text-xs font-medium text-[var(--confirmed)]">
                  확인된 근거 {result.evidence.length}개
                </span>
              </div>

              <p className="mt-5 rounded-2xl bg-[var(--background)] p-4 text-sm leading-6">
                {result.reason}
              </p>

              <section className="mt-6">
                <h3 className="text-xs font-semibold tracking-[0.14em] text-[var(--accent)] uppercase">
                  Evidence
                </h3>
                <ul className="mt-3 grid gap-3 lg:grid-cols-3">
                  {result.evidence.map((evidence) => (
                    <li
                      key={`${evidence.type}-${evidence.id}`}
                      className="rounded-2xl border border-[var(--border)] bg-white/70 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-[var(--accent)]">
                          확인된 근거 · {evidenceLabels[evidence.type]}
                        </span>
                        {evidence.occurredAt ? (
                          <time className="text-[var(--muted)]">
                            {occurredAtFormatter.format(
                              new Date(evidence.occurredAt),
                            )}
                          </time>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm leading-6">
                        {evidence.excerpt}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>

              <div className="mt-6 grid gap-4 border-t border-[var(--border)] pt-6 lg:grid-cols-2">
                <section className="rounded-2xl bg-[var(--foreground)] p-5 text-white">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">저장된 다음 행동</h3>
                    <span className="text-[11px] text-white/60">
                      실행하지 않음
                    </span>
                  </div>
                  {result.storedActions.length > 0 ? (
                    <ul className="mt-4 space-y-3">
                      {result.storedActions.map((action) => (
                        <li
                          key={action.id}
                          className="border-t border-white/15 pt-3 first:border-0 first:pt-0"
                        >
                          <p className="text-sm font-medium">{action.title}</p>
                          {action.dueAt ? (
                            <p className="mt-1 text-xs text-white/60">
                              {dueAtFormatter.format(new Date(action.dueAt))}
                              까지
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-white/60">
                      저장된 열린 행동이 없습니다.
                    </p>
                  )}
                </section>

                <section className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--background)] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">AI가 제안한 후속</h3>
                    <span className="text-[11px] text-[var(--draft)]">
                      제안 · 미실행
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-medium">
                    {result.suggestion.title}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                    {result.suggestion.rationale} 제안만 하며 자동 실행하지
                    않습니다.
                  </p>
                </section>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}

export default async function RecallPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  await connection();
  const query = firstSearchValue((await searchParams).q).trim();
  const environment = getServerEnv();
  const response =
    query.length >= 2
      ? await executeRecall({
          workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
          queryText: query,
        })
      : null;

  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-16">
        <section className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold text-[var(--accent)]">Recall</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
            관계 기억에서 다시 찾기
          </h1>
          <p className="mx-auto mt-5 max-w-2xl leading-7 text-[var(--muted)]">
            이름이 기억나지 않아도 장소, 행사, 대화 주제나 약속으로 찾아보세요.
            확인된 기록만 근거로 답합니다.
          </p>

          <form
            action="/recall"
            method="get"
            className="mt-8 flex rounded-2xl border border-[var(--border-strong)] bg-white p-2 shadow-[0_20px_70px_rgba(24,45,32,0.08)] focus-within:border-[var(--accent)]"
          >
            <label htmlFor="recall-query" className="sr-only">
              관계 기억 검색
            </label>
            <input
              id="recall-query"
              name="q"
              defaultValue={query}
              minLength={2}
              maxLength={500}
              placeholder="예: 부산 파일럿 제안서를 보내기로 한 사람"
              className="min-w-0 flex-1 bg-transparent px-4 py-3 text-base outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-xl bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5"
            >
              기억 찾기
            </button>
          </form>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {suggestedQueries.map((suggestion) => (
              <Link
                key={suggestion}
                href={{ pathname: "/recall", query: { q: suggestion } }}
                className="rounded-full border border-[var(--border)] bg-white/65 px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {suggestion}
              </Link>
            ))}
          </div>
        </section>

        {query.length === 1 ? (
          <p className="mt-8 text-center text-sm text-[var(--draft)]">
            두 글자 이상 입력해 주세요.
          </p>
        ) : null}
        {response ? <ResultSummary response={response} /> : null}
      </main>
    </AppShell>
  );
}
