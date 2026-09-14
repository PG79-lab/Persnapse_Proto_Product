"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <section className="max-w-md rounded-2xl border border-[var(--border)] bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold">화면을 불러오지 못했습니다.</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          저장된 내용은 변경되지 않았습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white"
        >
          다시 시도
        </button>
      </section>
    </main>
  );
}
