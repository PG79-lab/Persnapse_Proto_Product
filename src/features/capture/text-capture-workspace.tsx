"use client";
import { matchesInferredField } from "../../domain/capture/inferred-fields";

import Link from "next/link";
import { useState } from "react";

import type { CaptureDraftV1 } from "../../domain/capture/capture-draft";
import type {
  CaptureCommitResponse,
  CaptureSessionView,
} from "../../domain/capture/capture-workflow";

const sampleNote =
  "2026-09-12 스마트 물류 포럼에서 한울 모빌리티의 김민준 사업개발 리드를 만났다. 코엑스에서 부산 물류 실증과 AI Agent 도입에 관해 이야기했다. 다음 주까지 파일럿 제안서를 보내기로 했다.";

const interactionLabels: Record<
  CaptureDraftV1["interaction"]["interactionType"],
  string
> = {
  meeting: "미팅",
  call: "통화",
  email: "이메일",
  message: "메시지",
  event: "행사",
  note: "메모",
};

const statementLabels: Record<
  CaptureDraftV1["memories"][number]["statementType"],
  string
> = {
  fact: "사실",
  preference: "선호",
  interest: "관심",
  need: "필요",
  relationship: "관계",
  context: "맥락",
};

const actionLabels: Record<CaptureDraftV1["actions"][number]["kind"], string> =
  {
    commitment: "기록된 약속",
    follow_up: "후속 행동",
    suggestion: "AI 제안",
  };

interface ApiErrorPayload {
  error?: string;
  captureId?: string;
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & ApiErrorPayload;

  if (!response.ok) {
    throw Object.assign(
      new Error(payload.error ?? "요청을 완료하지 못했습니다."),
      { captureId: payload.captureId },
    );
  }

  return payload;
}

function toDateTimeInput(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const local = new Date(date.getTime() + 9 * 60 * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeInput(value: string): string | null {
  return value ? new Date(`${value}+09:00`).toISOString() : null;
}

function ReviewLabel({
  title,
  path,
  inferredFields,
}: {
  title: string;
  path: string;
  inferredFields: string[];
}) {
  const inferred = inferredFields.some((field) =>
    matchesInferredField(field, path),
  );

  return (
    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
      {title}
      <span
        className={
          inferred
            ? "rounded-full bg-[var(--draft-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--draft)]"
            : "rounded-full bg-[var(--confirmed-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--confirmed)]"
        }
      >
        {inferred ? "AI 해석 · 확인 필요" : "사용자 입력/수정"}
      </span>
    </span>
  );
}

export function TextCaptureWorkspace({
  routingMode,
  initialText = sampleNote,
  onSaved,
}: {
  routingMode: "mock" | "live";
  initialText?: string;
  onSaved?: (personId: string) => void;
}) {
  const [processingMs, setProcessingMs] = useState<number | null>(null);
  const [rawText, setRawText] = useState(initialText);
  const [capture, setCapture] = useState<CaptureSessionView | null>(null);
  const [draft, setDraft] = useState<CaptureDraftV1 | null>(null);
  const [identityChoice, setIdentityChoice] = useState<
    { mode: "existing"; personId: string } | { mode: "new" } | null
  >(null);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [result, setResult] = useState<CaptureCommitResponse | null>(null);
  const [busy, setBusy] = useState<
    "structure" | "candidates" | "commit" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  function updateDraft(
    updater: (current: CaptureDraftV1) => CaptureDraftV1,
    inferredPath?: string,
  ) {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const next = updater(current);
      return inferredPath
        ? {
            ...next,
            inferredFields: next.inferredFields.filter(
              (field) => !matchesInferredField(field, inferredPath),
            ),
          }
        : next;
    });
  }

  async function structureCapture() {
    const startedAt = performance.now();
    setProcessingMs(null);
    setBusy("structure");
    setError(null);

    try {
      const response = await fetch("/api/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText,
          idempotencyKey: crypto.randomUUID(),
          referenceTime: new Date().toISOString(),
        }),
      });
      const nextCapture = await responseJson<CaptureSessionView>(response);
      setCapture(nextCapture);
      setDraft(nextCapture.draft);
      setNewDisplayName(nextCapture.draft?.identityHint.displayName ?? "");
      setIdentityChoice(null);
      requestAnimationFrame(() =>
        setProcessingMs(Math.round(performance.now() - startedAt)),
      );
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "맥락 구조화를 완료하지 못했습니다.";
      setError(message);
      const captureId =
        typeof caught === "object" &&
        caught !== null &&
        "captureId" in caught &&
        typeof caught.captureId === "string"
          ? caught.captureId
          : null;

      if (captureId) {
        setCapture((current) => ({
          captureId,
          state: "failed",
          rawText,
          modelDraft: current?.modelDraft ?? null,
          draft: current?.draft ?? null,
          identityCandidates: [],
          userCorrectionCount: current?.userCorrectionCount ?? 0,
          lastErrorCode: null,
          commitResult: null,
          createdAt: current?.createdAt ?? new Date().toISOString(),
        }));
      }
    } finally {
      setBusy(null);
    }
  }

  async function retryStructuring() {
    if (!capture) {
      return;
    }

    const startedAt = performance.now();
    setProcessingMs(null);
    setBusy("structure");
    setError(null);

    try {
      const response = await fetch(
        `/api/captures/${capture.captureId}/structure`,
        { method: "POST" },
      );
      const nextCapture = await responseJson<CaptureSessionView>(response);
      setCapture(nextCapture);
      setDraft(nextCapture.draft);
      setNewDisplayName(nextCapture.draft?.identityHint.displayName ?? "");
      setIdentityChoice(null);
      requestAnimationFrame(() =>
        setProcessingMs(Math.round(performance.now() - startedAt)),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "구조화를 다시 시도하지 못했습니다.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function commitCapture() {
    if (!capture || !draft) {
      return;
    }

    if (!identityChoice) {
      setError("기존 Person 연결 또는 신규 Person 생성을 직접 선택해 주세요.");
      return;
    }

    if (identityChoice.mode === "new" && !newDisplayName.trim()) {
      setError("신규 Person의 이름을 입력해 주세요.");
      return;
    }

    setBusy("commit");
    setError(null);

    try {
      const identity =
        identityChoice.mode === "existing"
          ? identityChoice
          : {
              mode: "new" as const,
              displayName: newDisplayName.trim(),
            };
      const response = await fetch(
        `/api/captures/${capture.captureId}/commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft, identity }),
        },
      );
      const commitResult = await responseJson<CaptureCommitResponse>(response);
      setResult(commitResult);
      setCapture(commitResult.capture);
      if (commitResult.capture.commitResult)
        onSaved?.(commitResult.capture.commitResult.personId);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "관계 기억을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function refreshIdentityCandidates() {
    if (!capture || !draft) {
      return;
    }

    setBusy("candidates");
    setError(null);

    try {
      const response = await fetch(
        `/api/captures/${capture.captureId}/candidates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft }),
        },
      );
      const payload = await responseJson<{
        identityCandidates: CaptureSessionView["identityCandidates"];
      }>(response);
      setCapture({
        ...capture,
        identityCandidates: payload.identityCandidates,
      });
      setIdentityChoice(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Identity 후보를 다시 찾지 못했습니다.",
      );
    } finally {
      setBusy(null);
    }
  }

  function resetWorkspace() {
    setCapture(null);
    setDraft(null);
    setResult(null);
    setIdentityChoice(null);
    setNewDisplayName("");
    setError(null);
  }

  if (result?.capture.commitResult) {
    const commit = result.capture.commitResult;

    return (
      <section className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6 shadow-[0_24px_80px_rgba(24,45,32,0.08)] sm:p-10">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-[var(--confirmed-soft)] text-2xl text-[var(--confirmed)]">
          ✓
        </div>
        <p className="mt-6 text-sm font-semibold text-[var(--confirmed)]">
          Memory commit 완료
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
          검토한 관계 기억이 저장되었습니다.
        </h2>
        <p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">
          {result.memoryDocumentStatus === "updated"
            ? routingMode === "live"
              ? "기억을 저장하고 AI 검색을 준비했습니다."
              : "기억을 저장했습니다. 현재는 기본 검색을 사용합니다."
            : "기억은 저장되었지만 검색 준비를 완료하지 못했습니다. 다시 저장할 필요는 없습니다."}
        </p>
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <Link
            href={`/people/${commit.personId}`}
            className="rounded-2xl bg-[var(--foreground)] px-5 py-4 text-center text-sm font-semibold text-white"
          >
            Person Context 보기
          </Link>
          <Link
            href={{ pathname: "/recall", query: { q: result.recallQuery } }}
            className="rounded-2xl border border-[var(--border-strong)] bg-white px-5 py-4 text-center text-sm font-semibold"
          >
            방금 저장한 기억 찾기
          </Link>
          <button
            type="button"
            onClick={resetWorkspace}
            className="rounded-2xl border border-[var(--border)] bg-[var(--background)] px-5 py-4 text-sm font-semibold"
          >
            새 Context 남기기
          </button>
        </div>
      </section>
    );
  }

  if (!capture || !draft || capture.state === "failed") {
    return (
      <section className="grid gap-6 lg:grid-cols-[1fr_19rem]">
        <div className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6 shadow-[0_24px_80px_rgba(24,45,32,0.07)] sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--accent)]">
                1. Text Context
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                만남을 편하게 적어주세요
              </h2>
            </div>
            <span className="rounded-full bg-[var(--background)] px-3 py-1 text-xs text-[var(--muted)]">
              {routingMode === "live" ? "OpenAI live" : "Deterministic mock"}
            </span>
          </div>
          <label htmlFor="capture-note" className="sr-only">
            관계 맥락
          </label>
          <textarea
            id="capture-note"
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            minLength={10}
            maxLength={5_000}
            rows={9}
            className="mt-6 w-full resize-y rounded-2xl border border-[var(--border-strong)] bg-[var(--background)] p-5 leading-7 outline-none focus:border-[var(--accent)]"
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[var(--muted)]">
              이름, 만난 시점·장소, 주제와 약속을 함께 적으면 더 정확합니다.
            </p>
            <button
              type="button"
              disabled={busy !== null || rawText.trim().length < 10}
              onClick={
                capture?.state === "failed"
                  ? retryStructuring
                  : structureCapture
              }
              className="rounded-xl bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "structure"
                ? "구조화 중…"
                : capture?.state === "failed"
                  ? "같은 Capture로 다시 시도"
                  : "구조화하고 검토하기"}
            </button>
          </div>
          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </p>
          ) : null}
        </div>

        <aside className="rounded-[2rem] border border-[var(--border)] bg-[var(--foreground)] p-6 text-white">
          <p className="text-xs font-semibold tracking-[0.15em] text-white/55 uppercase">
            Draft boundary
          </p>
          <h3 className="mt-3 text-xl font-semibold">아직 Memory가 아닙니다</h3>
          <p className="mt-3 text-sm leading-6 text-white/65">
            구조화 결과는 검토 전용 Draft에만 머뭅니다. 사용자가 Person을
            선택하고 저장하기 전에는 Profile이나 Recall에 나타나지 않습니다.
          </p>
        </aside>
      </section>
    );
  }

  return (
    <>
      {processingMs !== null ? (
        <p className="mb-3 text-sm text-[var(--muted)]">
          맥락 제출부터 검토 화면까지 {(processingMs / 1000).toFixed(1)}초
        </p>
      ) : null}
      <CaptureReview
        capture={capture}
        draft={draft}
        identityChoice={identityChoice}
        newDisplayName={newDisplayName}
        busy={busy}
        error={error}
        setIdentityChoice={setIdentityChoice}
        setNewDisplayName={setNewDisplayName}
        updateDraft={updateDraft}
        commitCapture={commitCapture}
        refreshIdentityCandidates={refreshIdentityCandidates}
      />
    </>
  );
}

interface CaptureReviewProps {
  capture: CaptureSessionView;
  draft: CaptureDraftV1;
  identityChoice:
    { mode: "existing"; personId: string } | { mode: "new" } | null;
  newDisplayName: string;
  busy: "structure" | "candidates" | "commit" | null;
  error: string | null;
  setIdentityChoice: (
    value: { mode: "existing"; personId: string } | { mode: "new" } | null,
  ) => void;
  setNewDisplayName: (value: string) => void;
  updateDraft: (
    updater: (current: CaptureDraftV1) => CaptureDraftV1,
    inferredPath?: string,
  ) => void;
  commitCapture: () => Promise<void>;
  refreshIdentityCandidates: () => Promise<void>;
}

function CaptureReview(props: CaptureReviewProps) {
  const {
    capture,
    draft,
    identityChoice,
    newDisplayName,
    busy,
    error,
    setIdentityChoice,
    setNewDisplayName,
    updateDraft,
    commitCapture,
    refreshIdentityCandidates,
  } = props;

  return (
    <section className="space-y-6">
      <div className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--accent)]">
              2. Review & Identity
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              구조화 결과를 직접 확인하세요
            </h2>
          </div>
          <span className="rounded-full bg-[var(--draft-soft)] px-3 py-1 text-xs font-medium text-[var(--draft)]">
            검토 중 · 아직 저장되지 않음
          </span>
        </div>
        <details className="mt-6 rounded-2xl bg-[var(--background)] p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            사용자 원문 보기
          </summary>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">
            {capture.rawText}
          </p>
        </details>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PersonDraftEditor
          draft={draft}
          updateDraft={updateDraft}
          setNewDisplayName={setNewDisplayName}
        />
        <IdentityChooser
          capture={capture}
          identityChoice={identityChoice}
          newDisplayName={newDisplayName}
          setIdentityChoice={setIdentityChoice}
          setNewDisplayName={setNewDisplayName}
          updateDraft={updateDraft}
          busy={busy}
          refreshIdentityCandidates={refreshIdentityCandidates}
        />
      </div>

      <InteractionEditor draft={draft} updateDraft={updateDraft} />
      <TopicsEditor draft={draft} updateDraft={updateDraft} />
      <MemoriesEditor draft={draft} updateDraft={updateDraft} />
      <ActionsEditor draft={draft} updateDraft={updateDraft} />

      {error ? (
        <p
          role="alert"
          className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      <section className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--border-strong)] bg-white/95 p-4 shadow-[0_20px_70px_rgba(24,45,32,0.14)] backdrop-blur">
        <p className="text-xs leading-5 text-[var(--muted)]">
          저장을 누르면 선택한 Identity와 검토한 값만 confirmed Memory가 됩니다.
        </p>
        <button
          type="button"
          disabled={busy !== null}
          onClick={commitCapture}
          className="rounded-xl bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === "commit" ? "원자적으로 저장 중…" : "확인하고 Memory 저장"}
        </button>
      </section>
    </section>
  );
}

function PersonDraftEditor({
  draft,
  updateDraft,
  setNewDisplayName,
}: Pick<CaptureReviewProps, "draft" | "updateDraft" | "setNewDisplayName">) {
  return (
    <section className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6 sm:p-8">
      <h3 className="text-xl font-semibold">Person 후보 정보</h3>
      <div className="mt-5 grid gap-4">
        {(
          [
            ["displayName", "이름", "identityHint.displayName"],
            ["organizationName", "소속", "identityHint.organizationName"],
            ["title", "직책", "identityHint.title"],
          ] as const
        ).map(([field, label, path]) => (
          <label key={field} className="grid gap-2">
            <ReviewLabel
              title={label}
              path={path}
              inferredFields={draft.inferredFields}
            />
            <input
              value={draft.identityHint[field] ?? ""}
              onChange={(event) => {
                const value = event.target.value || null;
                updateDraft(
                  (current) => ({
                    ...current,
                    identityHint: {
                      ...current.identityHint,
                      [field]: value,
                    },
                  }),
                  path,
                );
                if (field === "displayName") {
                  setNewDisplayName(event.target.value);
                }
              }}
              className="rounded-xl border border-[var(--border-strong)] bg-[var(--background)] px-4 py-3 outline-none focus:border-[var(--accent)]"
            />
          </label>
        ))}
      </div>
    </section>
  );
}

function IdentityChooser({
  capture,
  identityChoice,
  newDisplayName,
  setIdentityChoice,
  setNewDisplayName,
  updateDraft,
  busy,
  refreshIdentityCandidates,
}: Pick<
  CaptureReviewProps,
  | "capture"
  | "identityChoice"
  | "newDisplayName"
  | "setIdentityChoice"
  | "setNewDisplayName"
  | "updateDraft"
  | "busy"
  | "refreshIdentityCandidates"
>) {
  return (
    <section className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xl font-semibold">Identity 결정</h3>
        <button
          type="button"
          disabled={busy !== null}
          onClick={refreshIdentityCandidates}
          className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          {busy === "candidates"
            ? "후보 검색 중…"
            : "수정값으로 후보 다시 찾기"}
        </button>
      </div>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        후보가 있더라도 자동 병합하지 않습니다. 연결 또는 신규 생성을 직접
        선택하세요.
      </p>
      <div className="mt-5 space-y-3">
        {capture.identityCandidates.map((candidate) => (
          <label
            key={candidate.personId}
            className="flex cursor-pointer gap-3 rounded-2xl border border-[var(--border)] p-4 has-checked:border-[var(--accent)] has-checked:bg-[var(--accent-soft)]/50"
          >
            <input
              type="radio"
              name="identity-choice"
              checked={
                identityChoice?.mode === "existing" &&
                identityChoice.personId === candidate.personId
              }
              onChange={() =>
                setIdentityChoice({
                  mode: "existing",
                  personId: candidate.personId,
                })
              }
              className="mt-1"
            />
            <span>
              <span className="block font-semibold">
                {candidate.displayName}
              </span>
              <span className="mt-1 block text-xs text-[var(--muted)]">
                {candidate.organizationName ?? "소속 없음"}
                {candidate.organizationTitle
                  ? ` · ${candidate.organizationTitle}`
                  : ""}
              </span>
              <span className="mt-2 flex flex-wrap gap-1">
                {candidate.signals.map((signal) => (
                  <span
                    key={signal}
                    className="rounded-full bg-white px-2 py-0.5 text-[10px] text-[var(--accent)]"
                  >
                    {signal}
                  </span>
                ))}
              </span>
            </span>
          </label>
        ))}
        <label className="flex cursor-pointer gap-3 rounded-2xl border border-[var(--border)] p-4 has-checked:border-[var(--accent)] has-checked:bg-[var(--accent-soft)]/50">
          <input
            type="radio"
            name="identity-choice"
            checked={identityChoice?.mode === "new"}
            onChange={() => setIdentityChoice({ mode: "new" })}
            className="mt-1"
          />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">신규 Person 생성</span>
            <input
              value={newDisplayName}
              onChange={(event) => {
                const value = event.target.value;
                setNewDisplayName(value);
                updateDraft(
                  (current) => ({
                    ...current,
                    identityHint: {
                      ...current.identityHint,
                      displayName: value || null,
                    },
                  }),
                  "identityHint.displayName",
                );
              }}
              onFocus={() => setIdentityChoice({ mode: "new" })}
              placeholder="저장할 이름"
              className="mt-3 w-full rounded-xl border border-[var(--border-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </span>
        </label>
      </div>
    </section>
  );
}

function InteractionEditor({
  draft,
  updateDraft,
}: Pick<CaptureReviewProps, "draft" | "updateDraft">) {
  return (
    <section className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6 sm:p-8">
      <h3 className="text-xl font-semibold">Interaction</h3>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2">
          <ReviewLabel
            title="상호작용 유형"
            path="interaction.interactionType"
            inferredFields={draft.inferredFields}
          />
          <select
            value={draft.interaction.interactionType}
            onChange={(event) =>
              updateDraft(
                (current) => ({
                  ...current,
                  interaction: {
                    ...current.interaction,
                    interactionType: event.target
                      .value as CaptureDraftV1["interaction"]["interactionType"],
                  },
                }),
                "interaction.interactionType",
              )
            }
            className="rounded-xl border border-[var(--border-strong)] bg-[var(--background)] px-4 py-3"
          >
            {Object.entries(interactionLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2">
          <ReviewLabel
            title="만난 시점 (모르면 비워두세요)"
            path="interaction.occurredAt"
            inferredFields={draft.inferredFields}
          />
          <input
            type="datetime-local"
            value={toDateTimeInput(draft.interaction.occurredAt)}
            onChange={(event) =>
              updateDraft(
                (current) => ({
                  ...current,
                  interaction: {
                    ...current.interaction,
                    occurredAt: fromDateTimeInput(event.target.value),
                  },
                }),
                "interaction.occurredAt",
              )
            }
            className="rounded-xl border border-[var(--border-strong)] bg-[var(--background)] px-4 py-3"
          />
        </label>
        <label className="grid gap-2">
          <ReviewLabel
            title="장소"
            path="interaction.location"
            inferredFields={draft.inferredFields}
          />
          <input
            value={draft.interaction.location ?? ""}
            onChange={(event) =>
              updateDraft(
                (current) => ({
                  ...current,
                  interaction: {
                    ...current.interaction,
                    location: event.target.value || null,
                  },
                }),
                "interaction.location",
              )
            }
            className="rounded-xl border border-[var(--border-strong)] bg-[var(--background)] px-4 py-3"
          />
        </label>
        <label className="grid gap-2">
          <ReviewLabel
            title="행사"
            path="interaction.eventName"
            inferredFields={draft.inferredFields}
          />
          <input
            value={draft.interaction.eventName ?? ""}
            onChange={(event) =>
              updateDraft(
                (current) => ({
                  ...current,
                  interaction: {
                    ...current.interaction,
                    eventName: event.target.value || null,
                  },
                }),
                "interaction.eventName",
              )
            }
            className="rounded-xl border border-[var(--border-strong)] bg-[var(--background)] px-4 py-3"
          />
        </label>
        <label className="grid gap-2 sm:col-span-2">
          <ReviewLabel
            title="요약"
            path="interaction.summary"
            inferredFields={draft.inferredFields}
          />
          <textarea
            value={draft.interaction.summary}
            onChange={(event) =>
              updateDraft(
                (current) => ({
                  ...current,
                  interaction: {
                    ...current.interaction,
                    summary: event.target.value,
                  },
                }),
                "interaction.summary",
              )
            }
            rows={4}
            className="rounded-xl border border-[var(--border-strong)] bg-[var(--background)] px-4 py-3 leading-6"
          />
        </label>
      </div>
    </section>
  );
}

function TopicsEditor({
  draft,
  updateDraft,
}: Pick<CaptureReviewProps, "draft" | "updateDraft">) {
  return (
    <section className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6 sm:p-8">
      <ReviewLabel
        title="Topics"
        path="topics"
        inferredFields={draft.inferredFields}
      />
      <p className="mt-2 text-xs text-[var(--muted)]">
        쉼표로 구분해 최대 12개까지 입력할 수 있습니다.
      </p>
      <input
        value={draft.topics.join(", ")}
        onChange={(event) =>
          updateDraft(
            (current) => ({
              ...current,
              topics: event.target.value
                .split(",")
                .map((topic) => topic.trim())
                .filter(Boolean)
                .slice(0, 12),
            }),
            "topics",
          )
        }
        className="mt-4 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--background)] px-4 py-3"
      />
    </section>
  );
}

function MemoriesEditor({
  draft,
  updateDraft,
}: Pick<CaptureReviewProps, "draft" | "updateDraft">) {
  return (
    <section className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReviewLabel
          title="관계 기억 후보"
          path="memories"
          inferredFields={draft.inferredFields}
        />
        <button
          type="button"
          onClick={() =>
            updateDraft(
              (current) => ({
                ...current,
                memories: [
                  ...current.memories,
                  {
                    statementType: "context" as const,
                    body: "새 관계 기억",
                    occurredAt: current.interaction.occurredAt,
                  },
                ].slice(0, 12),
              }),
              "memories",
            )
          }
          className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
        >
          + 기억 추가
        </button>
      </div>
      <div className="mt-4 space-y-3">
        {draft.memories.length === 0 ? (
          <p className="rounded-xl bg-[var(--background)] p-4 text-sm text-[var(--muted)]">
            별도 기억 후보가 없습니다. 필요하면 직접 추가하세요.
          </p>
        ) : null}
        {draft.memories.map((memory, index) => (
          <div
            key={index}
            className="grid gap-3 rounded-2xl border border-[var(--border)] p-4 sm:grid-cols-[9rem_1fr_auto]"
          >
            <select
              value={memory.statementType}
              onChange={(event) =>
                updateDraft(
                  (current) => ({
                    ...current,
                    memories: current.memories.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...item,
                            statementType: event.target
                              .value as typeof item.statementType,
                          }
                        : item,
                    ),
                  }),
                  "memories",
                )
              }
              className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2"
            >
              {Object.entries(statementLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <div className="grid gap-2">
              <input
                aria-label={`관계 기억 ${index + 1} 내용`}
                value={memory.body}
                onChange={(event) =>
                  updateDraft(
                    (current) => ({
                      ...current,
                      memories: current.memories.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, body: event.target.value }
                          : item,
                      ),
                    }),
                    "memories",
                  )
                }
                className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2"
              />
              <input
                aria-label={`관계 기억 ${index + 1} 발생 시점`}
                type="datetime-local"
                value={toDateTimeInput(memory.occurredAt)}
                onChange={(event) =>
                  updateDraft(
                    (current) => ({
                      ...current,
                      memories: current.memories.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              occurredAt: fromDateTimeInput(event.target.value),
                            }
                          : item,
                      ),
                    }),
                    "memories",
                  )
                }
                className="rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-xs text-[var(--muted)]"
              />
            </div>
            <button
              type="button"
              aria-label="기억 삭제"
              onClick={() =>
                updateDraft(
                  (current) => ({
                    ...current,
                    memories: current.memories.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  }),
                  "memories",
                )
              }
              className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]"
            >
              삭제
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ActionsEditor({
  draft,
  updateDraft,
}: Pick<CaptureReviewProps, "draft" | "updateDraft">) {
  return (
    <section className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReviewLabel
          title="약속과 다음 행동"
          path="actions"
          inferredFields={draft.inferredFields}
        />
        <button
          type="button"
          onClick={() =>
            updateDraft(
              (current) => ({
                ...current,
                actions: [
                  ...current.actions,
                  {
                    kind: "follow_up" as const,
                    title: "새 후속 행동",
                    details: null,
                    dueAt: null,
                  },
                ].slice(0, 8),
              }),
              "actions",
            )
          }
          className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
        >
          + 행동 추가
        </button>
      </div>
      <div className="mt-4 space-y-3">
        {draft.actions.length === 0 ? (
          <p className="rounded-xl bg-[var(--background)] p-4 text-sm text-[var(--muted)]">
            추출된 약속이 없습니다. 사용자 기록과 AI 제안은 종류로 구분됩니다.
          </p>
        ) : null}
        {draft.actions.map((action, index) => (
          <div
            key={index}
            className="grid gap-3 rounded-2xl border border-[var(--border)] p-4 sm:grid-cols-[9rem_1fr_auto]"
          >
            <select
              value={action.kind}
              onChange={(event) =>
                updateDraft(
                  (current) => ({
                    ...current,
                    actions: current.actions.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...item,
                            kind: event.target.value as typeof item.kind,
                          }
                        : item,
                    ),
                  }),
                  "actions",
                )
              }
              className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2"
            >
              {Object.entries(actionLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <div className="grid gap-2">
              <input
                aria-label={`행동 ${index + 1} 제목`}
                value={action.title}
                onChange={(event) =>
                  updateDraft(
                    (current) => ({
                      ...current,
                      actions: current.actions.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, title: event.target.value }
                          : item,
                      ),
                    }),
                    "actions",
                  )
                }
                className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2"
              />
              <input
                aria-label={`행동 ${index + 1} 상세`}
                value={action.details ?? ""}
                placeholder="상세 메모"
                onChange={(event) =>
                  updateDraft(
                    (current) => ({
                      ...current,
                      actions: current.actions.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              details: event.target.value || null,
                            }
                          : item,
                      ),
                    }),
                    "actions",
                  )
                }
                className="rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm"
              />
              <input
                aria-label={`행동 ${index + 1} 기한`}
                type="datetime-local"
                value={toDateTimeInput(action.dueAt)}
                onChange={(event) =>
                  updateDraft(
                    (current) => ({
                      ...current,
                      actions: current.actions.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              dueAt: fromDateTimeInput(event.target.value),
                            }
                          : item,
                      ),
                    }),
                    "actions",
                  )
                }
                className="rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-xs text-[var(--muted)]"
              />
            </div>
            <button
              type="button"
              aria-label="행동 삭제"
              onClick={() =>
                updateDraft(
                  (current) => ({
                    ...current,
                    actions: current.actions.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  }),
                  "actions",
                )
              }
              className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]"
            >
              삭제
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
