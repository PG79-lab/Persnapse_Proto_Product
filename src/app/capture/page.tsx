import { connection } from "next/server";

import { AppShell } from "../../components/app-shell";
import { TextCaptureWorkspace } from "../../features/capture/text-capture-workspace";
import { getServerEnv } from "../../server/env";

export default async function CapturePage() {
  await connection();
  const environment = getServerEnv();

  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-16">
        <section className="mb-9 max-w-3xl">
          <p className="text-sm font-semibold text-[var(--accent)]">
            Text Capture
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
            만남을 관계 기억으로
          </h1>
          <p className="mt-5 max-w-2xl leading-7 text-[var(--muted)]">
            자유롭게 남긴 메모를 구조화하고, 모든 값을 직접 검토한 뒤 Person과
            연결합니다. 확인 전 Draft는 검색이나 Profile에 노출되지 않습니다.
          </p>
        </section>
        <TextCaptureWorkspace routingMode={environment.AI_ROUTING_MODE} />
      </main>
    </AppShell>
  );
}
