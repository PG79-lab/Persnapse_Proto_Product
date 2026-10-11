import { addTodo, newPerson, uid } from "./model.js";
import { todayStr } from "./dates.js";

export { taskTypes } from "./task-options.js";
export const tones = {
  formal: "정중한 비즈니스",
  friendly: "친근한 네트워킹",
  concise: "핵심 위주 간결한",
  energetic: "활기찬 제안",
};
export const mailPurposes = {
  hello: "첫 인사·커피챗",
  collaboration: "협업 제안",
  material: "자료·소개서 전달",
  followup: "후속 미팅",
};
export function registerCard(state, input, task = null) {
  if (!input.name?.trim()) throw new Error("이름을 입력해주세요.");
  const importance = Number(input.importance || 3);
  if (!Number.isInteger(importance) || importance < 1 || importance > 5)
    throw new Error("중요도를 확인해주세요.");
  const person = {
    ...newPerson({ ...input, name: input.name.trim() }),
    company: input.company?.trim() || "",
    importance,
    history: input.context?.trim()
      ? [{ id: uid("history"), text: input.context.trim(), date: todayStr() }]
      : [],
  };
  let next = { ...state, people: [...state.people, person] };
  if (input.date) {
    const meetingId = uid("meeting");
    next = {
      ...next,
      meetings: [
        ...next.meetings,
        {
          id: meetingId,
          name: "명함 교환",
          date: input.date,
          placeType: input.placeType || "unclassified",
        },
      ],
      edges: [
        ...next.edges,
        { id: uid("attendance"), personId: person.id, meetingId },
      ],
    };
  }
  if (task) next = addTodo(next, { ...task, personIdOverride: person.id });
  return { state: next, personId: person.id };
}
export function makeMailPreview(persona, person, purpose, reference = "") {
  const subject = `[${mailPurposes[purpose] || mailPurposes.hello}] ${persona.company || persona.name || "새로운 인연"} · ${person.name}님께`;
  const greeting =
    persona.tone === "friendly"
      ? `${person.name}님, 안녕하세요!`
      : persona.tone === "energetic"
        ? `${person.name}님, 반갑습니다! 새로운 가능성을 함께 이야기하고 싶습니다.`
        : `${person.name}님, 안녕하세요.`;
  const intent =
    {
      hello: "편하신 시간에 짧게 이야기를 나눌 수 있을까요?",
      collaboration: "서로 협력할 수 있는 접점을 함께 논의하고 싶습니다.",
      material:
        "관심 주신 내용에 대한 자료를 전달드리고자 합니다. 전달할 자료를 확인한 뒤 첨부하겠습니다.",
      followup:
        "지난 이야기에 이어 후속 미팅을 제안드립니다. 가능하신 일정을 알려주시면 감사하겠습니다.",
    }[purpose] || "";
  const body = [
    greeting,
    `${persona.company ? persona.company + " " : ""}${persona.role ? persona.role + " " : ""}${persona.name || "[발신자 이름]"}입니다.`,
    persona.bio ? `현재 ${persona.bio}` : "",
    reference ? `참고한 대화 내용:\n${reference}` : "",
    intent,
    persona.goal ? `관심 있는 교류 분야는 ${persona.goal}입니다.` : "",
    persona.tone === "concise"
      ? "확인 부탁드립니다. 감사합니다."
      : "시간 내어 읽어주셔서 감사합니다. 좋은 인연으로 이어지길 바랍니다.",
    [persona.name, persona.company, persona.email, persona.phone]
      .filter(Boolean)
      .join(" · "),
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject, body };
}
