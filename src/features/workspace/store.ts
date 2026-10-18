import type {
  WorkspaceMutation,
  WorkspaceSnapshot,
  WorkspaceState,
} from "../../domain/workspace/contracts";
import { compileWorkspaceMutation } from "./mutations";

export const emptyWorkspace = (): WorkspaceState => ({
  people: [],
  meetings: [],
  edges: [],
  personLinks: [],
  todos: [],
  messages: [],
  appliedRequestIds: [],
  conflicts: [],
  personaVersion: 0,
  mailDrafts: [],
});
type Snapshot = {
  state: WorkspaceState;
  ready: boolean;
  busy: boolean;
  status: string;
  error: string | null;
  capabilities: WorkspaceSnapshot["capabilities"];
  loadedAt: string | null;
  generation: number;
};
class RequestFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export function createWorkspaceStore(fetcher: typeof fetch = fetch) {
  let current: Snapshot = {
    state: emptyWorkspace(),
    ready: false,
    busy: false,
    status: "불러오는 중",
    error: null,
    capabilities: { aiMode: "mock", ocrMode: "mock", storage: "server" },
    loadedAt: null,
    generation: 0,
  };
  const listeners = new Set<() => void>();
  let initialized: Promise<void> | undefined;
  let pending: WorkspaceMutation | null = null;
  let lastWrite: Promise<boolean> = Promise.resolve(true);
  let readGeneration = 0;
  const publish = (value: Partial<Snapshot>) => {
    current = { ...current, ...value };
    listeners.forEach((listener) => listener());
  };
  async function request(mutation?: WorkspaceMutation) {
    const response = await fetcher("/api/workspace", {
      method: mutation ? "POST" : "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: mutation ? { "Content-Type": "application/json" } : undefined,
      body: mutation ? JSON.stringify(mutation) : undefined,
      signal: AbortSignal.timeout(65000),
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new RequestFailure(
        "서버 응답을 읽지 못했습니다. 연결을 확인해 주세요.",
        response.status,
      );
    }
    if (!response.ok)
      throw new RequestFailure(
        payload.error || "서버 저장에 실패했습니다.",
        response.status,
      );
    if (
      !payload.state ||
      !Array.isArray(payload.state.people) ||
      payload.capabilities?.storage !== "server"
    )
      throw new RequestFailure("서버 데이터 형식이 올바르지 않습니다.", 503);
    return payload as WorkspaceSnapshot;
  }
  function accept(value: WorkspaceSnapshot) {
    publish({
      ...value,
      ready: true,
      busy: false,
      status: value.capabilities.preview
        ? "합성 데이터 · 저장 안 함"
        : "저장됨",
      error: null,
      generation: current.generation + 1,
    });
  }
  async function reload() {
    if (current.busy || pending) return;
    const generation = ++readGeneration;
    try {
      const value = await request();
      if (generation === readGeneration && !current.busy) accept(value);
    } catch (error) {
      if (generation === readGeneration)
        publish({
          status: "연결 확인 필요",
          error:
            error instanceof Error ? error.message : "불러오지 못했습니다.",
        });
    }
  }
  async function send(mutation: WorkspaceMutation) {
    pending = mutation;
    ++readGeneration;
    publish({ busy: true, status: "서버에 저장 중", error: null });
    try {
      const result = await request(mutation);
      pending = null;
      accept(result);
      return true;
    } catch (error) {
      if (
        error instanceof RequestFailure &&
        error.status >= 400 &&
        error.status < 500
      )
        pending = null;
      publish({
        busy: false,
        status: pending ? "저장 결과 확인 필요" : "저장되지 않음",
        error:
          error instanceof Error ? error.message : "서버 저장에 실패했습니다.",
      });
      // A 409 refreshes canonical state while the editor's local draft remains mounted.
      if (error instanceof RequestFailure && error.status === 409) {
        const message = current.error;
        await reload();
        publish({ error: message, status: "최신 기록 확인 필요" });
      }
      throw error;
    }
  }
  return {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    initialize: () => (initialized ??= reload()),
    reload,
    async transact(
      fn: (state: WorkspaceState) => WorkspaceState,
      expectedVersions: Record<string, number> = {},
    ) {
      if (!current.ready) throw new Error("서버 기록을 먼저 불러와 주세요.");
      if (current.busy)
        throw new Error("앞선 저장이 끝난 뒤 다시 시도해 주세요.");
      if (pending)
        throw new Error(
          "이전 저장의 결과를 확인해야 합니다. 상단에서 저장 확인을 눌러 주세요.",
        );
      let mutation;
      try {
        mutation = compileWorkspaceMutation(
          current.state,
          fn(current.state),
          expectedVersions,
        );
      } catch (error) {
        const message =
          error instanceof Error && error.name !== "ZodError"
            ? error.message
            : "입력 항목의 길이·날짜·연락처를 확인해 주세요.";
        publish({ error: message, status: "입력 확인 필요" });
        throw new Error(message);
      }
      if (!mutation) return;
      const operation = send(mutation);
      lastWrite = operation.catch(() => false);
      await operation;
    },
    retry: async () => {
      if (pending) {
        const operation = send(pending);
        lastWrite = operation.catch(() => false);
        await operation;
      } else await reload();
    },
    flush: () => lastWrite,
  };
}
export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
