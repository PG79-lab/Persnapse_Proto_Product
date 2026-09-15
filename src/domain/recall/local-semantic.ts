import { normalizeRecallText } from "./query-parser";

const dimensions = 96;
const concepts: Record<string, string[]> = {
  action: ["연락", "후속", "약속", "보내", "전달", "제안서", "연결"],
  bio: ["바이오", "콜드체인", "샌드박스"],
  global: ["글로벌", "일본", "동남아", "해외", "진출"],
  investment: ["투자", "심사", "지표", "벤처스"],
  logistics: ["물류", "모빌리티", "배송", "경로", "실증"],
  memory: ["기억", "맥락", "명함", "관계", "메모"],
  partnership: ["파트너", "파트너십", "제휴", "소개"],
  security: ["보안", "승인", "검토"],
};

function hashFeature(feature: string): number {
  let hash = 2166136261;

  for (let index = 0; index < feature.length; index += 1) {
    hash ^= feature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function features(value: string): Set<string> {
  const normalized = normalizeRecallText(value);
  const result = new Set<string>();

  for (const token of normalized.split(" ").filter(Boolean)) {
    result.add(`token:${token}`);

    if (token.length >= 3) {
      for (let index = 0; index < token.length - 1; index += 1) {
        result.add(`bigram:${token.slice(index, index + 2)}`);
      }
    }
  }

  for (const [concept, aliases] of Object.entries(concepts)) {
    if (aliases.some((alias) => normalized.includes(alias))) {
      result.add(`concept:${concept}`);
    }
  }

  return result;
}

export function hasLocalSemanticSignal(left: string, right: string): boolean {
  const leftFeatures = features(left);
  const rightFeatures = features(right);

  return [...leftFeatures].some(
    (feature) =>
      (feature.startsWith("token:") || feature.startsWith("concept:")) &&
      rightFeatures.has(feature),
  );
}

export function localSemanticVector(value: string): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);

  for (const feature of features(value)) {
    const hash = hashFeature(feature);
    const index = hash % dimensions;
    const sign = (hash & 1) === 0 ? 1 : -1;
    vector[index] += sign;
  }

  const magnitude = Math.sqrt(
    vector.reduce((sum, component) => sum + component * component, 0),
  );

  return magnitude === 0
    ? vector
    : vector.map((component) => component / magnitude);
}

export function localSemanticSimilarity(left: string, right: string): number {
  const leftVector = localSemanticVector(left);
  const rightVector = localSemanticVector(right);
  const similarity = leftVector.reduce(
    (sum, component, index) => sum + component * rightVector[index],
    0,
  );

  return Math.max(0, Math.min(1, similarity));
}
