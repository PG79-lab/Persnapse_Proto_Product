// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceStore, emptyWorkspace } from "./store";
import { compileWorkspaceMutation } from "./mutations";
import type {
  WorkspaceState,
  WorkspaceTask,
} from "../../domain/workspace/contracts";
const id = "10000000-0000-4000-8000-000000000001";
const task: WorkspaceTask = {
  id,
  version: 1,
  source: "task",
  kind: null,
  deletedAt: null,
  createdAt: "2026-10-08",
  personId: null,
  personName: null,
  text: "Original",
  date: null,
  time: null,
  done: false,
  type: "general",
  importance: 3,
};
const initial = (): WorkspaceState => ({
  ...emptyWorkspace(),
  todos: [{ ...task }],
});
const payload = (state: WorkspaceState) => ({
  state,
  capabilities: { aiMode: "mock", ocrMode: "mock", storage: "server" },
  loadedAt: "2026-10-08T00:00:00Z",
});
const response = (state: WorkspaceState) => Response.json(payload(state));
describe("server-backed workspace", () => {
  it("does not display changed data or success until the server confirms it", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(initial()))
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
    const store = createWorkspaceStore(fetcher);
    await store.initialize();
    const saving = store.transact((s) => ({
      ...s,
      todos: s.todos.map((t) => ({ ...t, text: "Changed" })),
    }));
    expect(store.getSnapshot().state.todos[0].text).toBe("Original");
    expect(store.getSnapshot().busy).toBe(true);
    resolve(
      response({
        ...initial(),
        todos: [{ ...task, text: "Changed", version: 2 }],
      }),
    );
    await saving;
    expect(store.getSnapshot().state.todos[0].text).toBe("Changed");
    expect(store.getSnapshot().status).toBe("저장됨");
  });
  it("preserves canonical data and reuses an identical request after uncertain network failure", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(initial()))
      .mockRejectedValueOnce(new TypeError("Network failed"))
      .mockResolvedValueOnce(
        response({
          ...initial(),
          todos: [{ ...task, done: true, version: 2 }],
        }),
      );
    const store = createWorkspaceStore(fetcher);
    await store.initialize();
    await expect(
      store.transact((s) => ({ ...s, todos: [{ ...task, done: true }] })),
    ).rejects.toThrow();
    expect(store.getSnapshot().state.todos[0].done).toBe(false);
    await expect(store.transact((s) => s)).rejects.toThrow("이전 저장");
    await store.retry();
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body);
    expect(store.getSnapshot().state.todos[0].done).toBe(true);
  });
  it("refreshes after 409 without silently replaying the stale edit", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(initial()))
      .mockResolvedValueOnce(
        Response.json({ error: "Conflict" }, { status: 409 }),
      )
      .mockResolvedValueOnce(
        response({
          ...initial(),
          todos: [{ ...task, text: "Other device", version: 2 }],
        }),
      );
    const store = createWorkspaceStore(fetcher);
    await store.initialize();
    await expect(
      store.transact((s) => ({ ...s, todos: [{ ...task, text: "Mine" }] })),
    ).rejects.toThrow("Conflict");
    expect(store.getSnapshot().state.todos[0].text).toBe("Other device");
    expect(
      fetcher.mock.calls.filter((c) => c[1].method === "POST"),
    ).toHaveLength(1);
    expect(store.getSnapshot().error).toBe("Conflict");
  });
  it("prevents a late read from overwriting a confirmed mutation", async () => {
    let resolve!: (r: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(initial()))
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce(
        response({
          ...initial(),
          todos: [{ ...task, text: "Newer", version: 2 }],
        }),
      );
    const store = createWorkspaceStore(fetcher);
    await store.initialize();
    const stale = store.reload();
    await store.transact((s) => ({
      ...s,
      todos: [{ ...task, text: "Newer" }],
    }));
    resolve(response(initial()));
    await stale;
    expect(store.getSnapshot().state.todos[0].text).toBe("Newer");
  });
  it("compiles canonical clocks and preserves the editor's original revision", () => {
    const mutation = compileWorkspaceMutation(
      initial(),
      {
        ...initial(),
        todos: [{ ...task, date: "2026-10-08", time: "오후 2:30" }],
      },
      { [id]: 4 },
    );
    expect(mutation?.operations[0]).toMatchObject({
      type: "task.save",
      version: 4,
      source: "task",
      value: { time: "14:30", personId: null },
    });
  });
  it("does not turn incidental local messages into saved memory", () => {
    expect(compileWorkspaceMutation(initial(), initial())).toBeNull();
  });
});
