import { AppShell } from "../../components/app-shell";
import { RecallWorkspace } from "../../features/recall/recall-workspace";

export default async function RecallPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const value = (await searchParams).q;
  const query = (Array.isArray(value) ? value[0] : value) ?? "";
  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
        <RecallWorkspace initialQuery={query.slice(0, 500)} />
      </main>
    </AppShell>
  );
}
