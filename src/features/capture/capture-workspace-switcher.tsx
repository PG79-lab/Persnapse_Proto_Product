"use client";

import { useState } from "react";

import { BusinessCardWorkspace } from "./business-card-workspace";
import { TextCaptureWorkspace } from "./text-capture-workspace";

export function CaptureWorkspaceSwitcher({
  routingMode,
  businessCardOcrMode,
}: {
  routingMode: "mock" | "live";
  businessCardOcrMode: "mock" | "live";
}) {
  const [mode, setMode] = useState<"card" | "text">("card");

  return (
    <section>
      <div className="mb-7 inline-flex rounded-full border border-[var(--border)] bg-white/80 p-1">
        <button
          type="button"
          onClick={() => setMode("card")}
          className={`rounded-full px-5 py-2.5 text-sm font-semibold transition ${
            mode === "card"
              ? "bg-[var(--foreground)] text-white"
              : "text-[var(--muted)]"
          }`}
        >
          명함 촬영
        </button>
        <button
          type="button"
          onClick={() => setMode("text")}
          className={`rounded-full px-5 py-2.5 text-sm font-semibold transition ${
            mode === "text"
              ? "bg-[var(--foreground)] text-white"
              : "text-[var(--muted)]"
          }`}
        >
          텍스트 메모
        </button>
      </div>
      <p className="mb-4 text-sm text-[var(--muted)]">
        {routingMode === "live"
          ? "만남 맥락은 AI로 정리합니다. 추정된 내용은 저장 전에 확인해 주세요."
          : "만남 맥락은 테스트용 기본 처리입니다. 실제 AI 이해는 사용하지 않습니다."}
      </p>
      <div hidden={mode !== "card"}>
        <BusinessCardWorkspace ocrMode={businessCardOcrMode} />
      </div>
      <div hidden={mode !== "text"}>
        <TextCaptureWorkspace routingMode={routingMode} />
      </div>
    </section>
  );
}
