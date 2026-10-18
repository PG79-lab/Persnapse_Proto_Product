"use client";
import { useState } from "react";
import type {
  AssistantContext,
  ContextSelection,
} from "../../domain/assistant/contracts";
import type { WorkspaceState } from "../../domain/workspace/contracts";
export function AssistantContextControls({
  context,
  selection,
  onChange,
  state,
  disabled,
  notice,
}: {
  context: AssistantContext;
  selection: ContextSelection;
  onChange: (s: ContextSelection) => void;
  state: WorkspaceState;
  disabled: boolean;
  notice: string;
}) {
  const [repairing, setRepairing] = useState(false);
  const [repairNotice, setRepairNotice] = useState("");
  const people = selection.personIds ?? context.personIds;
  const meeting =
    selection.interactionId !== undefined
      ? selection.interactionId
      : context.interactionId;
  const meetings = state.meetings.filter(
    (m) =>
      !m.deletedAt &&
      (!people.length ||
        state.edges.some(
          (edge) => edge.meetingId === m.id && people.includes(edge.personId),
        )),
  );
  const range = (kind: "meetingRange" | "dueRange") =>
    selection[kind] !== undefined ? selection[kind] : context[kind];
  function changeRange(kind: "meetingRange" | "dueRange", date: string) {
    if (!date) {
      onChange({ ...selection, [kind]: null });
      return;
    }
    const end = new Date(date + "T00:00:00Z");
    end.setUTCDate(end.getUTCDate() + 1);
    onChange({
      ...selection,
      [kind]: { from: date, toExclusive: end.toISOString().slice(0, 10) },
    });
  }
  async function repair() {
    setRepairing(true);
    setRepairNotice("");
    try {
      const response = await fetch("/api/assistant/index-retry", {
        method: "POST",
        signal: AbortSignal.timeout(45000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "검색 복구 실패");
      setRepairNotice(
        `${data.completed}개 기록의 의미 검색을 준비했습니다. 나머지는 자동 복구가 이어집니다.`,
      );
    } catch (error) {
      setRepairNotice(
        error instanceof Error ? error.message : "검색 복구 실패",
      );
    } finally {
      setRepairing(false);
    }
  }
  return (
    <div className="assistant-context-controls">
      <label>
        대화 대상{" "}
        <select
          aria-label="대화 대상"
          disabled={disabled}
          value={people[0] ?? ""}
          onChange={(e) =>
            onChange({
              ...selection,
              personIds: e.target.value ? [e.target.value] : [],
              interactionId: null,
            })
          }
        >
          <option value="">질문에서 결정</option>
          {state.people
            .filter((p) => !p.deletedAt)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.company ? ` · ${p.company}` : ""}
              </option>
            ))}
        </select>
      </label>
      <label>
        만남{" "}
        <select
          aria-label="대화 만남"
          disabled={disabled}
          value={meeting ?? ""}
          onChange={(e) =>
            onChange({
              ...selection,
              personIds: people,
              interactionId: e.target.value || null,
            })
          }
        >
          <option value="">질문에서 결정</option>
          {meetings.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} · {m.date ?? "날짜 미상"}
            </option>
          ))}
        </select>
      </label>
      <label>
        만남 날짜{" "}
        <input
          type="date"
          aria-label="만남 날짜 조건"
          disabled={disabled}
          value={range("meetingRange")?.from ?? ""}
          onChange={(e) => changeRange("meetingRange", e.target.value)}
        />
      </label>
      <label>
        기한 날짜{" "}
        <input
          type="date"
          aria-label="기한 날짜 조건"
          disabled={disabled}
          value={range("dueRange")?.from ?? ""}
          onChange={(e) => changeRange("dueRange", e.target.value)}
        />
      </label>
      {range("meetingRange") && (
        <span>
          만남 {range("meetingRange")!.from}부터{" "}
          {range("meetingRange")!.toExclusive} 이전
        </span>
      )}
      {range("dueRange") && (
        <span>
          기한 {range("dueRange")!.from}부터 {range("dueRange")!.toExclusive}{" "}
          이전
        </span>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onChange({
            personIds: [],
            interactionId: null,
            meetingRange: null,
            dueRange: null,
          })
        }
      >
        대상·기간 조건 해제
      </button>
      <button
        type="button"
        disabled={disabled || repairing}
        onClick={() => void repair()}
      >
        {repairing ? "검색 복구 중…" : "의미 검색 복구"}
      </button>
      {(notice || repairNotice) && (
        <span role="status">{repairNotice || notice}</span>
      )}
    </div>
  );
}
