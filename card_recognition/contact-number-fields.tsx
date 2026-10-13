"use client";

import { useState } from "react";

import {
  contactNumberLabels,
  contactNumberTypes,
  getContactNumbers,
  normalizedContactNumber,
  voicePhoneValues,
  type ContactNumberIdentity,
  type ContactNumber,
} from "./contact-numbers";

const fieldLabels = {
  phone: "전화번호",
  mobile: "휴대폰 번호",
  fax: "팩스 번호",
  unknown: "미분류 번호",
} as const;

export function ContactNumberFields({
  identity,
  onChange,
}: {
  identity: ContactNumberIdentity;
  onChange: (numbers: ContactNumber[], phones: string[]) => void;
}) {
  const numbers = getContactNumbers(identity);
  const [editing, setEditing] = useState<{
    type: ContactNumber["type"];
    value: string;
  } | null>(null);
  return (
    <fieldset className="mt-5 rounded-xl border border-[var(--border)] p-4">
      <legend className="px-1 text-sm font-semibold">연락처 번호</legend>
      <p className="text-xs leading-5 text-[var(--muted)]">
        명함 표기로 구분했습니다. 분류가 다르면 번호를 해당 항목으로 옮겨
        주세요. 여러 번호는 줄바꿈으로 입력합니다.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {contactNumberTypes.map((type) => {
          const entries = numbers.filter((number) => number.type === type);
          const labels = [
            ...new Set(
              entries.map((number) => number.rawLabel).filter(Boolean),
            ),
          ];
          return (
            <label key={type}>
              <span className="text-sm font-semibold">{fieldLabels[type]}</span>
              <textarea
                rows={Math.max(1, entries.length)}
                value={
                  editing?.type === type
                    ? editing.value
                    : entries.map((number) => number.value).join("\n")
                }
                onBlur={() => setEditing(null)}
                onChange={(event) => {
                  setEditing({ type, value: event.target.value });
                  const replacements: ContactNumber[] = event.target.value
                    .split(/\r?\n|,/u)
                    .map((value) => value.trim())
                    .filter(Boolean)
                    .map((value) => ({
                      type,
                      value,
                      rawLabel:
                        entries.find(
                          (number) =>
                            normalizedContactNumber(number.value) ===
                            normalizedContactNumber(value),
                        )?.rawLabel ?? null,
                    }));
                  const updated = [
                    ...numbers.filter((number) => number.type !== type),
                    ...replacements,
                  ];
                  onChange(updated, voicePhoneValues(updated));
                }}
                className="mt-1.5 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
              />
              {labels.length > 0 && (
                <span className="text-xs text-[var(--muted)]">
                  인식 표기: {labels.join(", ")}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ContactNumberList({
  identity,
}: {
  identity: ContactNumberIdentity;
}) {
  const numbers = getContactNumbers(identity);
  if (!numbers.length) return null;
  return (
    <dl aria-label="명함 연락처 번호" className="mt-4 grid gap-2 text-sm">
      {numbers.map((number, index) => (
        <div
          key={`${number.type}:${index}`}
          className="flex flex-wrap gap-x-3 gap-y-1"
        >
          <dt className="font-semibold">{contactNumberLabels[number.type]}</dt>
          <dd>
            {number.value}
            {number.rawLabel && (
              <span className="ml-2 text-xs text-[var(--muted)]">
                ({number.rawLabel})
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
