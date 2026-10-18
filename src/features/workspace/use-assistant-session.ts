"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyContext,
  type AssistantResponse,
  type ContextSelection,
  type TurnRequest,
} from "../../domain/assistant/contracts";
type HistoryItem = { id: string; message: string; response: AssistantResponse };
type SessionView = {
  sessionId: string;
  version: number;
  context: AssistantResponse["context"];
  turns: {
    id: string;
    message: string;
    status: string;
    request_id: string;
    response: AssistantResponse | null;
    error_message: string | null;
  }[];
};
const storageKey = "persnapse.assistant.session.v1";
export function useAssistantSession(enabled: boolean) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [context, setContext] = useState(emptyContext);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [selection, setSelection] = useState<ContextSelection>({});
  const identity = useRef({ sessionId: "", version: 0 });
  const pending = useRef<TurnRequest | null>(null);
  const epoch = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const apply = useCallback((view: SessionView) => {
    identity.current = { sessionId: view.sessionId, version: view.version };
    setContext(view.context);
    setHistory(
      view.turns
        .filter((t) => t.status === "succeeded" && t.response)
        .map((t) => ({ id: t.id, message: t.message, response: t.response! })),
    );
    const latest = view.turns.at(-1);
    if (latest && ["failed", "unknown"].includes(latest.status))
      setNotice(latest.error_message ?? "이전 요청을 완료하지 못했습니다.");
    return view;
  }, []);
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `/api/assistant/sessions/${identity.current.sessionId}`,
        { signal, cache: "no-store" },
      );
      if (response.status === 404) return null;
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "대화를 불러오지 못했습니다.");
      return apply(data as SessionView);
    },
    [apply],
  );
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    requestController.current = abort;
    const saved = sessionStorage.getItem(storageKey);
    identity.current = { sessionId: saved ?? crypto.randomUUID(), version: 0 };
    sessionStorage.setItem(storageKey, identity.current.sessionId);
    if (saved) {
      queueMicrotask(() => setLoading(true));
      void reload(abort.signal)
        .then((view) => {
          if (!view && !abort.signal.aborted) {
            identity.current = { sessionId: crypto.randomUUID(), version: 0 };
            sessionStorage.setItem(storageKey, identity.current.sessionId);
          }
        })
        .catch((e) => {
          if (!abort.signal.aborted)
            setNotice(e instanceof Error ? e.message : "대화 복원 실패");
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }
    return () => {
      abort.abort();
    };
  }, [enabled, reload]);
  const reset = () => {
    requestController.current?.abort();
    epoch.current++;
    pending.current = null;
    identity.current = { sessionId: crypto.randomUUID(), version: 0 };
    sessionStorage.setItem(storageKey, identity.current.sessionId);
    setHistory([]);
    setContext(emptyContext());
    setSelection({});
    setNotice("");
    setLoading(false);
  };
  const send = async (
    message: string,
    signal: AbortSignal,
  ): Promise<AssistantResponse> => {
    const generation = epoch.current;
    if (!identity.current.sessionId) throw new Error("대화가 준비 중입니다.");
    // A lost response must be recovered/replayed before a different request can start.
    if (pending.current && pending.current.message !== message) {
      const view = await reload(signal);
      if (
        view?.turns.some(
          (t) =>
            t.request_id === pending.current?.requestId &&
            t.status === "processing",
        )
      )
        throw new Error(
          "이전 응답이 진행 중입니다. 잠시 후 다시 확인해 주세요.",
        );
      pending.current = null;
    }
    const payload = pending.current ?? {
      sessionId: identity.current.sessionId,
      requestId: crypto.randomUUID(),
      expectedVersion: identity.current.version,
      message,
      contextSelection: selection,
    };
    pending.current = payload;
    const result = await fetch("/api/assistant/turns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    let data = await result.json();
    if (!result.ok) {
      if (result.status === 409) {
        pending.current = null;
        await reload(signal);
      }
      // Server-known failure can be retried as a new request. Unknown transport failure keeps same ID.
      if (result.status !== 409) pending.current = null;
      throw new Error(data.error ?? "응답을 완료하지 못했습니다.");
    }
    if (result.status === 202) {
      const deadline = Date.now() + 65000;
      while (Date.now() < deadline) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          }, 1000);
          const onAbort = () => {
            clearTimeout(timer);
            reject(new Error("요청이 중단됐습니다."));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
        const view = await reload(signal);
        const turn = view?.turns.find(
          (t) => t.request_id === payload.requestId,
        );
        if (turn?.status === "succeeded" && turn.response) {
          data = turn.response;
          break;
        }
        if (turn && ["failed", "unknown"].includes(turn.status)) {
          pending.current = null;
          throw new Error(
            turn.error_message ?? "이전 요청을 완료하지 못했습니다.",
          );
        }
      }
      if (!data.schemaVersion)
        throw new Error(
          "응답이 아직 진행 중입니다. 같은 질문을 다시 보내면 상태를 확인합니다.",
        );
    }
    if (generation !== epoch.current)
      throw new Error("새 대화가 시작됐습니다.");
    const answer = data as AssistantResponse;
    identity.current.version = answer.version;
    setContext(answer.context);
    setSelection({});
    pending.current = null;
    setNotice("");
    setHistory((current) =>
      [
        ...current.filter((t) => t.id !== answer.turnId),
        { id: answer.turnId, message, response: answer },
      ].slice(-20),
    );
    return answer;
  };
  return {
    history,
    context,
    loading,
    notice,
    selection,
    setSelection,
    reset,
    send,
  };
}
