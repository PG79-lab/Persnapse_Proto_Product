import { useEffect, useRef, useState } from "react";
import { X, Users, ArrowUpRight } from "lucide-react";

export const statuses = {
  success: { label: "성공", color: "#26735e" },
  pending: { label: "대기", color: "#6943b5" },
  failed: { label: "실패", color: "#aa4258" },
  unclassified: { label: "미분류", color: "#59677b" },
};
export const places = {
  expo: "전시·행사",
  industrial: "산업단지",
  client_site: "고객사 방문",
  unclassified: "기타 만남",
};
export function SaveError({ error, store }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  if (!error) return null;
  return (
    <div role="alert" className="error-text">
      <p>{message || error}</p>
      {store.getSnapshot().status === "저장 결과 확인 필요" && (
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await store.retry();
              setMessage(
                "이전 저장을 확인했습니다. 내용을 확인하고 저장 버튼을 다시 눌러 주세요.",
              );
            } catch (e) {
              setMessage(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "확인 중…" : "이전 저장 확인"}
        </button>
      )}
    </div>
  );
}
export function personInitials(name) {
  const text = name?.trim();
  if (!text) return "나";
  if (/^[a-z\s.-]+$/i.test(text))
    return text
      .split(/\s+/)
      .map((word) => word[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  return Array.from(text).slice(-2).join("");
}
export function Avatar({ person, size = "", onClick }) {
  const style = {
    "--avatar-color": statuses[person?.status]?.color || "#8b79d9",
  };
  return (
    <span className={`avatar ${size}`} style={style} onClick={onClick}>
      {personInitials(person?.name)}
    </span>
  );
}
export function Status({ value }) {
  return (
    <span
      className="status-pill"
      style={{ "--status-color": statuses[value]?.color }}
    >
      <i />
      {statuses[value]?.label || "미분류"}
    </span>
  );
}
export function Empty({ title, description, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Users size={27} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  drawer = false,
  className = "",
}) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""} ${drawer ? "drawer" : ""} ${className}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="닫기" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function PersonLine({ person, onClick, detail }) {
  return (
    <button className="person-line" onClick={onClick}>
      <Avatar person={person} />
      <span>
        <strong>{person.name}</strong>
        <small>{detail || person.job || "직함 미입력"}</small>
      </span>
      <ArrowUpRight size={16} />
    </button>
  );
}
