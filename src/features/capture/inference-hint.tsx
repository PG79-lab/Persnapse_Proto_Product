"use client";
import { matchesInferredField } from "../../domain/capture/inferred-fields";
export function InferenceHint({
  fields,
  path,
}: {
  fields: string[];
  path: string;
}) {
  return fields.some((field) => matchesInferredField(field, path)) ? (
    <span className="ml-2 text-xs font-normal text-amber-800">
      해석한 내용 · 확인 필요
    </span>
  ) : null;
}
