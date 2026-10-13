import type { BusinessCardExtractionV1 } from "./business-card-draft";

import {
  normalizeContactNumbers,
  normalizedContactNumber,
  type ContactNumber,
} from "../../../card_recognition/contact-numbers";

type Identity = BusinessCardExtractionV1["identity"];
export const criticalBusinessCardFields = [
  "displayName",
  "organizationName",
  "title",
  "emails",
  "phones",
] as const;

function normalized(
  field: keyof Identity,
  value: string | string[] | null,
): string | null {
  const parts = Array.isArray(value) ? value : value === null ? [] : [value];
  const clean = parts
    .map((item) => {
      const text = item.normalize("NFKC").trim();
      if (field === "phones") return text.replace(/[^\d+]/gu, "");
      if (field === "emails") return text.toLowerCase();
      return text.replace(/\s+/gu, " ");
    })
    .filter(Boolean)
    .sort();
  return clean.length ? clean.join("\n") : null;
}

export function evaluateBusinessCardExtraction(
  expected: Identity,
  actual: Identity,
) {
  const fields = criticalBusinessCardFields.map((field) => {
    const truth = normalized(field, expected[field]);
    const predicted = normalized(field, actual[field]);
    return {
      field,
      presentInCard: truth !== null,
      exact: truth === predicted,
      falsePositive: truth === null && predicted !== null,
    };
  });
  return {
    presentFields: fields.filter((field) => field.presentInCard).length,
    matchedPresentFields: fields.filter(
      (field) => field.presentInCard && field.exact,
    ).length,
    falsePositiveFields: fields.filter((field) => field.falsePositive).length,
    correctionFields: fields.filter((field) => !field.exact).length,
    fields,
    numberClassification:
      expected.contactNumbers === undefined
        ? null
        : evaluateContactNumberExtraction(
            expected.contactNumbers,
            actual.contactNumbers ??
              actual.phones.map((value) => ({
                type: "unknown",
                value,
                rawLabel: null,
              })),
          ),
  };
}

export function evaluateContactNumberExtraction(
  expected: ContactNumber[],
  actual: ContactNumber[],
) {
  const truth = normalizeContactNumbers(expected);
  const predicted = normalizeContactNumbers(actual);
  const key = (number: ContactNumber) =>
    `${number.type}:${normalizedContactNumber(number.value)}`;
  const expectedKeys = new Set(truth.map(key));
  const actualKeys = new Set(predicted.map(key));
  const actualDigits = new Set(
    predicted.map((number) => normalizedContactNumber(number.value)),
  );
  return {
    expectedCount: truth.length,
    actualCount: predicted.length,
    exactCount: truth.filter((number) => actualKeys.has(key(number))).length,
    digitMatchCount: truth.filter((number) =>
      actualDigits.has(normalizedContactNumber(number.value)),
    ).length,
    wrongTypeCount: truth.filter(
      (number) =>
        !actualKeys.has(key(number)) &&
        actualDigits.has(normalizedContactNumber(number.value)),
    ).length,
    missingCount: truth.filter(
      (number) => !actualDigits.has(normalizedContactNumber(number.value)),
    ).length,
    unexpectedCount: predicted.filter(
      (number) => !expectedKeys.has(key(number)),
    ).length,
  };
}
