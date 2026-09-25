import { connection } from "next/server";

import { AppShell } from "../../components/app-shell";
import { CaptureWorkspaceSwitcher } from "../../features/capture/capture-workspace-switcher";
import { getServerEnv } from "../../server/env";

export default async function CapturePage() {
  await connection();
  const environment = getServerEnv();

  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-16">
        <section className="mb-9 max-w-3xl">
          <p className="text-sm font-semibold text-[var(--accent)]">
            Business Card + Context
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
            만남을 관계 기억으로
          </h1>
          <p className="mt-5 max-w-2xl leading-7 text-[var(--muted)]">
            실제 명함의 모습을 Digital Card로 보존하고, 연락처와 만남의 맥락을
            직접 검토한 뒤 해당 인물의 기억으로 저장합니다. 텍스트만으로 남기는
            흐름도 계속 사용할 수 있습니다.
          </p>
        </section>
        <CaptureWorkspaceSwitcher
          routingMode={environment.AI_ROUTING_MODE}
          businessCardOcrMode={environment.BUSINESS_CARD_OCR_MODE}
        />
      </main>
    </AppShell>
  );
}
