"use client";

import { useRef, useState } from "react";

export function CardViewer({
  imageUrl,
  originalUrl,
  label = "디지털 명함",
}: {
  imageUrl: string;
  originalUrl?: string;
  label?: string;
}) {
  const [side, setSide] = useState<"restored" | "original">("restored");
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const showingOriginal = side === "original" && Boolean(originalUrl);

  function zoom(factor: number) {
    setScale((current) =>
      Math.min(4, Math.max(1, +(current * factor).toFixed(2))),
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <span className="text-xs font-semibold text-[var(--muted)]">
          {label}
        </span>
        <div className="flex items-center gap-2 text-xs">
          {originalUrl ? (
            <div className="mr-2 flex rounded-lg bg-[var(--background)] p-1">
              <button
                type="button"
                aria-pressed={!showingOriginal}
                onClick={() => setSide("restored")}
                className={`rounded-md px-2.5 py-1.5 ${!showingOriginal ? "bg-white shadow-sm" : "text-[var(--muted)]"}`}
              >
                표시 이미지
              </button>
              <button
                type="button"
                aria-pressed={showingOriginal}
                onClick={() => setSide("original")}
                className={`rounded-md px-2.5 py-1.5 ${showingOriginal ? "bg-white shadow-sm" : "text-[var(--muted)]"}`}
              >
                촬영 원본
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => zoom(1 / 1.25)}
            aria-label="축소"
            className="rounded-md border px-2.5 py-1.5"
          >
            −
          </button>
          <span className="min-w-10 text-center tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => zoom(1.25)}
            aria-label="확대"
            className="rounded-md border px-2.5 py-1.5"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => {
              setScale(1);
              setPosition({ x: 0, y: 0 });
            }}
            className="rounded-md border px-2.5 py-1.5"
          >
            초기화
          </button>
        </div>
      </div>
      <div
        tabIndex={0}
        aria-label="명함 이미지. 드래그하거나 방향키로 이동할 수 있습니다."
        onPointerDown={(event) => {
          pointer.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!pointer.current) return;
          const deltaX = event.clientX - pointer.current.x;
          const deltaY = event.clientY - pointer.current.y;
          pointer.current = { x: event.clientX, y: event.clientY };
          setPosition((current) => ({
            x: current.x + deltaX,
            y: current.y + deltaY,
          }));
        }}
        onPointerUp={() => {
          pointer.current = null;
        }}
        onPointerCancel={() => {
          pointer.current = null;
        }}
        onKeyDown={(event) => {
          const move = 24;
          if (event.key === "ArrowLeft")
            setPosition((p) => ({ ...p, x: p.x - move }));
          else if (event.key === "ArrowRight")
            setPosition((p) => ({ ...p, x: p.x + move }));
          else if (event.key === "ArrowUp")
            setPosition((p) => ({ ...p, y: p.y - move }));
          else if (event.key === "ArrowDown")
            setPosition((p) => ({ ...p, y: p.y + move }));
          else return;
          event.preventDefault();
        }}
        className="grid min-h-[18rem] cursor-grab place-items-center overflow-hidden bg-[#f5f4f8] p-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] active:cursor-grabbing"
        style={{ touchAction: scale > 1 ? "none" : "pan-y" }}
      >
        {/* Private image URLs intentionally bypass Next image optimization. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={showingOriginal ? originalUrl : imageUrl}
          alt={showingOriginal ? "촬영한 명함 원본" : "표시 중인 명함"}
          draggable={false}
          className="max-h-[32rem] max-w-full select-none rounded-md object-contain shadow-sm"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          }}
        />
      </div>
    </section>
  );
}
