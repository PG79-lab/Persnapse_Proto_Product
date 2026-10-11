"use client";

import { useState } from "react";

import type { BusinessCardDraftV1 } from "../domain/business-card/business-card-draft";

function safeWebsiteHref(value: string): string | null {
  try {
    const url = new URL(
      /^https?:\/\//iu.test(value) ? value : `https://${value}`,
    );
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function DigitalBusinessCard({
  imageUrl,
  draft,
  identity: identityProp,
  badge = "디지털 명함",
}: {
  imageUrl: string;
  draft?: BusinessCardDraftV1;
  identity?: BusinessCardDraftV1["identity"];
  badge?: string;
}) {
  const [side, setSide] = useState<"image" | "info">("image");
  const identity = identityProp ?? draft?.identity;

  if (!identity) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <span className="truncate text-xs font-semibold text-[var(--muted)]">
          {badge}
        </span>
        <div
          className="flex shrink-0 rounded-lg bg-[var(--background)] p-1 text-xs"
          role="tablist"
          aria-label="명함 보기"
        >
          <button
            type="button"
            role="tab"
            aria-selected={side === "image"}
            onClick={() => setSide("image")}
            className={`rounded-md px-3 py-1.5 font-medium ${side === "image" ? "bg-white text-[var(--foreground)] shadow-sm" : "text-[var(--muted)]"}`}
          >
            원본 이미지
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={side === "info"}
            onClick={() => setSide("info")}
            className={`rounded-md px-3 py-1.5 font-medium ${side === "info" ? "bg-white text-[var(--foreground)] shadow-sm" : "text-[var(--muted)]"}`}
          >
            디지털 명함
          </button>
        </div>
      </div>

      {side === "image" ? (
        <div className="grid min-h-[18rem] place-items-center bg-[#f5f4f8] p-4">
          {/* Private dynamic asset and local blob previews intentionally bypass optimization. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={`${identity.displayName ?? "인식 중"}의 명함 원본`}
            className="max-h-[26rem] max-w-full rounded-md object-contain shadow-sm"
          />
        </div>
      ) : (
        <div className="min-h-[18rem] p-6 sm:p-8">
          <div className="mb-6 h-1 w-10 rounded-full bg-[var(--accent)]" />
          <p className="text-2xl font-semibold tracking-tight">
            {identity.displayName ?? "이름 확인 필요"}
          </p>
          <p className="mt-1.5 text-sm text-[var(--muted)]">
            {[identity.organizationName, identity.department, identity.title]
              .filter(Boolean)
              .join(" · ") || "소속과 직함을 확인해 주세요"}
          </p>
          <div className="mt-7 space-y-3 border-t border-[var(--border)] pt-5 text-sm">
            {identity.phones.map((phone) => (
              <a
                key={phone}
                href={`tel:${phone.replace(/\s/gu, "")}`}
                className="block text-[var(--foreground)] hover:text-[var(--accent)]"
              >
                <span className="mr-3 inline-block w-12 text-[var(--muted)]">
                  전화
                </span>
                {phone}
              </a>
            ))}
            {identity.emails.map((email) => (
              <a
                key={email}
                href={`mailto:${email}`}
                className="block break-all text-[var(--foreground)] hover:text-[var(--accent)]"
              >
                <span className="mr-3 inline-block w-12 text-[var(--muted)]">
                  이메일
                </span>
                {email}
              </a>
            ))}
            {identity.websites.map((website) => {
              const href = safeWebsiteHref(website);
              return href ? (
                <a
                  key={website}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all text-[var(--foreground)] hover:text-[var(--accent)]"
                >
                  <span className="mr-3 inline-block w-12 text-[var(--muted)]">
                    웹
                  </span>
                  {website}
                </a>
              ) : (
                <p key={website}>
                  <span className="mr-3 inline-block w-12 text-[var(--muted)]">
                    웹
                  </span>
                  {website}
                </p>
              );
            })}
            {identity.address ? (
              <p>
                <span className="mr-3 inline-block w-12 text-[var(--muted)]">
                  주소
                </span>
                {identity.address}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
