import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import type { CardCorners, CardPoint } from "../../card_recognition/geometry";

export interface DatasetImage {
  imageId: string;
  cardId: string;
  split: "development" | "tuning" | "holdout";
  kind: "normal" | "negative" | "invalid";
  tags: string[];
  file: string;
  sha256: string;
  width: number;
  height: number;
  corners: [number, number][] | null;
  manualCorners?: [number, number][];
  actualRatio: number | null;
  requiredRegions: {
    id: string;
    polygon: [number, number][];
    mask: string;
    maskSha256: string;
  }[];
}

export const sha256 = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
export const points = (values: [number, number][]) =>
  values.map(([x, y]) => ({ x, y })) as CardCorners;
export const regionPoints = (values: [number, number][]): CardPoint[] =>
  values.map(([x, y]) => ({ x, y }));

export function containedPath(directory: string, name: string): string {
  const path = resolve(directory, name);
  const rel = relative(directory, path);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Dataset path escapes root");
  return path;
}

export async function validateDataset(directory: string) {
  const raw = await readFile(resolve(directory, "manifest.json"));
  const manifest = JSON.parse(raw.toString()) as {
    schemaVersion: string;
    images: DatasetImage[];
  };
  if (
    manifest.schemaVersion !== "card-synthetic-v1" ||
    !Array.isArray(manifest.images)
  )
    throw new Error("Unsupported dataset");
  const errors: string[] = [];
  const counts = { normal: 0, negative: 0, invalid: 0 };
  const splits = { development: 0, tuning: 0, holdout: 0 };
  const cards = new Map<string, Set<string>>();
  const ids = new Set<string>();
  let verifiedFiles = 0;
  for (const row of manifest.images) {
    if (ids.has(row.imageId)) errors.push(`duplicate:${row.imageId}`);
    ids.add(row.imageId);
    counts[row.kind]++;
    const cardSplits = cards.get(row.cardId) ?? new Set<string>();
    cardSplits.add(row.split);
    cards.set(row.cardId, cardSplits);
    if (row.kind === "normal") {
      splits[row.split]++;
      if (
        !row.corners ||
        row.corners.length !== 4 ||
        !row.actualRatio ||
        row.requiredRegions.length !== 4
      )
        errors.push(`labels:${row.imageId}`);
    } else if (row.split !== "holdout")
      errors.push(`negative-not-held-out:${row.imageId}`);
    for (const [name, hash] of [
      [row.file, row.sha256],
      ...row.requiredRegions.map((r) => [r.mask, r.maskSha256]),
    ]) {
      try {
        if (sha256(await readFile(containedPath(directory, name))) !== hash)
          errors.push(`hash:${name}`);
        else verifiedFiles++;
      } catch {
        errors.push(`missing:${name}`);
      }
    }
  }
  const leakage = [...cards.values()].filter((v) => v.size !== 1).length;
  if (leakage) errors.push(`split-leakage:${leakage}`);
  if (
    counts.normal !== 1200 ||
    counts.negative !== 300 ||
    counts.invalid !== 200 ||
    splits.development !== 720 ||
    splits.tuning !== 240 ||
    splits.holdout !== 240
  )
    errors.push("sample-counts");
  return {
    manifest,
    report: {
      status: errors.length ? "FAIL" : "PASS",
      manifestSha256: sha256(raw),
      counts,
      splits,
      verifiedFiles,
      splitLeakage: leakage,
      errors,
    },
  };
}
