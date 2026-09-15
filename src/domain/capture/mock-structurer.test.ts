import { describe, expect, it } from "vitest";

import { captureDraftV1Schema } from "./capture-draft";
import { structureTextCaptureMock } from "./mock-structurer";

describe("text capture mock structurer", () => {
  it("creates a valid editable draft from the Phase 4 sample note", () => {
    const draft = structureTextCaptureMock({
      rawText:
        "2026-09-12 스마트 물류 포럼에서 한울 모빌리티의 김민준 사업개발 리드를 만났다. 코엑스에서 부산 물류 실증과 AI Agent 도입에 관해 이야기했다. 다음 주까지 파일럿 제안서를 보내기로 했다.",
      referenceTime: "2026-09-15T10:00:00+09:00",
    });

    expect(captureDraftV1Schema.parse(draft)).toEqual(draft);
    expect(draft.identityHint).toEqual({
      displayName: "김민준",
      organizationName: "한울 모빌리티",
      title: "사업개발 리드",
    });
    expect(draft.interaction.eventName).toBe("스마트 물류 포럼");
    expect(draft.interaction.location).toBe("코엑스");
    expect(draft.topics).toContain("물류 실증");
    expect(draft.actions).toHaveLength(1);
  });

  it("keeps unknown identity fields nullable instead of inventing values", () => {
    const draft = structureTextCaptureMock({
      rawText: "오늘 새로운 파트너십 가능성에 관해 짧은 미팅을 진행했다.",
      referenceTime: "2026-09-15T10:00:00+09:00",
    });

    expect(draft.identityHint.displayName).toBeNull();
    expect(draft.identityHint.organizationName).toBeNull();
    expect(draft.identityHint.title).toBeNull();
    expect(captureDraftV1Schema.safeParse(draft).success).toBe(true);
  });
});
