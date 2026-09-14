"use client";

export default function PeopleError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold text-[var(--accent)]">
        연결 확인 필요
      </p>
      <h1 className="mt-3 text-3xl font-semibold">
        관계 기억을 불러오지 못했습니다.
      </h1>
      <p className="mt-4 leading-7 text-[var(--muted)]">
        데이터베이스 연결 상태를 확인한 뒤 다시 시도해 주세요.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-7 rounded-full bg-[var(--foreground)] px-5 py-2.5 text-sm font-medium text-white"
      >
        다시 시도
      </button>
    </main>
  );
}
