import { useState } from "react";
export default function StorageControls({ session }) {
  const [error, setError] = useState("");
  const archived = [
    ...session.state.people.map((p) => ({
      ...p,
      collection: "people",
      label: p.name,
    })),
    ...session.state.meetings.map((m) => ({
      ...m,
      collection: "meetings",
      label: m.name,
    })),
    ...session.state.todos.map((t) => ({
      ...t,
      collection: "todos",
      label: t.text,
    })),
  ].filter((row) => row.deletedAt);
  async function restore(row) {
    try {
      await session.store.transact((s) => ({
        ...s,
        [row.collection]: s[row.collection].map((value) =>
          value.id === row.id ? { ...value, deletedAt: null } : value,
        ),
      }));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <section className="server-storage-controls">
      <p>
        이 공간의 인맥·만남·할 일은 서버에 저장됩니다. 팀원은 같은 기록을 함께
        확인합니다.
      </p>
      <p>
        마지막 동기화:{" "}
        {session.loadedAt
          ? new Date(session.loadedAt).toLocaleTimeString("ko-KR", {
              timeZone: "Asia/Seoul",
            })
          : "연결 대기"}
      </p>
      <button
        className="secondary-button"
        disabled={session.busy}
        onClick={() => session.store.retry().catch((e) => setError(e.message))}
      >
        서버 기록 새로고침 · 저장 확인
      </button>
      <h3>삭제 보관함</h3>
      {archived.length ? (
        archived.map((row) => (
          <div className="archive-row" key={row.id}>
            <span>{row.label}</span>
            <button
              className="text-button"
              disabled={session.busy}
              onClick={() => restore(row)}
            >
              복원
            </button>
          </div>
        ))
      ) : (
        <p className="muted">보관된 기록이 없습니다.</p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </section>
  );
}
