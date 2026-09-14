import { AppShell } from "../../components/app-shell";

export default function PeopleLoading() {
  return (
    <AppShell>
      <main className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
        <div className="h-12 w-64 animate-pulse rounded-2xl bg-[var(--border)]" />
        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="h-64 animate-pulse rounded-3xl border border-[var(--border)] bg-white/60"
            />
          ))}
        </div>
      </main>
    </AppShell>
  );
}
