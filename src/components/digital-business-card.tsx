"use client";

import { useState } from "react";

import type { BusinessCardDraftV1 } from "../domain/business-card/business-card-draft";

function safeWebsiteHref(value: string): string | null {
  try {
    const normalized = value.toLowerCase();
    const hasWebScheme =
      normalized.startsWith("http://") || normalized.startsWith("https://");
    const url = new URL(hasWebScheme ? value : "https://" + value);
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
  badge = "Digital card",
}: {
  imageUrl: string;
  draft?: BusinessCardDraftV1;
  identity?: BusinessCardDraftV1["identity"];
  badge?: string;
}) {
  const [side, setSide] = useState<"image" | "info">("image");
  const identity = identityProp ?? draft?.identity;

  if (!identity) {
    return null;
  }

  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-black/10 bg-[#111813] shadow-[0_22px_60px_rgba(14,29,20,0.18)]">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-white/55 uppercase">
          {badge}
        </span>
        <div className="flex rounded-full bg-white/10 p-1 text-xs">
          <button
            type="button"
            onClick={() => setSide("image")}
            className={`rounded-full px-3 py-1.5 ${
              side === "image" ? "bg-white text-black" : "text-white/70"
            }`}
          >
            명함
          </button>
          <button
            type="button"
            onClick={() => setSide("info")}
            className={`rounded-full px-3 py-1.5 ${
              side === "info" ? "bg-white text-black" : "text-white/70"
            }`}
          >
            정보
          </button>
        </div>
      </div>

      {side === "image" ? (
        <div className="relative aspect-[1.586/1] bg-[#e9ece8]">
          {/* Private dynamic asset and local blob previews intentionally bypass optimization. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={`${identity.displayName ?? "미확인"} 명함`}
            className="size-full object-contain"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-5 pt-12 pb-4 text-white">
            <p className="text-lg font-semibold">
              {identity.displayName ?? "이름 확인 필요"}
            </p>
            <p className="mt-0.5 text-xs text-white/75">
              {[identity.organizationName, identity.title]
                .filter(Boolean)
                .join(" · ") || "소속과 역할을 확인해 주세요"}
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-[16rem] bg-[linear-gradient(145deg,#f7f4ea,#e3eee6)] p-6">
          <p className="text-2xl font-semibold tracking-[-0.04em]">
            {identity.displayName ?? "이름 확인 필요"}
          </p>
          <p className="mt-2 text-sm text-black/60">
            {[identity.organizationName, identity.department, identity.title]
              .filter(Boolean)
              .join(" · ") || "소속 정보 없음"}
          </p>
          <div className="mt-7 flex flex-wrap gap-2">
            {identity.phones.map((phone) => (
              <a
                key={phone}
                href={`tel:${phone.replace(/\s/g, "")}`}
                className="rounded-full bg-white/75 px-3 py-2 text-xs font-medium"
              >
                전화 {phone}
              </a>
            ))}
            {identity.emails.map((email) => (
              <a
                key={email}
                href={`mailto:${email}`}
                className="rounded-full bg-white/75 px-3 py-2 text-xs font-medium"
              >
                메일 {email}
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
                  className="rounded-full bg-white/75 px-3 py-2 text-xs font-medium"
                >
                  웹사이트
                </a>
              ) : (
                <span
                  key={website}
                  className="rounded-full bg-white/75 px-3 py-2 text-xs font-medium"
                >
                  {website}
                </span>
              );
            })}
          </div>
          {identity.address ? (
            <p className="mt-6 text-xs leading-5 text-black/55">
              {identity.address}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
