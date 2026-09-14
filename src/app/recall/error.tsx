"use client";

import { AppShell } from "../../components/app-shell";

export default function RecallError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AppShell>
      <main className="mx-auto max-w-3xl px-5 py-20 text-center sm:px-8">
        <p className="text-sm font-semibold text-[var(--draft)]">Recall 오류</p>
        <h1 className="mt-3 text-3xl font-semibold">
          지금은 관계 기억을 불러오지 못했습니다.
        </h1>
        <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
          데이터 연결을 확인한 뒤 다시 시도해 주세요. 입력한 검색어는 변경되지
          않습니다.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-7 rounded-full bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-white"
        >
          다시 시도
        </button>
      </main>
    </AppShell>
  );
}
