import { useEffect, useState, useSyncExternalStore } from "react";
import { createWorkspaceStore } from "../../store";
export function useContactStore() {
  const [store] = useState(() => createWorkspaceStore());
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    store.initialize();
    const refresh = () => {
      if (
        document.visibilityState === "visible" &&
        !document.querySelector("dialog[open]")
      )
        store.reload();
    };
    const interval = setInterval(refresh, 30000);
    const beforeUnload = (event) => {
      if (
        store.getSnapshot().busy ||
        store.getSnapshot().status === "저장 결과 확인 필요"
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [store]);
  return { ...snapshot, store };
}
