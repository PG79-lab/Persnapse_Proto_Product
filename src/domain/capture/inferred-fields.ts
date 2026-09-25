// Live responses can append an explanation to a field path.
export function matchesInferredField(field: string, path: string): boolean {
  const value = field.trim();
  return (
    value === path ||
    (value.startsWith(path) && /^[.\[:\s]/u.test(value.slice(path.length)))
  );
}
