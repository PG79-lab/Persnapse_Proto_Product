"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  Search,
  Sparkles,
  Plus,
  ContactRound,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  ArrowUpRight,
  RotateCcw,
} from "lucide-react";
import { TextCaptureWorkspace } from "../capture/text-capture-workspace";
import { SearchPreparation } from "../recall/search-preparation";
import type { RecallResponse } from "../../domain/recall/types";
import type { WorkspaceStore } from "./store";
import { Modal } from "./ui/components/ui.jsx";

type Session = ReturnType<WorkspaceStore["getSnapshot"]> & {
  store: WorkspaceStore;
};
type Entry = {
  id: string;
  question: string;
  response: RecallResponse;
  elapsedMs: number;
  feedback?: string;
};
export default function Assistant({
  open,
  embedded,
  host,
  focusSignal,
  seed,
  onClose,
  session,
  onSelect,
  onOpenTasks,
  onCard,
}: {
  open: boolean;
  embedded: boolean;
  host: HTMLElement | null;
  focusSignal: number;
  seed: { question: string; version: number };
  onClose: () => void;
  session: Session;
  onSelect: (id: string) => void;
  onOpenTasks: (id: string) => void;
  onCard: () => void;
}) {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preparation, setPreparation] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordText, setRecordText] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const controller = useRef<AbortController | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const handlePrepared = useCallback(() => {
    setPreparation(false);
    setError("검색 준비가 완료됐습니다. 질문을 다시 보내 주세요.");
  }, []);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (focusSignal) input.current?.focus();
  }, [focusSignal]);
  useEffect(() => {
    if (!seed.version || !seed.question) return;
    const frame = requestAnimationFrame(() => {
      setQuery(seed.question);
      input.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [seed]);
  useEffect(() => {
    thread.current?.scrollTo({
      top: thread.current.scrollHeight,
      behavior: "smooth",
    });
  }, [entries, busy]);
  async function search(event: FormEvent) {
    event.preventDefault();
    if (busy || query.trim().length < 2) return;
    const question = query.trim();
    const started = performance.now();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setPreparation(false);
    try {
      const response = await fetch("/api/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: question,
          referenceTime: new Date().toISOString(),
        }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(70000)]),
      });
      const data = await response.json();
      if (!response.ok) {
        setPreparation(data.code === "SEARCH_NOT_READY");
        throw new Error(data.error || "기록을 찾지 못했습니다.");
      }
      const elapsedMs = Math.min(
        300000,
        Math.round(performance.now() - started),
      );
      setEntries((current) =>
        [
          ...current,
          {
            id: crypto.randomUUID(),
            question,
            response: data as RecallResponse,
            elapsedMs,
          },
        ].slice(-20),
      );
      setQuery("");
      if (data.queryId)
        void fetch("/api/recall/observation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queryId: data.queryId, elapsedMs }),
        }).catch(() => {});
    } catch (caught) {
      if (!abort.signal.aborted)
        setError(
          caught instanceof Error
            ? caught.message
            : "검색 요청이 실패했습니다.",
        );
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  async function feedback(entry: Entry, kind: "helpful" | "not_helpful") {
    setFeedbackBusy(entry.id);
    setError("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queryId: entry.response.queryId,
          kind,
          comment: null,
          elapsedMs: entry.elapsedMs,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new Error("피드백을 저장하지 못했습니다. 다시 시도해 주세요.");
      setEntries((current) =>
        current.map((item) =>
          item.id === entry.id ? { ...item, feedback: kind } : item,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "피드백 저장 실패");
    } finally {
      setFeedbackBusy(null);
    }
  }
  const panel = (
    <section className="connected-assistant" aria-label="AI 어시스턴트">
      <header className="connected-assistant-header">
        <span className="ai-mark">
          <Sparkles size={20} />
        </span>
        <div>
          <h2>AI 어시스턴트</h2>
          <p>
            {session.capabilities.aiMode === "live"
              ? "저장된 기억을 근거로 사람과 약속을 찾아요"
              : "기본 검색 모드 · 실제 AI 분석 미사용"}
          </p>
        </div>
        {entries.length > 0 && (
          <button
            type="button"
            className="icon-button"
            aria-label="검색 대화 비우기"
            title="검색 대화 비우기 · 저장된 기록은 유지됩니다"
            disabled={busy}
            onClick={() => {
              setEntries([]);
              setError("");
              input.current?.focus();
            }}
          >
            <RotateCcw size={17} />
          </button>
        )}
      </header>
      <div
        className="connected-thread"
        ref={thread}
        aria-live="polite"
        aria-busy={busy}
      >
        {!entries.length && !busy && (
          <div className="assistant-welcome">
            <span className="assistant-eyebrow">
              <Search size={15} /> 나의 관계 기억
            </span>
            <h3>이름보다, 기억나는 이야기로.</h3>
            <p>
              이름이 기억나지 않아도 만난 장소, 나눈 이야기, 약속으로
              찾아보세요.
            </p>
            <div className="assistant-examples">
              {[
                ["만남 다시 찾기", "지난달 행사에서 만난 사람"],
                ["약속 확인하기", "제안서를 보내기로 한 사람"],
                ["대화 맥락 찾기", "AI 도입에 관해 이야기한 사람"],
              ].map(([label, text]) => (
                <button
                  key={text}
                  onClick={() => {
                    setQuery(text);
                    input.current?.focus();
                  }}
                >
                  <span>
                    <small>{label}</small>
                    {text}
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
            {!session.state.people.length && (
              <button className="text-button" onClick={onCard}>
                먼저 명함을 등록해 보세요 <ArrowUpRight size={15} />
              </button>
            )}
          </div>
        )}
        {entries.map((entry) => (
          <article className="chat-exchange" key={entry.id}>
            <p className="chat-question">{entry.question}</p>
            <div className="chat-answer">
              <span className="answer-label">
                {entry.response.status === "ambiguous"
                  ? "인물 확인 필요"
                  : entry.response.status === "no_result"
                    ? "관련 기록 없음"
                    : "기억에서 찾았어요"}
              </span>
              <p>{entry.response.answer}</p>
              {entry.response.status === "no_result" && (
                <div className="recall-recovery">
                  <p>회사, 행사명, 나눈 이야기를 더해 다시 찾아보세요.</p>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setQuery(entry.question);
                      input.current?.focus();
                    }}
                  >
                    질문 수정하기
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setRecordText("");
                      setRecording(true);
                    }}
                  >
                    기억 직접 남기기
                  </button>
                </div>
              )}
              {entry.response.clarification && (
                <p className="info-box">{entry.response.clarification}</p>
              )}
              {entry.response.results.map((result) => (
                <section className="answer-person" key={result.personId}>
                  <div className="answer-person-heading">
                    <div>
                      <strong>{result.displayName}</strong>
                      <span>
                        {result.organizations.join(" · ") ||
                          result.headline ||
                          "소속 정보 없음"}
                      </span>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => onSelect(result.personId)}
                    >
                      프로필 보기 <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <p>{result.reason}</p>
                  {result.evidence[0] && (
                    <div className="answer-evidence">
                      <span>이 사람을 찾은 근거</span>
                      <blockquote>
                        {result.evidence[0].excerpt}
                        <small>
                          {result.evidence[0].occurredAt
                            ? new Date(
                                result.evidence[0].occurredAt,
                              ).toLocaleDateString("ko-KR", {
                                timeZone: "Asia/Seoul",
                              })
                            : "날짜 미상"}
                        </small>
                      </blockquote>
                    </div>
                  )}
                  {result.evidence.length > 1 && (
                    <details>
                      <summary>
                        추가 근거 {result.evidence.length - 1}개 보기
                      </summary>
                      {result.evidence.slice(1).map((evidence) => (
                        <blockquote key={`${evidence.type}:${evidence.id}`}>
                          {evidence.excerpt}
                          <small>
                            {evidence.occurredAt
                              ? new Date(
                                  evidence.occurredAt,
                                ).toLocaleDateString("ko-KR", {
                                  timeZone: "Asia/Seoul",
                                })
                              : "날짜 미상"}
                          </small>
                        </blockquote>
                      ))}
                    </details>
                  )}
                  {result.storedActions.map((action) => (
                    <p className="stored-action" key={action.id}>
                      <strong>
                        {action.kind === "commitment"
                          ? "기록된 약속"
                          : action.kind === "suggestion"
                            ? "저장된 제안"
                            : "후속 업무"}
                      </strong>{" "}
                      {action.title}{" "}
                      <span>
                        {action.status === "completed" ? "완료" : "미완료"}
                      </span>
                    </p>
                  ))}
                  {result.storedActions.some(
                    (action) => action.status !== "completed",
                  ) && (
                    <button
                      type="button"
                      className="answer-next-action"
                      onClick={() => onOpenTasks(result.personId)}
                    >
                      이 사람의 할 일 확인하기 <ArrowUpRight size={15} />
                    </button>
                  )}
                  {result.suggestion && (
                    <p className="suggested-action">
                      <strong>AI 제안</strong> {result.suggestion.title}
                      <small>{result.suggestion.rationale}</small>
                    </p>
                  )}
                </section>
              ))}
              {entry.response.queryId && (
                <div className="answer-feedback">
                  {entry.feedback ? (
                    <span>피드백이 저장되었습니다.</span>
                  ) : (
                    <>
                      <span>도움이 되었나요?</span>
                      <button
                        aria-label="도움이 됐어요"
                        disabled={feedbackBusy !== null}
                        onClick={() => feedback(entry, "helpful")}
                      >
                        <ThumbsUp size={15} />
                      </button>
                      <button
                        aria-label="도움이 안 됐어요"
                        disabled={feedbackBusy !== null}
                        onClick={() => feedback(entry, "not_helpful")}
                      >
                        <ThumbsDown size={15} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </article>
        ))}
        {busy && (
          <p className="assistant-thinking" role="status">
            <Loader2 size={17} className="spin" />
            관련 기록과 근거를 확인하고 있어요…
          </p>
        )}
      </div>
      {error && (
        <p className="error-text assistant-error" role="alert">
          {error}
        </p>
      )}
      {preparation && (
        <div className="assistant-preparation">
          <SearchPreparation onPrepared={handlePrepared} />
        </div>
      )}
      <form onSubmit={search} className="connected-composer">
        <textarea
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="찾고 싶은 사람이나 약속을 물어보세요"
          aria-label="AI에게 질문"
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="composer-actions">
          <div>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setRecordText(query);
                setRecording(true);
              }}
            >
              <Plus size={16} />
              기록 남기기
            </button>
            <button type="button" className="text-button" onClick={onCard}>
              <ContactRound size={16} />
              명함 등록
            </button>
          </div>
          <button
            className="primary-button send-question"
            aria-label="질문 보내기"
            disabled={busy || query.trim().length < 2}
          >
            {busy ? <Loader2 size={18} /> : <ArrowUp size={18} />}
          </button>
        </div>
      </form>
      <p className="assistant-footnote">
        저장된 기록에서 찾고, 답변의 근거를 함께 보여드려요.
      </p>
    </section>
  );
  return (
    <>
      {embedded && host ? (
        createPortal(panel, host)
      ) : open ? (
        <Modal
          title="AI 어시스턴트"
          onClose={onClose}
          wide
          drawer={false}
          className="assistant-dialog"
        >
          {panel}
        </Modal>
      ) : null}
      {recording && (
        <Modal
          title="AI로 기록하기"
          onClose={() => setRecording(false)}
          wide
          drawer={false}
          className="capture-dialog"
        >
          <TextCaptureWorkspace
            routingMode={session.capabilities.aiMode}
            initialText={recordText}
            onSaved={() => {
              session.store.reload();
            }}
            onViewPerson={(id) => {
              setRecording(false);
              onSelect(id);
            }}
            onFindMemory={(question) => {
              setRecording(false);
              setQuery(question);
              input.current?.focus();
            }}
          />
        </Modal>
      )}
    </>
  );
}
