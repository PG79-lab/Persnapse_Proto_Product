import { AppShell } from "../../components/app-shell";

export default function RecallLoading() {
  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <div className="mx-auto max-w-4xl animate-pulse text-center">
          <div className="mx-auto h-4 w-20 rounded bg-[var(--accent-soft)]" />
          <div className="mx-auto mt-5 h-12 w-3/4 rounded-2xl bg-white/80" />
          <div className="mt-9 h-16 rounded-2xl border border-[var(--border)] bg-white/75" />
        </div>
      </main>
    </AppShell>
  );
}
