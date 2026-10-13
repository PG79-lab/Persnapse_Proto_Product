"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { prepareRecording } from "./prepare-recording";

export function RecordingTranscription({
  blob,
  fallbackUrl,
  audioRef,
  disabled,
  availableCharacters,
  onApply,
  onDuration,
  autoTranscript = false,
  initialResult,
}: {
  blob: Blob;
  fallbackUrl: string;
  audioRef: Ref<HTMLAudioElement>;
  disabled: boolean;
  availableCharacters: number;
  onApply: (text: string) => void;
  onDuration: (duration: number) => void;
  autoTranscript?: boolean;
  initialResult?: string;
}) {
  const [prepared, setPrepared] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [preparationError, setPreparationError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultOverride, setResult] = useState<string | null | undefined>(
    undefined,
  );
  const result =
    resultOverride === undefined ? (initialResult ?? null) : resultOverride;
  const [language, setLanguage] = useState("ko");
  const [hints, setHints] = useState("");
  const revision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    prepareRecording(blob)
      .then((wav) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(wav);
        setPrepared(wav);
        setAudioUrl(objectUrl);
      })
      .catch((caught) => {
        if (!cancelled)
          setPreparationError(
            caught instanceof Error
              ? caught.message
              : "녹음 파일을 읽지 못했습니다.",
          );
      });
    function invalidate() {
      revision.current++;
      controller.current?.abort();
    }
    return () => {
      cancelled = true;
      invalidate();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [blob]);
  function cancel() {
    revision.current++;
    controller.current?.abort();
    setBusy(false);
  }
  async function transcribe() {
    if (!prepared || busy || disabled) return;
    const current = ++revision.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("audio", prepared, "speech.wav");
    form.set("language", language);
    form.set("hints", hints);
    try {
      const response = await fetch("/api/stt/transcribe", {
        method: "POST",
        headers: { "X-Persnapse-STT": "1" },
        body: form,
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(55_000)]),
      });
      const payload = await response.json();
      if (current !== revision.current) return;
      if (!response.ok)
        throw new Error(payload.error || "음성을 변환하지 못했습니다.");
      if (typeof payload.text !== "string" || !payload.text.trim())
        throw new Error("인식된 말이 없습니다. 다시 녹음해 주세요.");
      setResult(payload.text);
    } catch (caught) {
      if (current === revision.current)
        setError(
          caught instanceof Error && caught.name !== "TimeoutError"
            ? caught.message
            : "음성 변환 시간이 초과됐습니다. 다시 시도해 주세요.",
        );
    } finally {
      if (current === revision.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  return (
    <section aria-label="녹음 텍스트 변환" className="w-full">
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        src={audioUrl || fallbackUrl}
        aria-label="녹음 재생"
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration))
            onDuration(event.currentTarget.duration);
        }}
        onError={() =>
          setError(
            "음성을 재생하지 못했습니다. 파일을 내려받아 확인하거나 다시 녹음해 주세요.",
          )
        }
      />
      <p className="mt-2 text-sm" role="status">
        {busy
          ? "음성을 텍스트로 변환하고 있어요…"
          : preparationError ||
            (prepared
              ? "다시 듣거나 텍스트로 변환할 수 있어요."
              : "녹음을 재생·변환할 수 있도록 준비하고 있어요…")}
      </p>
      {!autoTranscript && (
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            aria-label="녹음 변환 언어"
            value={language}
            disabled={busy || disabled}
            onChange={(event) => setLanguage(event.target.value)}
            className="rounded-lg border p-2"
          >
            <option value="ko">한국어</option>
            <option value="ko-en">한국어 + 영어</option>
            <option value="auto">자동 감지</option>
          </select>
          <input
            aria-label="녹음 인식 용어"
            placeholder="이름·회사·용어 (쉼표로 구분)"
            maxLength={1000}
            value={hints}
            disabled={busy || disabled}
            onChange={(event) => setHints(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border p-2"
          />
          <button
            type="button"
            className="primary-button"
            disabled={!prepared || busy || disabled}
            onClick={transcribe}
          >
            {result === null ? "텍스트로 변환" : "다시 변환"}
          </button>
          {busy && (
            <button type="button" className="secondary-button" onClick={cancel}>
              변환 취소
            </button>
          )}
        </div>
      )}
      <p className="mt-2 text-xs">
        {autoTranscript
          ? "전사 결과를 메모에 자동 반영했습니다. 아래에서 확인하고 수정하세요."
          : "최대 100초 · 변환 시 음성을 OpenAI로 전송합니다. 결과 확인 후 메모에 추가하세요."}
      </p>
      {result !== null && (
        <div className="mt-3">
          <label className="block text-sm">
            음성 인식 결과
            <textarea
              aria-label="녹음 인식 결과"
              value={result}
              maxLength={5000}
              onChange={(event) => setResult(event.target.value)}
              rows={4}
              className="mt-2 w-full rounded-lg border p-3"
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={
              busy ||
              disabled ||
              !result.trim() ||
              result.trim().length > availableCharacters
            }
            onClick={() => {
              onApply(result.trim());
              setResult(null);
            }}
          >
            확인하고 메모에 추가
          </button>
          {result.trim().length > availableCharacters && (
            <p role="alert">
              메모의 2,000자 제한을 넘습니다. 기존 메모나 인식 결과를 줄여
              주세요.
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
