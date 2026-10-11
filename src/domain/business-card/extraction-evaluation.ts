import type { BusinessCardExtractionV1 } from "./business-card-draft";

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
  };
}
