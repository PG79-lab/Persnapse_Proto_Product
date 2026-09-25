import { z } from "zod";

import {
  businessCardExtractionSchemaVersion,
  type BusinessCardExtractionV1,
} from "./business-card-draft";

const textItemSchema = z
  .object({
    text: z.string().optional(),
  })
  .passthrough();

const textItemsSchema = z.preprocess(
  (value) => (Array.isArray(value) ? value : []),
  z.array(textItemSchema),
);

const nameCardResultSchema = z
  .object({
    name: textItemsSchema,
    company: textItemsSchema,
    address: textItemsSchema,
    position: textItemsSchema,
    department: textItemsSchema,
    mobile: textItemsSchema,
    tel: textItemsSchema,
    fax: textItemsSchema,
    email: textItemsSchema,
    homepage: textItemsSchema,
  })
  .passthrough();

const generalFieldSchema = z
  .object({
    inferText: z.string().optional(),
    lineBreak: z.boolean().optional(),
    boundingPoly: z
      .object({
        vertices: z
          .array(
            z
              .object({
                x: z.number().optional(),
                y: z.number().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const responseSchema = z
  .object({
    images: z
      .array(
        z
          .object({
            inferResult: z.enum(["SUCCESS", "FAILURE", "ERROR"]),
            fields: z.array(generalFieldSchema).optional(),
            nameCard: z
              .object({ result: nameCardResultSchema })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

export class ClovaNameCardResponseError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super("CLOVA OCR did not return a usable business card result.");
    this.name = "ClovaNameCardResponseError";
  }
}

function cleanText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function values(items: z.infer<typeof textItemsSchema>): string[] {
  const normalized = items
    .map((item) => (item.text ? cleanText(item.text) : ""))
    .filter(Boolean);

  return [...new Set(normalized)];
}

function first(items: z.infer<typeof textItemsSchema>): string | null {
  return values(items)[0] ?? null;
}

function limited(items: z.infer<typeof textItemsSchema>, limit: number) {
  return values(items).slice(0, limit);
}

function joined(items: z.infer<typeof textItemsSchema>): string | null {
  const parts = values(items);
  return parts.length > 0 ? parts.join(" ").slice(0, 500) : null;
}

interface GeneralLine {
  text: string;
  height: number;
  index: number;
}

function fieldHeight(field: z.infer<typeof generalFieldSchema>): number {
  const yValues = (field.boundingPoly?.vertices ?? [])
    .map((vertex) => vertex.y)
    .filter((value): value is number => typeof value === "number");
  return yValues.length > 1 ? Math.max(...yValues) - Math.min(...yValues) : 0;
}

function generalLines(
  fields: Array<z.infer<typeof generalFieldSchema>>,
): GeneralLine[] {
  const lines: GeneralLine[] = [];
  let words: string[] = [];
  let height = 0;
  let startIndex = 0;

  fields.forEach((field, index) => {
    const text = field.inferText ? cleanText(field.inferText) : "";
    if (text) {
      if (words.length === 0) startIndex = index;
      words.push(text);
      height = Math.max(height, fieldHeight(field));
    }
    if (field.lineBreak && words.length > 0) {
      lines.push({ text: words.join(" "), height, index: startIndex });
      words = [];
      height = 0;
    }
  });

  if (words.length > 0) {
    lines.push({ text: words.join(" "), height, index: startIndex });
  }
  return lines;
}

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => cleanText(match[0]));
}

function hasMatch(text: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  const matched = pattern.test(text);
  pattern.lastIndex = 0;
  return matched;
}

function unique(items: string[], limit: number): string[] {
  return [...new Set(items.filter(Boolean))].slice(0, limit);
}

const emailPattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/giu;
const phonePattern = /\+?\d[\d\s().-]{6,}\d/gu;
const websitePattern =
  /(?:https?:\/\/|www\.)[^\s]+|(?:[a-z0-9-]+\.)+(?:com|net|org|io|ai|dev|co\.kr|kr|example)(?:\/[^\s]*)?/giu;
const addressPattern =
  /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|전라|경상|제주|특별시|광역시|[가-힣]+[시군구]\s|\S+[로길]\s*\d|street|road|avenue|address)/iu;
const departmentPattern =
  /(팀|부서|본부|사업부|연구소|센터|division|department|team)$/iu;
const titlePattern =
  /(대표|사장|부사장|전무|상무|이사|부장|차장|과장|대리|주임|매니저|리드|책임|선임|연구원|ceo|cto|coo|cfo|founder|director|manager|lead|principal|partner|engineer|designer|developer|consultant)/iu;
const organizationPattern =
  /(주식회사|\(주\)|㈜|corp|corporation|inc|ltd|company|labs?|systems?|ventures?|studio|agency|group|foundation|university|대학교|협회|재단|연구원)/iu;

function stripContactLabel(text: string): string {
  return text
    .replace(
      /^(?:(?:m|t|p|e|w|a)(?:\s*[:.]\s*|\s+)|(?:tel|phone|email|web|address)\s*[:.]?\s*)/iu,
      "",
    )
    .trim();
}

function generalExtraction(
  fields: Array<z.infer<typeof generalFieldSchema>>,
): BusinessCardExtractionV1 {
  const lines = generalLines(fields);
  const text = lines.map((line) => line.text).join("\n");
  const emails = unique(matches(text, emailPattern), 3);
  const websites = unique(
    matches(text, websitePattern).filter(
      (website) => !emails.some((email) => email.includes(website)),
    ),
    3,
  );
  const phones = unique(matches(text, phonePattern), 4);
  const candidates = lines
    .flatMap((line) =>
      line.text.split(/[|·]/u).map((part) => ({
        ...line,
        text: stripContactLabel(cleanText(part)),
      })),
    )
    .filter(
      (line) =>
        line.text &&
        !hasMatch(line.text, emailPattern) &&
        !hasMatch(line.text, phonePattern) &&
        !hasMatch(line.text, websitePattern),
    );

  const addressParts = candidates
    .filter((line) => addressPattern.test(line.text))
    .map((line) => line.text);
  const title =
    candidates.find((line) => titlePattern.test(line.text))?.text ?? null;
  const department =
    candidates.find((line) => departmentPattern.test(line.text))?.text ?? null;
  const organizationName =
    candidates.find((line) => organizationPattern.test(line.text))?.text ??
    null;
  const excluded = new Set(
    [title, department, organizationName, ...addressParts].filter(
      (value): value is string => value !== null,
    ),
  );
  const ambiguousShortNames =
    !organizationName &&
    candidates.filter(
      (line) => !excluded.has(line.text) && /^[가-힣]{2,5}$/u.test(line.text),
    ).length > 1;
  const displayName = ambiguousShortNames
    ? null
    : (candidates
        .filter(
          (line) =>
            !excluded.has(line.text) &&
            line.text.length >= 2 &&
            line.text.length <= 80 &&
            !/^(?:m|t|e|w|a)$/iu.test(line.text),
        )
        .sort((left, right) => {
          const leftKoreanName = /^[가-힣]{2,5}$/u.test(left.text) ? 100 : 0;
          const rightKoreanName = /^[가-힣]{2,5}$/u.test(right.text) ? 100 : 0;
          return (
            rightKoreanName +
            right.height -
            right.index * 0.01 -
            (leftKoreanName + left.height - left.index * 0.01)
          );
        })[0]?.text ?? null);
  const address =
    addressParts.length > 0 ? addressParts.join(" ").slice(0, 500) : null;
  const observedFields = [
    displayName ? "identity.displayName" : null,
    organizationName ? "identity.organizationName" : null,
    title ? "identity.title" : null,
    department ? "identity.department" : null,
    emails.length > 0 ? "identity.emails" : null,
    phones.length > 0 ? "identity.phones" : null,
    websites.length > 0 ? "identity.websites" : null,
    address ? "identity.address" : null,
  ].filter((field): field is string => field !== null);

  if (observedFields.length === 0) {
    throw new ClovaNameCardResponseError("CLOVA_NO_FIELDS_DETECTED", false);
  }

  return {
    schemaVersion: businessCardExtractionSchemaVersion,
    identity: {
      displayName,
      organizationName,
      title,
      department,
      emails,
      phones,
      websites,
      address,
    },
    observedFields,
  };
}

export function extractClovaNameCard(
  payload: unknown,
): BusinessCardExtractionV1 {
  const parsed = responseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new ClovaNameCardResponseError("CLOVA_RESPONSE_SHAPE_INVALID", false);
  }

  const image = parsed.data.images[0];
  if (image.inferResult !== "SUCCESS") {
    throw new ClovaNameCardResponseError(
      image.inferResult === "ERROR"
        ? "CLOVA_INFERENCE_ERROR"
        : "CLOVA_INFERENCE_FAILURE",
      image.inferResult === "ERROR",
    );
  }

  const result = image.nameCard?.result;
  if (!result && image.fields) {
    return generalExtraction(image.fields);
  }
  if (!result) {
    throw new ClovaNameCardResponseError(
      "CLOVA_NAME_CARD_RESULT_MISSING",
      false,
    );
  }

  const displayName = first(result.name);
  const organizationName = first(result.company);
  const title = first(result.position);
  const department = first(result.department);
  const emails = limited(result.email, 3);
  const phones = [
    ...new Set([...values(result.mobile), ...values(result.tel)]),
  ].slice(0, 4);
  const websites = limited(result.homepage, 3);
  const address = joined(result.address);
  const observedFields = [
    displayName ? "identity.displayName" : null,
    organizationName ? "identity.organizationName" : null,
    title ? "identity.title" : null,
    department ? "identity.department" : null,
    emails.length > 0 ? "identity.emails" : null,
    phones.length > 0 ? "identity.phones" : null,
    websites.length > 0 ? "identity.websites" : null,
    address ? "identity.address" : null,
  ].filter((field): field is string => field !== null);

  if (observedFields.length === 0) {
    throw new ClovaNameCardResponseError("CLOVA_NO_FIELDS_DETECTED", false);
  }

  return {
    schemaVersion: businessCardExtractionSchemaVersion,
    identity: {
      displayName,
      organizationName,
      title,
      department,
      emails,
      phones,
      websites,
      address,
    },
    observedFields,
  };
}
