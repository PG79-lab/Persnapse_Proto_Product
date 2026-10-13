"use client";

import { useRef, useState } from "react";
import type { CardCorners } from "./geometry";
import { isClockwiseConvex } from "./benchmark-metrics";

const initialCorners: CardCorners = [
  { x: 0.08, y: 0.08 },
  { x: 0.92, y: 0.08 },
  { x: 0.92, y: 0.92 },
  { x: 0.08, y: 0.92 },
];

const labels = ["왼쪽 위", "오른쪽 위", "오른쪽 아래", "왼쪽 아래"];

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function CardCornerEditor({
  imageUrl,
  onApply,
  onCancel,
  busy,
  seedCorners,
}: {
  imageUrl: string;
  onApply: (corners: CardCorners) => void;
  onCancel: () => void;
  busy: boolean;
  seedCorners?: CardCorners;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [corners, setCorners] = useState<CardCorners>(
    seedCorners ?? initialCorners,
  );

  function update(index: number, x: number, y: number) {
    setCorners(
      (current) =>
        current.map((point, pointIndex) =>
          pointIndex === index ? { x: clamp(x), y: clamp(y) } : point,
        ) as CardCorners,
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
      <h3 className="text-sm font-semibold">명함 네 모서리 지정</h3>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
        네 점을 명함 가장자리로 옮기세요. 방향키로도 미세 조정할 수 있습니다.
      </p>
      <div className="mt-4 overflow-auto rounded-xl bg-[#f5f4f8] p-3 text-center">
        <div className="relative inline-block max-w-full align-top">
          {/* The private photo is displayed at its exact intrinsic aspect ratio. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={imageUrl}
            alt="모서리를 지정할 촬영 원본"
            draggable={false}
            className="block max-h-[32rem] max-w-full select-none"
          />
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 size-full"
            aria-hidden="true"
          >
            <polygon
              points={corners
                .map((point) => `${point.x * 100},${point.y * 100}`)
                .join(" ")}
              fill="rgba(63,122,91,0.14)"
              stroke="white"
              strokeWidth="0.7"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {corners.map((point, index) => (
            <button
              key={index}
              type="button"
              aria-label={`${labels[index]} 모서리`}
              className="absolute grid size-7 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full border-2 border-white bg-[var(--accent)] text-[10px] font-bold text-white shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
              onPointerDown={(event) =>
                event.currentTarget.setPointerCapture(event.pointerId)
              }
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId))
                  return;
                const bounds = imageRef.current?.getBoundingClientRect();
                if (!bounds) return;
                update(
                  index,
                  (event.clientX - bounds.left) / bounds.width,
                  (event.clientY - bounds.top) / bounds.height,
                );
              }}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 0.01 : 0.005;
                if (event.key === "ArrowLeft")
                  update(index, point.x - step, point.y);
                else if (event.key === "ArrowRight")
                  update(index, point.x + step, point.y);
                else if (event.key === "ArrowUp")
                  update(index, point.x, point.y - step);
                else if (event.key === "ArrowDown")
                  update(index, point.x, point.y + step);
                else return;
                event.preventDefault();
              }}
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !isClockwiseConvex(corners)}
          onClick={() => onApply(corners)}
          className="rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          지정한 영역으로 보정
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-[var(--border)] px-5 py-3 text-sm"
        >
          취소
        </button>
      </div>
      {!isClockwiseConvex(corners) ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          모서리가 교차하거나 안쪽으로 꺾였습니다. 네 점의 위치를 수정하세요.
        </p>
      ) : null}
    </section>
  );
}
