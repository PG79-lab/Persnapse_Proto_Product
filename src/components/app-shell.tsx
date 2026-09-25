import Link from "next/link";

export function AppShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--background)]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-4">
          <Link href="/" className="flex shrink-0 items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--foreground)] text-sm font-semibold text-white">
              P
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-[0.16em] uppercase">
                Persnapse
              </span>
              <span className="block text-[11px] text-[var(--muted)]">
                Relationship memory
              </span>
            </span>
          </Link>

          <nav
            aria-label="주요 탐색"
            className="flex items-center gap-2 whitespace-nowrap text-center text-sm [&>a]:flex-1 sm:[&>a]:flex-none"
          >
            <Link
              href="/capture"
              className="rounded-full bg-[var(--accent)] px-4 py-2 font-medium text-white transition hover:-translate-y-0.5"
            >
              맥락 남기기
            </Link>
            <Link
              href="/recall"
              className="rounded-full border border-[var(--border)] bg-white/80 px-4 py-2 font-medium transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              기억 찾기
            </Link>
            <Link
              href="/people"
              className="rounded-full border border-[var(--border)] bg-white/80 px-4 py-2 font-medium transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              사람 기억
            </Link>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
