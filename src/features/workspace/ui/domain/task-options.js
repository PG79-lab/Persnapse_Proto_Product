export const taskTypes = {
  mail: "메일 송부",
  call: "전화·연락",
  coffee: "커피챗",
  meeting: "미팅·회의",
  material: "자료 송부",
  general: "일반 일정",
};
export function taskMeta(input) {
  const type = input.type || "general";
  const importance = Number(input.importance || 3);
  if (
    !Object.hasOwn(taskTypes, type) ||
    !Number.isInteger(importance) ||
    importance < 1 ||
    importance > 5
  )
    throw new Error("할 일 유형과 중요도를 확인해주세요.");
  return { type, importance };
}
