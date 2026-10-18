"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SearchPreparationResult,
  SearchPreparationStatus,
} from "../../domain/recall/search-preparation";

export function SearchPreparation({ onPrepared }: { onPrepared: () => void }) {
  const [status, setStatus] = useState<SearchPreparationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [waiting, setWaiting] = useState(false);
  const pending = useRef(false);
  const version = useRef({ value: 0 });
  const controller = useRef<AbortController | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inspect = useCallback(async () => {
    if (pending.current) return;
    const current = ++version.current.value;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await fetch("/api/recall/preparation", {
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      });
      const payload = await result.json();
      if (!result.ok)
        throw new Error(payload.error ?? "준비 상태를 확인하지 못했습니다.");
      if (current === version.current.value) {
        const preparation = payload as SearchPreparationStatus;
        setStatus(preparation);
        setNotice(
          preparation.ready
            ? "검색 준비가 완료되었습니다. 질문을 다시 보내 주세요."
            : "",
        );
        if (preparation.ready) onPrepared();
      }
    } catch (error) {
      if (current === version.current.value)
        setError(
          error instanceof Error && error.name !== "TimeoutError"
            ? error.message
            : "준비 상태를 확인하지 못했습니다. 다시 시도해 주세요.",
        );
    } finally {
      if (current === version.current.value) {
        pending.current = false;
        setBusy(false);
      }
    }
  }, [onPrepared]);

  useEffect(() => {
    const generation = version.current;
    void inspect();
    return () => {
      generation.value++;
      controller.current?.abort();
      pending.current = false;
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [inspect]);

  async function prepare() {
    if (pending.current || waiting) return;
    const current = ++version.current.value;
    controller.current = new AbortController();
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fetch("/api/recall/preparation", {
        method: "POST",
        signal: AbortSignal.any([
          controller.current.signal,
          AbortSignal.timeout(65000),
        ]),
      });
      const payload = await result.json();
      if (!result.ok)
        throw new Error(payload.error ?? "검색 준비를 완료하지 못했습니다.");
      if (current !== version.current.value) return;
      const progress = payload as SearchPreparationResult;
      setStatus(progress.status);
      if (progress.status.ready) {
        setNotice("검색 준비가 완료됐습니다. 질문을 다시 보내 주세요.");
        onPrepared();
      } else if (progress.failureCount) {
        setError(
          progress.retryAfterSeconds
            ? `요청이 몰렸거나 다른 작업이 진행 중입니다. 약 ${progress.retryAfterSeconds}초 후 다시 시도해 주세요.`
            : "일부 기억의 검색 준비를 완료하지 못했습니다. 준비된 내용은 유지되며 다시 시도할 수 있습니다.",
        );
      } else
        setNotice(
          `${progress.completedCount}명의 검색 준비를 마쳤습니다. 남은 기억도 준비해 주세요.`,
        );
      if (progress.retryAfterSeconds) {
        setWaiting(true);
        timeout.current = setTimeout(
          () => setWaiting(false),
          progress.retryAfterSeconds * 1000,
        );
      }
    } catch (error) {
      if (current === version.current.value)
        setError(
          error instanceof Error && error.name !== "TimeoutError"
            ? error.message
            : "준비 상태가 확정되지 않았습니다. 상태를 다시 확인해 주세요.",
        );
    } finally {
      if (current === version.current.value) {
        pending.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <section
      aria-label="검색 준비 복구"
      className="mt-5 rounded-xl border border-[var(--border)] bg-white p-5"
    >
      <h2 className="font-semibold">
        저장된 기억을 검색할 수 있도록 준비해 주세요
      </h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        원래 기록은 보존됩니다. 다시 준비할 때 필요한 기록을 Voyage에 전송하며,
        검색이나 새 답변 생성은 자동 실행하지 않습니다.
      </p>
      {status ? (
        <p className="mt-3 text-sm">
          검색 준비 {status.prepared}/{status.total}명
          {status.processing ? ` · ${status.processing}명 처리 중` : ""}
        </p>
      ) : null}
      {status?.mode === "mock" ? (
        <p className="mt-2 text-sm">
          기본 검색 모드에서는 추가 검색 준비가 필요하지 않습니다.
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-3 text-sm">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-amber-900">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        {status && !status.ready && status.mode === "live" ? (
          <button
            onClick={() => void prepare()}
            disabled={busy || waiting || status.retryable === 0}
            className="rounded-lg bg-[var(--foreground)] px-4 py-3 text-sm text-white disabled:opacity-50"
          >
            {busy
              ? "검색 준비 중…"
              : waiting
                ? "잠시 후 다시 시도"
                : "검색 준비 다시 시도"}
          </button>
        ) : null}
        <button
          onClick={() => void inspect()}
          disabled={busy}
          className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm disabled:opacity-50"
        >
          {busy && !status ? "준비 상태 확인 중…" : "준비 상태 다시 확인"}
        </button>
      </div>
    </section>
  );
}
