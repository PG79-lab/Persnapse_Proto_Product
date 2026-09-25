import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { AppShell } from "../../../components/app-shell";
import { DigitalBusinessCard } from "../../../components/digital-business-card";
import { EvidenceBadge } from "../../../components/evidence-badge";
import { buildProfileTimeline } from "../../../domain/profile-timeline";
import { getPersonProfile } from "../../../server/db/people-repository";
import { getServerEnv } from "../../../server/env";

const fullDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
});
const dueDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
});

const interactionLabels: Record<string, string> = {
  call: "통화",
  email: "이메일",
  event: "행사 만남",
  meeting: "미팅",
  message: "메시지",
  note: "메모",
};
const statementLabels: Record<string, string> = {
  context: "맥락",
  fact: "사실",
  interest: "관심",
  need: "필요",
  preference: "선호",
  relationship: "관계",
};
const actionLabels: Record<string, string> = {
  commitment: "약속",
  follow_up: "후속",
  suggestion: "제안",
};
const attributeLabels: Record<string, string> = {
  email: "이메일",
  linkedin: "LinkedIn",
  phone: "전화",
  website: "웹사이트",
};

export default async function PersonProfilePage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  await connection();
  const { personId } = await params;

  if (!z.uuid().safeParse(personId).success) {
    notFound();
  }

  const environment = getServerEnv();
  const profile = await getPersonProfile(
    environment.APP_DEFAULT_WORKSPACE_ID,
    personId,
  );

  if (!profile) {
    notFound();
  }

  const timeline = buildProfileTimeline(profile.interactions, profile.memories);
  const pendingActions = profile.actions.filter(
    (action) => action.status === "pending",
  );

  return (
    <AppShell>
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
        <Link
          href="/people"
          className="inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--accent)]"
        >
          <span aria-hidden="true">←</span> 모든 사람
        </Link>

        <section className="mt-7 rounded-[2rem] border border-[var(--border)] bg-[var(--surface)]/90 p-6 shadow-[0_20px_70px_rgba(24,45,32,0.06)] sm:p-9">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-start">
            <div className="flex items-start gap-5">
              <div className="flex size-16 shrink-0 items-center justify-center rounded-3xl bg-[var(--accent-soft)] text-xl font-semibold text-[var(--accent)]">
                {profile.displayName.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                    {profile.displayName}
                  </h1>
                  {profile.hasDuplicateName ? (
                    <span className="rounded-full bg-[var(--draft-soft)] px-3 py-1 text-xs font-medium text-[var(--draft)]">
                      동명이인 · 소속과 맥락으로 구분
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-base text-[var(--muted)]">
                  {profile.headline ?? "역할 확인 중"}
                </p>
                {profile.notes ? (
                  <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                    {profile.notes}
                  </p>
                ) : null}
              </div>
            </div>

            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl bg-[var(--background)] px-4 py-3">
                <dt className="text-[11px] text-[var(--muted)]">만남</dt>
                <dd className="mt-1 text-lg font-semibold">
                  {profile.interactions.length}
                </dd>
              </div>
              <div className="rounded-2xl bg-[var(--background)] px-4 py-3">
                <dt className="text-[11px] text-[var(--muted)]">기억</dt>
                <dd className="mt-1 text-lg font-semibold">
                  {profile.memories.length}
                </dd>
              </div>
              <div className="rounded-2xl bg-[var(--accent-soft)] px-4 py-3">
                <dt className="text-[11px] text-[var(--accent)]">열린 행동</dt>
                <dd className="mt-1 text-lg font-semibold text-[var(--accent)]">
                  {pendingActions.length}
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-8 grid gap-3 border-t border-[var(--border)] pt-6 sm:grid-cols-2 lg:grid-cols-3">
            {profile.affiliations.map((affiliation) => (
              <div key={affiliation.id} className="text-sm">
                <span className="block text-xs text-[var(--muted)]">소속</span>
                <span className="mt-1 block font-medium">
                  {affiliation.organizationName}
                  {affiliation.title ? ` · ${affiliation.title}` : ""}
                </span>
              </div>
            ))}
            {profile.attributes.map((attribute) => (
              <div key={attribute.id} className="text-sm">
                <span className="block text-xs text-[var(--muted)]">
                  {attributeLabels[attribute.kind] ?? attribute.kind}
                </span>
                <span className="mt-1 block break-all font-medium">
                  {attribute.value}
                </span>
              </div>
            ))}
            {profile.affiliations.length === 0 ? (
              <div className="text-sm">
                <span className="block text-xs text-[var(--muted)]">소속</span>
                <span className="mt-1 block font-medium text-[var(--draft)]">
                  확인 필요
                </span>
              </div>
            ) : null}
          </div>
        </section>

        {profile.businessCards.length > 0 ? (
          <section className="mt-8">
            <div className="mb-5">
              <p className="text-xs font-semibold tracking-[0.16em] text-[var(--accent)] uppercase">
                Digital business cards
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                저장된 실제 명함
              </h2>
            </div>
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {profile.businessCards.map((card) => (
                <DigitalBusinessCard
                  key={card.id}
                  imageUrl={card.imageUrl}
                  identity={card.identity}
                  badge={
                    card.originalRetained
                      ? "Original retained"
                      : "Display image only"
                  }
                />
              ))}
            </div>
          </section>
        ) : null}

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section>
            <div className="mb-5 flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold tracking-[0.16em] text-[var(--accent)] uppercase">
                  Context timeline
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                  관계의 시간순 맥락
                </h2>
              </div>
              <span className="text-xs text-[var(--muted)]">최신순</span>
            </div>

            <ol className="relative space-y-4 before:absolute before:top-5 before:bottom-5 before:left-[0.45rem] before:w-px before:bg-[var(--border-strong)]">
              {timeline.map((item) =>
                item.kind === "interaction" ? (
                  <li key={item.id} className="relative pl-8">
                    <span className="absolute top-6 left-0 size-4 rounded-full border-4 border-[var(--background)] bg-[var(--accent)]" />
                    <article className="rounded-3xl border border-[var(--border)] bg-white/85 p-5 sm:p-6">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-[var(--accent)]">
                            {item.interaction.occurredAt
                              ? fullDateFormatter.format(
                                  new Date(item.interaction.occurredAt),
                                )
                              : "만남 날짜 미상"}
                          </p>
                          <h3 className="mt-1 font-semibold">
                            {interactionLabels[
                              item.interaction.interactionType
                            ] ?? item.interaction.interactionType}
                            {item.interaction.eventName
                              ? ` · ${item.interaction.eventName}`
                              : ""}
                          </h3>
                        </div>
                        <EvidenceBadge
                          sourceKind={item.interaction.sourceKind}
                          verificationStatus={
                            item.interaction.verificationStatus
                          }
                        />
                      </div>
                      <p className="mt-4 leading-7">
                        {item.interaction.summary}
                      </p>
                      {item.interaction.location ||
                      item.interaction.topics.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                          {item.interaction.location ? (
                            <span className="rounded-full border border-[var(--border)] px-2.5 py-1">
                              {item.interaction.location}
                            </span>
                          ) : null}
                          {item.interaction.topics.map((topic) => (
                            <span
                              key={topic}
                              className="rounded-full border border-[var(--border)] px-2.5 py-1"
                            >
                              #{topic}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {item.memories.length > 0 ? (
                        <div className="mt-5 space-y-3 border-t border-[var(--border)] pt-5">
                          {item.memories.map((memory) => (
                            <div
                              key={memory.id}
                              className="rounded-2xl bg-[var(--background)] p-4"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-[var(--accent)]">
                                  {statementLabels[memory.statementType] ??
                                    memory.statementType}
                                </span>
                                <EvidenceBadge
                                  sourceKind={memory.sourceKind}
                                  verificationStatus={memory.verificationStatus}
                                />
                              </div>
                              <p className="mt-2 text-sm leading-6">
                                {memory.body}
                              </p>
                              {memory.sourceRef ? (
                                <p className="mt-2 text-xs text-[var(--muted)]">
                                  근거 · {memory.sourceRef}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  </li>
                ) : (
                  <li key={item.id} className="relative pl-8">
                    <span className="absolute top-6 left-0 size-4 rounded-full border-4 border-[var(--background)] bg-[var(--draft)]" />
                    <article className="rounded-3xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)]/70 p-5 sm:p-6">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-[var(--muted)]">
                          {item.occurredAt
                            ? fullDateFormatter.format(
                                new Date(item.occurredAt),
                              )
                            : "날짜 미상"}{" "}
                          · 독립 기억
                        </p>
                        <EvidenceBadge
                          sourceKind={item.memory.sourceKind}
                          verificationStatus={item.memory.verificationStatus}
                        />
                      </div>
                      <p className="mt-3 leading-7">{item.memory.body}</p>
                      {item.memory.sourceRef ? (
                        <p className="mt-2 text-xs text-[var(--muted)]">
                          근거 · {item.memory.sourceRef}
                        </p>
                      ) : null}
                    </article>
                  </li>
                ),
              )}
            </ol>
          </section>

          <aside className="space-y-5 lg:sticky lg:top-28 lg:self-start">
            <section className="rounded-3xl border border-[var(--border)] bg-[var(--foreground)] p-6 text-white shadow-[0_20px_60px_rgba(20,35,25,0.15)]">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">다음 행동</h2>
                <span className="rounded-full bg-white/12 px-2.5 py-1 text-xs">
                  {pendingActions.length}
                </span>
              </div>
              {pendingActions.length > 0 ? (
                <ul className="mt-5 space-y-4">
                  {pendingActions.map((action) => (
                    <li
                      key={action.id}
                      className="border-t border-white/12 pt-4 first:border-0 first:pt-0"
                    >
                      <div className="flex items-center justify-between gap-3 text-xs text-white/60">
                        <span>{actionLabels[action.kind] ?? action.kind}</span>
                        <span>
                          {action.dueAt
                            ? `${dueDateFormatter.format(new Date(action.dueAt))}까지`
                            : "기한 미정"}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium leading-6">
                        {action.title}
                      </p>
                      {action.details ? (
                        <p className="mt-1 text-xs leading-5 text-white/60">
                          {action.details}
                        </p>
                      ) : null}
                      {action.verificationStatus === "draft" ? (
                        <span className="mt-2 inline-block text-[11px] text-amber-200">
                          AI 제안 · 확인 필요
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm leading-6 text-white/60">
                  열려 있는 후속 행동이 없습니다.
                </p>
              )}
            </section>

            <section className="rounded-3xl border border-[var(--border)] bg-white/80 p-6">
              <h2 className="text-sm font-semibold">기억 원칙</h2>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                확인된 사실과 아직 검토가 필요한 추론을 구분합니다. 같은 이름은
                자동으로 합치지 않습니다.
              </p>
            </section>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
