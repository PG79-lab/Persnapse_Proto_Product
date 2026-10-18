import type {
  WorkspaceSnapshot,
  WorkspaceState,
} from "../../../domain/workspace/contracts";

export const fixtureVersion = "FG-FIXTURE-01";
export const fixtureTime = "2026-10-13T03:00:00Z";
export const fixtureId = (kind: number, index: number) =>
  `${kind}0000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

// Synthetic records only. Alias and stable UUID mapping shared by preview and tests.
export function frontendGraphFixture(): WorkspaceState {
  const people: WorkspaceState["people"] = [
    ["김민수", "가온벤처스", "투자 심사역"],
    ["이서연", "온유 스튜디오", "제품 디자이너"],
    ["박지훈", "루프랩", "공동 창업자"],
    ["김민수", "모노웍스", "개발 리드"],
    ["정하은", "넥스트웨이브", "파트너십 매니저"],
    ["윤도현", "브릿지", "프로덕트 매니저"],
    ["최유진", "아카이브", "리서처"],
    ["한지우", "작은숲", "브랜드 디자이너"],
  ].map(([name, company, job], i) => ({
    id: fixtureId(1, i + 1),
    version: 1,
    deletedAt: null,
    name,
    company,
    job,
    email: `person${i + 1}@example.test`,
    phone: null,
    status: "unclassified",
    importance: 3,
    relationshipCategories: i < 4 ? ["networking"] : [],
    createdAt: "2026-09-01T03:00:00Z",
    history:
      i === 0
        ? [
            {
              id: fixtureId(5, 1),
              version: 1,
              deletedAt: null,
              date: "2026-09-18",
              text: "초기 제품의 사용 경험에 관심이 있다고 말씀하셨다. 다음 미팅 전에 제품 소개 자료를 전달하기로 했다.",
            },
          ]
        : [],
  }));
  const meetings: WorkspaceState["meetings"] = [
    [
      "가을 데모데이에서의 대화",
      "2026-09-18",
      "김민수 님, 이서연 님과 제품의 첫 사용 경험에 대해 대화했다. 제품 소개 자료를 보내기로 했다.",
    ],
    [
      "성수에서의 커피 미팅",
      "2026-10-06",
      "이서연 님, 박지훈 님과 초기 사용자 인터뷰 진행 방식을 이야기했다.",
    ],
    [
      "제품 연구 모임",
      "2026-10-10",
      "박지훈 님과 김민수 님(모노웍스)이 검색 경험과 협업 방식에 대해 의견을 나눴다.",
    ],
    [
      "파트너십 후속 대화",
      "2026-10-12",
      "정하은 님, 윤도현 님과 다음 협업 일정에 대해 논의했다.",
    ],
  ].map(([name, date, description], i) => ({
    id: fixtureId(2, i + 1),
    version: 1,
    deletedAt: null,
    name,
    date,
    description,
    occurredAt: null,
    placeType: "unclassified",
    guests: [],
    eventUrl: null,
    imageUrl: null,
    imageSourceUrl: null,
  }));
  return {
    people,
    meetings,
    edges: [
      [1, 1],
      [1, 2],
      [2, 2],
      [2, 3],
      [3, 3],
      [3, 4],
      [4, 5],
      [4, 6],
    ].map(([m, p], i) => ({
      id: fixtureId(3, i + 1),
      meetingId: fixtureId(2, m),
      personId: fixtureId(1, p),
      deletedAt: null,
    })),
    personLinks: [
      {
        id: fixtureId(6, 1),
        aId: fixtureId(1, 1),
        bId: fixtureId(1, 5),
        direction: "a-to-b",
      },
    ],
    todos: [
      {
        id: fixtureId(4, 1),
        version: 1,
        deletedAt: null,
        text: "제품 소개 자료 전달",
        personId: fixtureId(1, 1),
        personName: "김민수",
        date: "2026-10-20",
        time: null,
        done: false,
        source: "task",
        kind: "commitment",
        type: "material",
        importance: 3,
        createdAt: fixtureTime,
      },
    ],
    messages: [],
    appliedRequestIds: [],
    conflicts: [],
    personaVersion: 0,
    mailDrafts: [],
  };
}

export function frontendGraphSnapshot(): WorkspaceSnapshot {
  return {
    state: frontendGraphFixture(),
    loadedAt: fixtureTime,
    capabilities: {
      storage: "server",
      aiMode: "mock",
      ocrMode: "mock",
      preview: fixtureVersion,
    },
  };
}
