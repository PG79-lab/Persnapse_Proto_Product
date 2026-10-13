import { z } from "zod";

export const contactNumberTypes = [
  "phone",
  "mobile",
  "fax",
  "unknown",
] as const;
export const contactNumberLabels = {
  phone: "전화",
  mobile: "휴대폰",
  fax: "팩스",
  unknown: "미분류",
} as const;

export const contactNumberSchema = z
  .object({
    type: z.enum(contactNumberTypes),
    value: z.string().trim().min(1).max(80),
    rawLabel: z.string().trim().min(1).max(40).nullable(),
  })
  .strict();
export type ContactNumber = z.infer<typeof contactNumberSchema>;
export interface ContactNumberIdentity {
  phones: string[];
  contactNumbers?: ContactNumber[];
}

export function classifyContactNumberLabel(
  label: string | null,
): ContactNumber["type"] {
  const key = (label ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s.:()]/gu, "")
    .replace(/^h\/p$/u, "hp");
  if (
    /^(?:tel|telephone|phone|t|p|전화|전화번호|대표전화|직통|직통전화)$/u.test(
      key,
    )
  )
    return "phone";
  if (
    /^(?:mobile|mob|m|hp|handphone|cell|cellular|휴대폰|휴대전화|핸드폰|휴대)$/u.test(
      key,
    )
  )
    return "mobile";
  if (/^(?:fax|facsimile|f|팩스)$/u.test(key)) return "fax";
  return "unknown";
}

export function normalizedContactNumber(value: string): string {
  return value.normalize("NFKC").replace(/[^\d+]/gu, "");
}

export function normalizeContactNumbers(
  numbers: ContactNumber[],
): ContactNumber[] {
  const result: ContactNumber[] = [];
  for (const number of numbers) {
    const value = number.value.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (!value) continue;
    const key = normalizedContactNumber(value);
    if (
      result.some(
        (item) =>
          item.type === number.type &&
          normalizedContactNumber(item.value) === key,
      )
    )
      continue;
    result.push({
      ...number,
      value,
      rawLabel: number.rawLabel?.normalize("NFKC").trim() || null,
    });
  }
  // A duplicate without a label adds no information when a classified entry exists.
  return result.filter(
    (number) =>
      number.type !== "unknown" ||
      number.rawLabel !== null ||
      !result.some(
        (other) =>
          other.type !== "unknown" &&
          normalizedContactNumber(other.value) ===
            normalizedContactNumber(number.value),
      ),
  );
}

export function getContactNumbers(
  identity: ContactNumberIdentity,
): ContactNumber[] {
  return normalizeContactNumbers(
    identity.contactNumbers ??
      identity.phones.map((value) => ({
        type: "unknown",
        value,
        rawLabel: null,
      })),
  );
}

export function voicePhoneValues(numbers: ContactNumber[]): string[] {
  const values = new Map<string, string>();
  for (const number of normalizeContactNumbers(numbers)) {
    if (number.type !== "fax")
      values.set(normalizedContactNumber(number.value), number.value);
  }
  return [...values.values()];
}

// Keep each line separate: a label on another contact row must not leak onto a number.
const numberPattern =
  /(?<![\d\p{L}])(?:\+\d|\(\d{1,4}\)|\d)[\d ().-]{5,}\d(?:\s*(?:ext\.?|extension|내선|x)\s*[:.]?\s*\d{1,6})?(?!\d)/giu;
const labelAtEnd =
  /(?:^|[\s|,;])((?:tel\s*\/\s*fax|t\s*\/\s*f|전화\s*\/\s*팩스)|(?:h\s*[./]\s*p\.?|telephone|phone|mobile|mob|handphone|cellular|cell|facsimile|fax|tel|hp|휴대전화|휴대폰|핸드폰|대표전화|직통전화|전화번호|직통|전화|휴대|팩스|[tmpf]))\s*[:.]?\s*$/iu;

export function extractContactNumbersFromLines(
  lines: string[],
): ContactNumber[] {
  const result: ContactNumber[] = [];
  let pendingLabel: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.normalize("NFKC").trim();
    const matches = [...line.matchAll(numberPattern)];
    let previousEnd = 0;
    for (const match of matches) {
      const prefix = line.slice(previousEnd, match.index);
      const label =
        prefix.match(labelAtEnd)?.[1] ??
        (previousEnd === 0 && !prefix.trim() ? pendingLabel : null);
      const value = match[0].trim();
      const digits = value.replace(/\D/gu, "").length;
      const nonContactLabel =
        /사업자|법인|등록번호|계좌|우편|account|registration|postal/iu.test(
          prefix,
        );
      // Labelled account/registration IDs must not become contacts.
      if (
        digits >= 7 &&
        digits <= 21 &&
        (label || !nonContactLabel) &&
        (label || /[+().-]/u.test(value) || /^\d{7,15}$/u.test(value))
      ) {
        result.push({
          type: classifyContactNumberLabel(label),
          value,
          rawLabel: label,
        });
      }
      previousEnd = match.index + match[0].length;
    }
    const standalone = line.match(labelAtEnd)?.[1] ?? null;
    pendingLabel =
      matches.length === 0 &&
      standalone &&
      line.replace(standalone, "").replace(/[\s.:]/gu, "") === ""
        ? standalone
        : null;
  }
  return normalizeContactNumbers(result).slice(0, 8);
}
