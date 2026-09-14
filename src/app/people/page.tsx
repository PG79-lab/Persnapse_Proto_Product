import Link from "next/link";
import { connection } from "next/server";

import { AppShell } from "../../components/app-shell";
import { getServerEnv } from "../../server/env";
import { listPeople } from "../../server/db/people-repository";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
});

export default async function PeoplePage() {
  await connection();
  const environment = getServerEnv();
  const people = await listPeople(environment.APP_DEFAULT_WORKSPACE_ID);
  const pendingActionCount = people.reduce(
    (sum, person) => sum + person.pendingActionCount,
    0,
  );

  return (
    <AppShell>
      <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
        <section className="grid gap-8 border-b border-[var(--border)] pb-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-sm font-semibold text-[var(--accent)]">Memory</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              만난 사람과 맥락
            </h1>
            <p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">
              이름이 아니라 만남, 소속, 기억과 약속을 함께 봅니다. 각 카드를
              열어 시간순 관계 맥락과 근거를 확인하세요.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <div className="min-w-32 rounded-2xl border border-[var(--border)] bg-white/75 p-4">
              <dt className="text-xs text-[var(--muted)]">기억한 사람</dt>
              <dd className="mt-1 text-2xl font-semibold">{people.length}</dd>
            </div>
            <div className="min-w-32 rounded-2xl border border-[var(--border)] bg-white/75 p-4">
              <dt className="text-xs text-[var(--muted)]">열린 행동</dt>
              <dd className="mt-1 text-2xl font-semibold text-[var(--accent)]">
                {pendingActionCount}
              </dd>
            </div>
          </dl>
        </section>

        <section className="pt-8">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-sm font-semibold">최근 맥락순</h2>
            <span className="text-xs text-[var(--muted)]">
              합성 Golden Dataset
            </span>
          </div>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {people.map((person) => (
              <li key={person.id}>
                <Link
                  href={`/people/${person.id}`}
                  className="group flex h-full min-h-64 flex-col rounded-3xl border border-[var(--border)] bg-[var(--surface)]/90 p-6 shadow-[0_18px_55px_rgba(24,45,32,0.04)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-[0_22px_65px_rgba(24,45,32,0.09)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-base font-semibold text-[var(--accent)]">
                      {person.displayName.slice(0, 1).toUpperCase()}
                    </div>
                    {person.hasDuplicateName ? (
                      <span className="rounded-full bg-[var(--draft-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--draft)]">
                        동명이인 구분
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-5">
                    <h3 className="text-xl font-semibold tracking-[-0.02em]">
                      {person.displayName}
                    </h3>
                    <p className="mt-1 min-h-10 text-sm leading-5 text-[var(--muted)]">
                      {person.headline ?? "소속과 역할을 확인 중입니다."}
                    </p>
                  </div>

                  <div className="mt-auto flex items-end justify-between border-t border-[var(--border)] pt-5">
                    <div className="flex gap-4 text-xs text-[var(--muted)]">
                      <span>만남 {person.interactionCount}</span>
                      <span
                        className={
                          person.pendingActionCount > 0
                            ? "font-medium text-[var(--accent)]"
                            : undefined
                        }
                      >
                        행동 {person.pendingActionCount}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--muted)] transition group-hover:text-[var(--accent)]">
                      {person.lastInteractionAt
                        ? dateFormatter.format(
                            new Date(person.lastInteractionAt),
                          )
                        : "기록 없음"}
                      <span className="ml-2" aria-hidden="true">
                        →
                      </span>
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </AppShell>
  );
}
