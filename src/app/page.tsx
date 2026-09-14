import Link from "next/link";

import { AppShell } from "../components/app-shell";

const stages = ["Capture", "Context", "Memory", "Recall", "Action"];

export default function HomePage() {
  return (
    <AppShell>
      <main className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-20">
        <section className="grid min-h-[34rem] items-center gap-14 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <p className="mb-5 text-sm font-semibold text-[var(--accent)]">
              Business Relationship Memory
            </p>
            <h1 className="max-w-4xl text-5xl leading-[1.08] font-semibold tracking-[-0.055em] sm:text-7xl">
              사람보다 먼저 사라지는 관계의 맥락을 기억합니다.
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-8 text-[var(--muted)] sm:text-lg">
              명함과 만남의 맥락을 신뢰할 수 있는 관계 기억으로 만들고, 필요한
              순간 정확한 근거와 함께 다시 찾습니다.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                href="/recall"
                className="rounded-full bg-[var(--foreground)] px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5"
              >
                관계 기억에서 찾기
                <span className="ml-2" aria-hidden="true">
                  →
                </span>
              </Link>
              <Link
                href="/people"
                className="rounded-full border border-[var(--border-strong)] bg-white/70 px-6 py-3 text-sm font-semibold transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                사람 기억 보기
              </Link>
              <span className="text-xs text-[var(--muted)]">
                Phase 3 · 근거 기반 Recall
              </span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-8 -z-10 rounded-full bg-[var(--accent-soft)] blur-3xl" />
            <ol
              className="space-y-3 rounded-[2rem] border border-[var(--border)] bg-white/75 p-5 shadow-[0_30px_90px_rgba(24,45,32,0.1)] backdrop-blur sm:p-7"
              aria-label="Persnapse core loop"
            >
              {stages.map((stage, index) => (
                <li
                  key={stage}
                  className="flex items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-4"
                >
                  <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--background)] text-xs font-semibold text-[var(--muted)]">
                    0{index + 1}
                  </span>
                  <span className="text-sm font-semibold">{stage}</span>
                  {stage === "Recall" ? (
                    <span className="ml-auto rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--accent)] uppercase">
                      Live
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
