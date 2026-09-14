const stages = ["Capture", "Context", "Memory", "Recall", "Action"];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-between px-6 py-10 sm:px-10 sm:py-14">
      <header className="flex items-center justify-between border-b border-[var(--border)] pb-5">
        <p className="text-sm font-semibold tracking-[0.18em] text-[var(--accent)] uppercase">
          Persnapse
        </p>
        <span className="rounded-full border border-[var(--border)] bg-white/75 px-3 py-1 text-xs text-[var(--muted)]">
          Foundation
        </span>
      </header>

      <section className="my-20 max-w-4xl">
        <p className="mb-5 text-sm font-medium text-[var(--accent)]">
          Business Relationship Memory
        </p>
        <h1 className="max-w-3xl text-4xl leading-tight font-semibold tracking-[-0.04em] sm:text-6xl">
          사람보다 먼저 사라지는 관계의 맥락을 기억합니다.
        </h1>
        <p className="mt-7 max-w-2xl text-base leading-7 text-[var(--muted)] sm:text-lg">
          명함과 만남의 맥락을 신뢰할 수 있는 관계 기억으로 만들고, 필요한 순간
          정확한 근거와 함께 다시 찾습니다.
        </p>

        <ol
          className="mt-12 grid gap-3 sm:grid-cols-5"
          aria-label="Persnapse core loop"
        >
          {stages.map((stage, index) => (
            <li
              key={stage}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/85 px-4 py-4 shadow-sm"
            >
              <span className="block text-xs text-[var(--muted)]">
                0{index + 1}
              </span>
              <span className="mt-2 block text-sm font-semibold">{stage}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-t border-[var(--border)] pt-5 text-xs text-[var(--muted)]">
        Capture → Context → Memory → Recall → Action
      </footer>
    </main>
  );
}
