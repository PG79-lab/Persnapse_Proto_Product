"use client";
import type { AssistantResponse } from "../../domain/assistant/contracts";
const labels = {
  fact: "확인된 사실",
  interpretation: "맥락 해석",
  suggestion: "AI 제안",
  draft: "준비 초안",
};
export function AssistantResultSections({
  response,
}: {
  response: AssistantResponse;
}) {
  const evidence = response.recall.results.flatMap((p) =>
    p.evidence.map((e) => ({
      key: e.type + ":" + e.id,
      text: e.excerpt,
      provenance: e.provenance,
    })),
  );
  return (
    <>
      {response.coverage.status !== "normal" && (
        <aside className="assistant-coverage" aria-label="검색 범위 안내">
          {response.coverage.reasons.map((r, i) => (
            <p key={i}>{r}</p>
          ))}
        </aside>
      )}
      {response.sections.map((section, i) => (
        <section key={i} className="assistant-section">
          <h4>
            {labels[section.type]} · {section.title}
          </h4>
          <p>{section.text}</p>
          <details>
            <summary>이 내용의 근거 {section.evidenceKeys.length}개</summary>
            {section.evidenceKeys.map((key) => {
              const source = evidence.find((e) => e.key === key);
              return (
                <blockquote key={key}>
                  {source?.text ?? "현재 기록에서 근거를 다시 확인해 주세요."}
                  {source?.provenance?.map((p, i) => (
                    <small key={i}>
                      입력 출처: {p.sourceKind} ·{" "}
                      {new Date(p.capturedAt).toLocaleDateString("ko-KR", {
                        timeZone: "Asia/Seoul",
                      })}
                      {p.originalText && <span> · 원문: {p.originalText}</span>}
                    </small>
                  ))}
                </blockquote>
              );
            })}
          </details>
          {section.type === "draft" && (
            <small>검토용 초안입니다. 저장하거나 발송하지 않았습니다.</small>
          )}
        </section>
      ))}
    </>
  );
}
