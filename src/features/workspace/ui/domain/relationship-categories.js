export const relationshipCategories = {
  project: "프로젝트",
  work: "업무",
  networking: "네트워킹",
  customer: "고객",
};

export function normalizeRelationshipCategories(values) {
  if (
    !Array.isArray(values) ||
    values.some((key) => !Object.hasOwn(relationshipCategories, key))
  )
    throw new Error("관계 용도를 확인해주세요.");
  return [...new Set(values)];
}

// Older records remain unclassified until the user explicitly chooses a purpose.
export const personCategories = (person) => person.relationshipCategories || [];

export function matchesRelationshipCategory(person, filter = "all") {
  if (filter == null || filter === "all") return true;
  const selected = Array.isArray(filter)
    ? filter
    : typeof filter === "object"
      ? Object.keys(filter).filter((key) => filter[key])
      : [filter];
  if (selected.includes("all")) return true;
  const categories = personCategories(person);
  return categories.length
    ? categories.some((key) => selected.includes(key))
    : selected.includes("unclassified");
}

export function categoryCounts(people) {
  const counts = Object.fromEntries(
    Object.keys(relationshipCategories).map((key) => [key, 0]),
  );
  counts.unclassified = 0;
  for (const person of people) {
    const categories = personCategories(person);
    if (!categories.length) counts.unclassified += 1;
    for (const key of categories)
      if (Object.hasOwn(counts, key)) counts[key] += 1;
  }
  return counts;
}
