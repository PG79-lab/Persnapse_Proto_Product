"use client";

import { useEffect, useRef, useState } from "react";

import {
  businessCardCaptureGeometry,
  captureBusinessCardFrame,
  type BusinessCardCaptureGeometry,
} from "./card-image-processing";

type PhotoCapture = new (track: MediaStreamTrack) => {
  takePhoto: () => Promise<Blob>;
};

async function captureStillPhoto(
  track: MediaStreamTrack,
): Promise<File | null> {
  const PhotoApi = (window as Window & { ImageCapture?: PhotoCapture })
    .ImageCapture;
  if (!PhotoApi) return null;
  try {
    const photo = await new PhotoApi(track).takePhoto();
    if (
      photo.size <= 0 ||
      photo.size > 10 * 1024 * 1024 ||
      !["image/jpeg", "image/png", "image/webp"].includes(photo.type)
    ) {
      return null;
    }
    const extension =
      photo.type === "image/png"
        ? "png"
        : photo.type === "image/webp"
          ? "webp"
          : "jpg";
    return new File([photo], `business-card-${Date.now()}.${extension}`, {
      type: photo.type,
      lastModified: Date.now(),
    });
  } catch {
    return null;
  }
}

export function BusinessCardCamera({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureInFlightRef = useRef(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment",
  );
  const [status, setStatus] = useState<
    "starting" | "ready" | "capturing" | "review"
  >("starting");
  const [error, setError] = useState<string | null>(null);
  const [guide, setGuide] = useState<BusinessCardCaptureGeometry | null>(null);
  const [actualResolution, setActualResolution] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);

  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url);
    };
  }, [shot]);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStatus("starting");
      setError(null);
      setGuide(null);

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
        const settings = stream.getVideoTracks()[0]?.getSettings();
        setActualResolution(
          settings?.width && settings.height
            ? { width: settings.width, height: settings.height }
            : null,
        );
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

  useEffect(() => {
    if (status !== "ready") return;
    const video = videoRef.current;
    if (!video) return;
    const update = () => {
      if (
        video.videoWidth > 0 &&
        video.videoHeight > 0 &&
        video.clientWidth > 0 &&
        video.clientHeight > 0
      ) {
        setGuide(
          businessCardCaptureGeometry(
            video.videoWidth,
            video.videoHeight,
            video.clientWidth,
            video.clientHeight,
          ),
        );
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(video);
    return () => observer.disconnect();
  }, [status]);

  async function capture() {
    if (!videoRef.current || status !== "ready" || captureInFlightRef.current)
      return;
    captureInFlightRef.current = true;
    setStatus("capturing");
    setError(null);
    try {
      const track = streamRef.current?.getVideoTracks()[0];
      const file =
        (track ? await captureStillPhoto(track) : null) ??
        (await captureBusinessCardFrame(videoRef.current));
      setShot({ file, url: URL.createObjectURL(file) });
      setStatus("review");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "명함 촬영에 실패했습니다.",
      );
      setStatus("ready");
    } finally {
      captureInFlightRef.current = false;
    }
  }

  function usePhoto() {
    if (!shot) return;
    onCapture(shot.file);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    onClose();
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
              {shot
                ? "글자가 선명하고 명함 전체가 보이는지 확인해 주세요."
                : "테두리 안에 한 장의 명함을 맞춰주세요."}
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
            className={`size-full object-cover ${shot ? "hidden" : ""}`}
          />
          {shot ? (
            // Captured images are private blob URLs and are never sent to an image proxy.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shot.url}
              alt="촬영한 명함 확인"
              className="size-full object-contain"
            />
          ) : null}
          {!shot && guide ? (
            <div className="pointer-events-none absolute inset-0">
              <div
                className="absolute rounded-2xl border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.26)]"
                style={{
                  left: `${guide.guideLeftPercent}%`,
                  top: `${guide.guideTopPercent}%`,
                  width: `${guide.guideWidthPercent}%`,
                  height: `${guide.guideHeightPercent}%`,
                }}
              >
                <span className="sr-only">명함 촬영 가이드</span>
              </div>
            </div>
          ) : null}
          {(status === "starting" || status === "capturing") && !error ? (
            <div className="absolute inset-0 grid place-items-center bg-black/50 text-sm">
              {status === "capturing"
                ? "사진을 촬영하고 있습니다…"
                : "카메라를 준비하고 있습니다…"}
            </div>
          ) : null}
        </div>
        {!shot &&
        actualResolution &&
        (actualResolution.width < 1280 || actualResolution.height < 720) ? (
          <p className="px-5 pt-3 text-sm text-amber-200">
            현재 카메라 화질이 낮습니다. 글자가 흐리면 사진을 다시 찍거나 이미지
            선택을 이용해 주세요.
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="mx-5 mt-4 rounded-xl bg-red-500/15 p-3 text-sm text-red-100"
          >
            {error}
          </p>
        ) : null}
        <footer className="flex items-center justify-center gap-4 p-5">
          {shot ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setShot(null);
                  setStatus("ready");
                }}
                className="rounded-full border border-white/20 px-5 py-3 text-sm"
              >
                다시 촬영
              </button>
              <button
                type="button"
                onClick={usePhoto}
                className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#101511]"
              >
                이 사진으로 인식
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
