"use client";

import { useEffect, useRef, useState } from "react";

import { captureBusinessCardFrame } from "./card-image-processing";

export function BusinessCardCamera({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => Promise<void> | void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureInFlightRef = useRef(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment",
  );
  const [status, setStatus] = useState<"starting" | "ready" | "capturing">(
    "starting",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStatus("starting");
      setError(null);

      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError(
          "카메라는 HTTPS 또는 localhost에서만 사용할 수 있습니다. 이미지 업로드를 이용해 주세요.",
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus("ready");
      } catch (caught) {
        const name = caught instanceof DOMException ? caught.name : "";
        setError(
          name === "NotAllowedError"
            ? "카메라 권한이 거부되었습니다. 브라우저 설정에서 허용하거나 이미지 업로드를 이용해 주세요."
            : "카메라를 시작하지 못했습니다. 다른 카메라 또는 이미지 업로드를 이용해 주세요.",
        );
      }
    }

    void startCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [facingMode]);

  async function capture() {
    if (!videoRef.current || status !== "ready" || captureInFlightRef.current)
      return;
    captureInFlightRef.current = true;
    setStatus("capturing");
    setError(null);
    try {
      const file = await captureBusinessCardFrame(videoRef.current);
      await onCapture(file);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "명함 촬영에 실패했습니다.",
      );
      setStatus("ready");
    } finally {
      captureInFlightRef.current = false;
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="명함 촬영"
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
    >
      <section className="w-full max-w-4xl overflow-hidden rounded-[2rem] bg-[#101511] text-white shadow-2xl">
        <header className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold">명함 촬영</p>
            <p className="mt-1 text-xs text-white/55">
              테두리 안에 한 장의 명함을 맞춰주세요.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 px-4 py-2 text-sm"
          >
            닫기
          </button>
        </header>
        <div className="relative aspect-video bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            className="size-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="aspect-[1.586/1] w-[88%] rounded-2xl border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.26)]">
              <span className="sr-only">명함 촬영 가이드</span>
            </div>
          </div>
          {status === "starting" && !error ? (
            <div className="absolute inset-0 grid place-items-center bg-black/50 text-sm">
              카메라를 준비하고 있습니다…
            </div>
          ) : null}
        </div>
        {error ? (
          <p
            role="alert"
            className="mx-5 mt-4 rounded-xl bg-red-500/15 p-3 text-sm text-red-100"
          >
            {error}
          </p>
        ) : null}
        <footer className="flex items-center justify-center gap-4 p-5">
          <button
            type="button"
            onClick={() =>
              setFacingMode((current) =>
                current === "environment" ? "user" : "environment",
              )
            }
            className="rounded-full border border-white/20 px-4 py-3 text-sm"
          >
            카메라 전환
          </button>
          <button
            type="button"
            disabled={status !== "ready"}
            onClick={capture}
            className="flex size-16 items-center justify-center rounded-full border-4 border-white bg-white/25 disabled:opacity-40"
            aria-label="촬영하기"
          >
            <span className="size-11 rounded-full bg-white" />
          </button>
        </footer>
      </section>
    </div>
  );
}
