// Identity tint is stable across list, canvas and detail. It encodes no relationship score.
export function identityTone(id: string) {
  return [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
}
