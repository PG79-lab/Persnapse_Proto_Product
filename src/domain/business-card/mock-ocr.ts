import type { BusinessCardExtractionV1 } from "./business-card-draft";

const fixtures = [
  {
    displayName: "박서연",
    organizationName: "Persnapse Labs",
    title: "Product Lead",
    department: "Product",
    emails: ["seoyeon.park@example.com"],
    phones: ["010-2456-7812"],
    contactNumbers: [
      { type: "mobile", value: "010-2456-7812", rawLabel: "HP" },
    ],
    websites: ["https://persnapse.example"],
    address: "서울특별시 강남구 테헤란로 152",
  },
  {
    displayName: "이도윤",
    organizationName: "Northstar Ventures",
    title: "Principal",
    department: "Investment Team",
    emails: ["doyun.lee@example.com"],
    phones: ["02-6200-1034"],
    contactNumbers: [{ type: "phone", value: "02-6200-1034", rawLabel: "Tel" }],
    websites: ["https://northstar.example"],
    address: "서울특별시 영등포구 국제금융로 10",
  },
  {
    displayName: "Mina Chen",
    organizationName: "Orbit Systems",
    title: "Partnerships Director",
    department: null,
    emails: ["mina.chen@example.com"],
    phones: ["+82 10 8891 2046"],
    contactNumbers: [
      { type: "mobile", value: "+82 10 8891 2046", rawLabel: "Mobile" },
    ],
    websites: ["https://orbit.example"],
    address: "서울특별시 성동구 아차산로 17",
  },
] as const;

function fixtureIndex(seed: string): number {
  let hash = 0;

  for (const character of seed.normalize("NFKC")) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }

  return hash % fixtures.length;
}

export function extractBusinessCardMock(input: {
  filename: string;
  sha256: string;
}): BusinessCardExtractionV1 {
  const identity = fixtures[fixtureIndex(`${input.filename}:${input.sha256}`)];

  return {
    schemaVersion: "business-card-extraction-v1",
    identity: {
      ...identity,
      emails: [...identity.emails],
      phones: [...identity.phones],
      contactNumbers: identity.contactNumbers.map((number) => ({ ...number })),
      websites: [...identity.websites],
    },
    observedFields: [
      "identity.displayName",
      "identity.organizationName",
      "identity.title",
      "identity.emails",
      "identity.phones",
      "identity.contactNumbers",
      "identity.websites",
      "identity.address",
    ],
  };
}
