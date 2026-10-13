"use client";

import { useEffect, useRef, useState } from "react";
import { PcmRecorder } from "./pcm-recorder";

type Phase = "idle" | "requesting" | "recording" | "transcribing";
export function VoiceInput({
  onApply,
  disabled = false,
  availableCharacters = 5_000,
}: {
  onApply: (text: string) => void;
  disabled?: boolean;
  availableCharacters?: number;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [language, setLanguage] = useState("ko");
  const [hints, setHints] = useState("");
  const [text, setText] = useState("");
  const [hasResult, setHasResult] = useState(false);
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const active = useRef(false);
  const version = useRef(0);
  const recorder = useRef<PcmRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const controller = useRef<AbortController | null>(null);

  function release() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }
  function cancel() {
    version.current++;
    active.current = false;
    controller.current?.abort();
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current?.dispose();
    recorder.current = null;
    release();
    setPhase("idle");
  }
  useEffect(() => {
    function invalidateRequest() {
      version.current++;
    }
    const abort = new AbortController();
    fetch("/api/stt/transcribe", { signal: abort.signal })
      .then(async (response) => {
        const payload = await response.json();
        setConfigured(response.ok && payload.configured === true);
      })
      .catch(() => {
        if (!abort.signal.aborted) setConfigured(false);
      });
    return () => {
      abort.abort();
      invalidateRequest();
      active.current = false;
      controller.current?.abort();
      if (timer.current) clearInterval(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      recorder.current?.dispose();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  async function start() {
    if (active.current || disabled) return;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioWorkletNode) {
      setError(
        "이 브라우저에서는 녹음할 수 없습니다. HTTPS 또는 localhost에서 Chrome·Edge로 시도해 주세요.",
      );
      return;
    }
    active.current = true;
    const current = ++version.current;
    setPhase("requesting");
    setError("");
    setText("");
    setHasResult(false);
    setAudioUrl("");
    setSeconds(0);
    try {
      const source = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current !== version.current) {
        source.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = source;
      const recording = await PcmRecorder.create(source);
      if (current !== version.current) {
        recording.dispose();
        source.getTracks().forEach((track) => track.stop());
        return;
      }
      recorder.current = recording;
      const chunks: Blob[] = [];
      let bytes = 0;
      let tooLarge = false;
      const startedAt = performance.now();
      recording.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
          bytes += event.data.size;
        }
        if (bytes > 3_900_000) {
          tooLarge = true;
          if (recording.state === "recording") recording.stop();
        }
      };
      recording.onerror = () => {
        if (current !== version.current) return;
        cancel();
        setError("녹음이 중단됐습니다. 마이크를 확인해 주세요.");
      };
      recording.onstop = async () => {
        if (current !== version.current) return;
        release();
        recorder.current = null;
        if (tooLarge || !bytes) {
          active.current = false;
          setPhase("idle");
          setError(
            tooLarge
              ? "음성이 너무 큽니다. 더 짧게 녹음해 주세요."
              : "녹음된 소리가 없습니다.",
          );
          return;
        }
        const blob = new Blob(chunks, { type: recording.mimeType });
        setAudioUrl(URL.createObjectURL(blob));
        setPhase("transcribing");
        const abort = new AbortController();
        controller.current = abort;
        const body = new FormData();
        body.set("audio", blob, "speech.wav");
        body.set("language", language);
        body.set("hints", hints);
        try {
          const response = await fetch("/api/stt/transcribe", {
            method: "POST",
            headers: { "X-Persnapse-STT": "1" },
            body,
            signal: AbortSignal.any([
              abort.signal,
              AbortSignal.timeout(55_000),
            ]),
          });
          const payload = await response.json();
          if (current !== version.current) return;
          if (!response.ok)
            throw new Error(payload.error || "음성을 변환하지 못했습니다.");
          if (typeof payload.text !== "string" || !payload.text.trim())
            throw new Error("인식된 말이 없습니다.");
          setText(payload.text);
          setHasResult(true);
        } catch (caught) {
          if (current === version.current)
            setError(
              caught instanceof Error && caught.name !== "TimeoutError"
                ? caught.message
                : "변환 시간이 초과됐습니다. 다시 시도해 주세요.",
            );
        } finally {
          if (current === version.current) {
            active.current = false;
            setPhase("idle");
            controller.current = null;
          }
        }
      };
      recording.start();
      setPhase("recording");
      timer.current = setInterval(() => {
        const elapsed = Math.floor((performance.now() - startedAt) / 1000);
        setSeconds(Math.min(100, elapsed));
        if (elapsed >= 100 && recording.state === "recording") recording.stop();
      }, 250);
    } catch {
      if (current !== version.current) return;
      release();
      active.current = false;
      setPhase("idle");
      setError("마이크 권한과 연결을 확인한 뒤 다시 시도해 주세요.");
    }
  }
  const busy = phase !== "idle";
  return (
    <section
      aria-label="음성으로 입력"
      className="mt-4 rounded-xl border border-[var(--border)] p-4"
    >
      <p className="text-sm font-semibold">음성으로 입력</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        최대 100초 녹음 후 결과를 확인하고 적용하세요. 변환 시 음성이 OpenAI로
        전송됩니다.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          aria-label="음성 인식 언어"
          value={language}
          disabled={busy}
          onChange={(event) => setLanguage(event.target.value)}
          className="rounded-lg border p-2 text-sm"
        >
          <option value="ko">한국어</option>
          <option value="ko-en">한국어 + 영어</option>
          <option value="auto">자동 감지</option>
        </select>
        <input
          aria-label="인식 용어"
          placeholder="이름·회사·전문 용어 (쉼표로 구분)"
          maxLength={1000}
          value={hints}
          disabled={busy}
          onChange={(event) => setHints(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border p-2 text-sm"
        />
        {phase === "recording" ? (
          <button
            type="button"
            onClick={() => recorder.current?.stop()}
            className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm text-white"
          >
            녹음 끝내고 변환
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={busy || disabled || configured !== true}
            className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            녹음 시작
          </button>
        )}
        {busy && (
          <button
            type="button"
            onClick={cancel}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            취소
          </button>
        )}
      </div>
      <p role="status" className="mt-2 text-xs text-[var(--muted)]">
        {phase === "requesting"
          ? "마이크 권한을 확인하고 있습니다…"
          : phase === "recording"
            ? `녹음 중 ${seconds}/100초`
            : phase === "transcribing"
              ? "음성을 텍스트로 변환하고 있습니다…"
              : configured === null
                ? "음성 변환 설정 확인 중…"
                : configured === false
                  ? "서버의 OpenAI API 키와 STT 모델 설정을 확인해 주세요."
                  : "녹음할 준비가 됐습니다."}
      </p>
      {audioUrl && (
        <audio
          controls
          src={audioUrl}
          aria-label="녹음 다시 듣기"
          className="mt-3 w-full"
        />
      )}
      {hasResult && (
        <div className="mt-3">
          <label htmlFor="voice-transcript" className="text-sm">
            인식 결과 · 수정 가능
          </label>
          <textarea
            id="voice-transcript"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={5000}
            rows={3}
            className="mt-2 w-full rounded-lg border p-3"
          />
          <button
            type="button"
            disabled={
              disabled ||
              busy ||
              !text.trim() ||
              text.trim().length > availableCharacters
            }
            onClick={() => {
              onApply(text.trim());
              setText("");
              setHasResult(false);
            }}
            className="mt-2 rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
          >
            확인하고 입력에 추가
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {text.trim().length > availableCharacters && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          입력의 5,000자 제한을 넘습니다. 기존 입력이나 인식 결과를 줄여 주세요.
        </p>
      )}
    </section>
  );
}
