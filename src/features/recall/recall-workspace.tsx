"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import type {
  RecallEvidenceType,
  RecallIntent,
  RecallResponse,
} from "../../domain/recall/types";
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
            {response.latencyMs}ms ·{" "}
            {response.mode === "live"
              ? "AI 회상"
              : "기본 검색 · AI 분석 미사용"}
          </span>
        </div>
        {response.status === "ambiguous" ? (
          <p className="mt-4 text-sm font-semibold text-amber-800">
            {response.clarification ?? "인물을 구분할 정보가 더 필요합니다."}
          </p>
        ) : null}
        <h2 className="mt-3 text-2xl leading-9 font-semibold tracking-[-0.03em]">
          {response.answer}
        </h2>
        {response.analysis ? (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-7">
            <strong>판단 이유</strong>
            <br />
            {response.analysis}
          </p>
        ) : null}
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
                  답변의 근거
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

                {result.suggestion ? (
                  <section className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--background)] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">
                        {result.suggestion.type === "ai_suggestion"
                          ? "AI가 제안한 다음 행동"
                          : "후속 연락 안내"}
                      </h3>
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
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}

export function RecallWorkspace({
  initialQuery = "",
}: {
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [response, setResponse] = useState<RecallResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const [reason, setReason] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setResponse(null);
    setFeedback("");
    setReason("");
    setFeedbackError("");
    setElapsed(null);
    const started = performance.now();
    try {
      const result = await fetch("/api/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(70000),
      });
      const payload = await result.json();
      if (!result.ok)
        throw new Error(payload.error ?? "검색을 완료하지 못했습니다.");
      setResponse(payload as RecallResponse);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const elapsedMs = Math.round(performance.now() - started);
          setElapsed(elapsedMs);
          if (payload.queryId)
            void fetch("/api/recall/observation", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ queryId: payload.queryId, elapsedMs }),
            }).catch(() => {});
        }),
      );
    } catch (err) {
      setError(
        err instanceof Error && err.name !== "TimeoutError"
          ? err.message
          : "응답이 지연되고 있습니다. 입력은 유지되었습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function sendFeedback(
    kind: "helpful" | "not_helpful" | "wrong_person",
  ) {
    if (!response?.queryId || feedbackBusy) return;
    setFeedbackBusy(true);
    setFeedbackError("");
    try {
      const result = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queryId: response.queryId,
          kind,
          comment: reason || null,
          elapsedMs: elapsed,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) throw new Error();
      setFeedback("평가를 남겼습니다. 감사합니다.");
    } catch {
      setFeedbackError("평가를 저장하지 못했습니다. 다시 시도할 수 있습니다.");
    } finally {
      setFeedbackBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-5xl">
      <p className="text-sm font-semibold text-[var(--accent)]">관계 기억</p>
      <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">
        기억을 찾고, 다음 행동으로
      </h1>
      <p className="mt-4 text-[var(--muted)]">
        이름이 기억나지 않아도 만난 장소, 대화 주제나 약속으로 질문해 보세요.
      </p>
      <form onSubmit={submit} className="mt-7 flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="recall-query">
          관계 기억 검색
        </label>
        <input
          id="recall-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          required
          minLength={2}
          maxLength={500}
          placeholder="예: 지난달 행사에서 만난 AI 투자자 누구였지?"
          className="min-w-0 flex-1 rounded-xl border border-[var(--border-strong)] bg-white p-4"
        />
        <button
          disabled={busy}
          className="rounded-xl bg-[var(--foreground)] px-6 py-3 text-white disabled:opacity-50"
        >
          {busy ? "기억 확인 중…" : "기억 찾기"}
        </button>
      </form>
      <div className="mt-4 flex flex-wrap gap-2">
        {suggestedQueries.map((item) => (
          <button
            key={item}
            disabled={busy}
            onClick={() => setQuery(item)}
            className="rounded-full border border-[var(--border)] px-3 py-2 text-xs"
          >
            {item}
          </button>
        ))}
      </div>
      {busy ? (
        <p role="status" className="mt-6">
          질문과 관련된 기록을 찾아 근거를 확인하고 있습니다.
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-900"
        >
          {error}
        </p>
      ) : null}
      {response ? (
        <>
          <ResultSummary response={response} />
          {elapsed !== null ? (
            <p className="mt-4 text-xs text-[var(--muted)]">
              질문 제출부터 결과 표시까지 {(elapsed / 1000).toFixed(1)}초
            </p>
          ) : null}
          {response.queryId ? (
            <section
              className="mt-6 rounded-2xl border border-[var(--border)] p-5"
              aria-label="답변 평가"
            >
              <h2 className="font-semibold">
                필요한 기억을 찾는 데 도움이 되었나요?
              </h2>
              {feedback ? (
                <p role="status" className="mt-3">
                  {feedback}
                </p>
              ) : (
                <>
                  <label className="mt-3 block text-sm">
                    이유 (선택)
                    <input
                      value={reason}
                      maxLength={1000}
                      onChange={(e) => setReason(e.target.value)}
                      className="mt-2 block w-full rounded-lg border p-3"
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button
                      disabled={feedbackBusy}
                      onClick={() => void sendFeedback("helpful")}
                      className="rounded-lg border px-4 py-2"
                    >
                      도움이 됐어요
                    </button>
                    <button
                      disabled={feedbackBusy}
                      onClick={() => void sendFeedback("wrong_person")}
                      className="rounded-lg border px-4 py-2"
                    >
                      다른 사람이에요
                    </button>
                    <button
                      disabled={feedbackBusy}
                      onClick={() => void sendFeedback("not_helpful")}
                      className="rounded-lg border px-4 py-2"
                    >
                      도움이 부족해요
                    </button>
                  </div>
                  {feedbackError ? <p role="alert">{feedbackError}</p> : null}
                </>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
