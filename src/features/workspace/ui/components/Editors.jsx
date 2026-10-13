import TaskFields from "./TaskFields.jsx";
import { CardViewer } from "../../../../../card_recognition/card-viewer";
import { ContactNumberList } from "../../../../../card_recognition/contact-number-fields";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Mail,
  CalendarDays,
  Star,
  Pencil,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Modal, Avatar, Status, statuses, places, SaveError } from "./ui.jsx";
import {
  addPerson,
  saveMeeting,
  editTodo,
  addNote,
  meetingEditorDefaults,
} from "../domain/editing.js";
import {
  addTodo,
  patchPerson,
  setDeleted,
  toggleTodo,
  uid,
} from "../domain/model.js";
import {
  relationshipCategories,
  personCategories,
} from "../domain/relationship-categories.js";
import { requestEventMetadata } from "../services/ai.js";

function RelationshipCategoryFields({ value, onChange }) {
  return (
    <fieldset className="relationship-category-fields">
      <legend>
        관계 용도 <small>복수 선택 가능</small>
      </legend>
      <div className="relationship-category-choices">
        {Object.entries(relationshipCategories).map(([key, label]) => (
          <label key={key} className="check-person">
            <input
              type="checkbox"
              checked={value.includes(key)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, key]
                    : value.filter((item) => item !== key),
                )
              }
            />
            {label}
          </label>
        ))}
      </div>
      <p className="muted">선택하지 않은 인맥은 미분류로 표시됩니다.</p>
    </fieldset>
  );
}

export function PersonEditor({ store, person, onClose, onSaved }) {
  const [recordId] = useState(() => person?.id || uid());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [categories, setCategories] = useState(
    person ? personCategories(person) : [],
  );
  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const input = {
        ...Object.fromEntries(new FormData(e.currentTarget)),
        relationshipCategories: categories,
      };
      await store.transact(
        (s) =>
          s.people.some((p) => p.id === recordId)
            ? patchPerson(s, recordId, input)
            : addPerson(s, input, () => recordId),
        person ? { [person.id]: person.version } : {},
      );
      onSaved?.(recordId);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={person ? "인맥 수정" : "새로운 인맥"} onClose={onClose}>
      <p className="form-intro">다음에 다시 만나고 싶은 사람을 기록하세요.</p>
      <form onSubmit={submit} className="editor-form">
        <label>
          이름 <span className="required">*</span>
          <input
            autoFocus
            required
            name="name"
            defaultValue={person?.name}
            placeholder="이름을 입력하세요"
            maxLength={100}
          />
        </label>
        <label>
          소속
          <input
            name="company"
            defaultValue={person?.company}
            placeholder="예: 모노랩"
            maxLength={200}
          />
        </label>
        <label>
          직함
          <input
            name="job"
            defaultValue={person?.job}
            placeholder="예: 프로덕트 디자이너"
            maxLength={200}
          />
        </label>
        <div className="form-grid">
          <label>
            이메일
            <input
              type="email"
              name="email"
              defaultValue={person?.email}
              placeholder="name@example.com"
            />
          </label>
          <label>
            전화번호
            <input
              name="phone"
              type="tel"
              defaultValue={person?.phone}
              placeholder="010-0000-0000"
            />
          </label>
        </div>
        <RelationshipCategoryFields
          value={categories}
          onChange={setCategories}
        />
        <SaveError error={error} store={store} />
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            취소
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? "저장 중…" : "인맥 저장"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function MeetingEditor({ store, state, meeting, onClose }) {
  const [recordId] = useState(() => meeting?.id || uid());
  const [saving, setSaving] = useState(false);
  const [initial] = useState(() => meetingEditorDefaults(state, meeting));
  const [selected, setSelected] = useState(initial.personIds);
  const [error, setError] = useState("");
  const [fields, setFields] = useState({
    name: meeting?.name || "",
    eventUrl: meeting?.eventUrl || "",
    description: meeting?.description || "",
    imageUrl: meeting?.imageUrl || "",
    imageSourceUrl: meeting?.imageSourceUrl || "",
  });
  const [metadata, setMetadata] = useState(null);
  const [metadataError, setMetadataError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(null);
  const revisionRef = useRef(0);
  useEffect(
    () => () => {
      revisionRef.current += 1;
      requestRef.current?.abort();
    },
    [],
  );
  function invalidateMetadata() {
    revisionRef.current += 1;
    requestRef.current?.abort();
    setMetadata(null);
    setLoading(false);
    setMetadataError("");
  }
  function changeField(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
  }
  async function loadMetadata() {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const revision = ++revisionRef.current;
    setMetadata(null);
    setMetadataError("");
    setLoading(true);
    try {
      const result = await requestEventMetadata(fields.eventUrl, {
        signal: controller.signal,
      });
      if (revision === revisionRef.current && !controller.signal.aborted)
        setMetadata(result);
    } catch (e) {
      if (revision === revisionRef.current && !controller.signal.aborted)
        setMetadataError(e.message);
    } finally {
      if (revision === revisionRef.current) setLoading(false);
    }
  }
  function applyMetadata() {
    if (!metadata) return;
    setFields((current) => ({
      ...current,
      name: metadata.title || current.name,
      description: metadata.description || current.description,
      eventUrl: metadata.sourceUrl,
      imageUrl: metadata.imageUrl || current.imageUrl,
      imageSourceUrl: metadata.imageUrl
        ? metadata.sourceUrl
        : current.imageSourceUrl,
    }));
    invalidateMetadata();
  }
  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await store.transact(
        (s) =>
          saveMeeting(
            s,
            {
              ...Object.fromEntries(new FormData(e.currentTarget)),
              personIds: selected,
            },
            s.meetings.some((m) => m.id === recordId) ? recordId : null,
            recordId,
          ),
        meeting ? { [meeting.id]: meeting.version } : {},
      );
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={meeting ? "만남 수정" : "만남 기록"} onClose={onClose}>
      <form
        className="editor-form"
        onSubmit={submit}
        onChangeCapture={invalidateMetadata}
      >
        <label>
          만남 이름
          <input
            name="name"
            required
            autoFocus
            value={fields.name}
            onChange={(e) => changeField("name", e.target.value)}
            placeholder="어디에서 만났나요?"
            maxLength={150}
          />
        </label>
        <div className="form-grid">
          <label>
            날짜
            <input name="date" type="date" defaultValue={initial.date} />
          </label>
          <label>
            장소 유형
            <select
              name="placeType"
              defaultValue={meeting?.placeType || "unclassified"}
            >
              {Object.entries(places).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend>등록된 인맥</legend>
          <div className="participant-list">
            {state.people
              .filter((p) => !p.deletedAt)
              .map((p) => (
                <label key={p.id} className="check-person">
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, p.id]
                          : ids.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <Avatar person={p} size="small" />
                  <span>
                    {p.name}
                    <small>{p.job}</small>
                  </span>
                </label>
              ))}
          </div>
          {initial.preservedPersonIds.length > 0 && (
            <p className="muted">삭제 보관함의 인맥 연결은 보존됩니다.</p>
          )}
          {!state.people.filter((person) => !person.deletedAt).length && (
            <p className="muted">
              등록된 인맥이 없어요. 처음 만난 사람은 아래에 게스트로 남길 수
              있습니다.
            </p>
          )}
        </fieldset>
        <label>
          처음 만난 사람 · 게스트
          <textarea
            name="guests"
            defaultValue={(meeting?.guests || []).join("\n")}
            placeholder="이름을 한 줄에 한 명씩 입력하세요"
            rows={3}
            maxLength={5000}
          />
          <small>
            만남 기록에만 표시됩니다. 인맥 관리에는 자동 등록되지 않습니다.
          </small>
        </label>
        <label>
          만남 설명
          <textarea
            name="description"
            value={fields.description}
            onChange={(e) => changeField("description", e.target.value)}
            placeholder="행사 내용이나 기억해둘 이야기를 입력하세요"
            maxLength={6000}
            rows={3}
          />
        </label>
        <fieldset className="meeting-media-fields">
          <legend>
            행사 정보 · 이미지 <small>선택</small>
          </legend>
          <label>
            행사 페이지 주소
            <div className="meeting-url-input">
              <input
                type="url"
                name="eventUrl"
                value={fields.eventUrl}
                onChange={(e) => changeField("eventUrl", e.target.value)}
                placeholder="https://..."
                maxLength={2048}
              />
              <button
                type="button"
                className="secondary-button"
                disabled={loading || !fields.eventUrl.trim()}
                onClick={loadMetadata}
              >
                {loading ? "불러오는 중…" : "정보 불러오기"}
              </button>
            </div>
          </label>
          <p className="muted">
            이벤터스·온오프믹스·Eventbrite·Meetup의 공개 행사 페이지를
            지원합니다. 이미지가 있는 경우 함께 불러옵니다.
          </p>
          {metadataError && (
            <p className="error-text" role="alert">
              {metadataError}
            </p>
          )}
          {metadata && (
            <div className="meeting-metadata-preview">
              {metadata.imageUrl && (
                <img
                  src={metadata.imageUrl}
                  alt="불러온 행사 이미지"
                  referrerPolicy="no-referrer"
                />
              )}
              <strong>{metadata.title || "행사 정보"}</strong>
              <p>
                {metadata.description || "행사 설명이 제공되지 않았습니다."}
              </p>
              <a href={metadata.sourceUrl} target="_blank" rel="noreferrer">
                행사 원문 확인
              </a>
              <p className="muted">
                적용하면 불러온 제목·설명·이미지를 현재 입력란에 채웁니다.
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={applyMetadata}
              >
                불러온 정보 적용
              </button>
            </div>
          )}
          <label>
            이미지 주소
            <input
              type="url"
              name="imageUrl"
              value={fields.imageUrl}
              onChange={(e) => changeField("imageUrl", e.target.value)}
              placeholder="https://... (선택)"
              maxLength={2048}
            />
          </label>
          <label>
            이미지 출처 페이지
            <input
              type="url"
              name="imageSourceUrl"
              value={fields.imageSourceUrl}
              onChange={(e) => changeField("imageSourceUrl", e.target.value)}
              placeholder="https://... (선택)"
              maxLength={2048}
            />
          </label>
        </fieldset>
        <SaveError error={error} store={store} />
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            취소
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? "저장 중…" : "만남 저장"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function TodoEditor({
  store,
  people,
  todo,
  personId,
  initialDate,
  onClose,
}) {
  const [recordIds] = useState(() => ({
    todo: todo?.id || uid(),
    person: uid(),
  }));
  const [saving, setSaving] = useState(false);
  const [target, setTarget] = useState(personId || todo?.personId || "");
  const [personQuery, setPersonQuery] = useState("");
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const data = Object.fromEntries(new FormData(e.currentTarget));
      await store.transact(
        (s) =>
          s.todos.some((t) => t.id === recordIds.todo)
            ? editTodo(s, recordIds.todo, data)
            : addTodo(
                s,
                { ...data, personIdOverride: target || null },
                (kind) => recordIds[kind],
              ),
        todo ? { [todo.id]: todo.version } : {},
      );
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={todo ? "일정 수정" : "할 일 추가"} onClose={onClose}>
      <form className="editor-form" onSubmit={submit}>
        <label>
          할 일
          <input
            name="text"
            required
            autoFocus
            defaultValue={todo?.text}
            placeholder="할 일"
            maxLength={500}
          />
        </label>
        <TaskFields todo={todo} initialDate={initialDate} compact />
        {!todo && (
          <details className="todo-person-details">
            <summary>
              관련 인맥{" "}
              <span>
                {target
                  ? people.find((p) => p.id === target)?.name
                  : "선택 · 연결 없이 등록 가능"}
              </span>
            </summary>
            <label>
              인맥 검색
              <input
                value={personQuery}
                onChange={(e) => setPersonQuery(e.target.value)}
                placeholder="이름·소속으로 찾기"
              />
            </label>
            <label>
              연결할 인맥
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">일반 일정 / 새 인맥</option>
                {people
                  .filter(
                    (p) =>
                      p.id === target ||
                      `${p.name} ${p.company || ""} ${p.job || ""}`
                        .toLowerCase()
                        .includes(personQuery.toLowerCase()),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.job ? ` · ${p.job}` : ""}
                    </option>
                  ))}
              </select>
            </label>
            {!target && (
              <label>
                새 인맥 이름 <small>입력하면 별도 인맥이 만들어집니다</small>
                <input name="name" placeholder="이름 (선택)" />
              </label>
            )}
          </details>
        )}
        <SaveError error={error} store={store} />
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            취소
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? "저장 중…" : todo ? "변경 저장" : "추가"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Editable({ label, value, version, onSave, placeholder }) {
  const editVersion = useRef(version);
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(value || "");
  return (
    <div className="profile-field">
      <span>{label}</span>
      {editing ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if ((await onSave(draft, editVersion.current)) !== false)
              setEditing(false);
          }}
        >
          <input
            autoFocus
            aria-label={label}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="icon-button" aria-label={`${label} 저장`}>
            <Check size={16} />
          </button>
        </form>
      ) : (
        <button
          onClick={() => {
            setDraft(value || "");
            editVersion.current = version;
            setEditing(true);
          }}
        >
          {value || placeholder}
          <Pencil size={13} />
        </button>
      )}
    </div>
  );
}

export function Profile({
  person,
  state,
  store,
  hiddenReason,
  onClose,
  onTodo,
  onMail,
  onDeleted,
  people = [],
  onNavigate,
  initialTab = "activity",
}) {
  const [tab, setTab] = useState(initialTab);
  const noteId = useRef(uid());
  const [note, setNote] = useState(""),
    [error, setError] = useState("");
  const meetings = state.meetings.filter(
    (m) =>
      !m.deletedAt &&
      state.edges.some(
        (e) => !e.deletedAt && e.personId === person.id && e.meetingId === m.id,
      ),
  );
  const todos = state.todos.filter(
    (t) => !t.deletedAt && t.personId === person.id,
  );
  const personIndex = people.findIndex((p) => p.id === person.id);
  async function patch(field, value, version = person.version) {
    if (field === "name" && !value.trim()) {
      setError("이름은 비울 수 없습니다.");
      return false;
    }
    try {
      await store.transact(
        (s) => patchPerson(s, person.id, { [field]: value }),
        { [person.id]: version },
      );
      setError("");
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }
  return (
    <Modal title="인맥 프로필" onClose={onClose} drawer>
      {onNavigate && people.length > 1 && (
        <div className="profile-pagination">
          <span>
            인맥 {personIndex + 1} / {people.length}
          </span>
          <button
            className="icon-button"
            aria-label="이전 인맥"
            disabled={personIndex <= 0}
            onClick={() => onNavigate(people[personIndex - 1].id, tab)}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="다음 인맥"
            disabled={personIndex >= people.length - 1}
            onClick={() => onNavigate(people[personIndex + 1].id, tab)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      )}
      <div className="profile-hero">
        <Avatar person={person} size="large" />
        <div>
          <h2>{person.name}</h2>
          <p>
            {[person.company, person.job].filter(Boolean).join(" · ") ||
              "소속·직함 미입력"}
          </p>
          <Status value={person.status} />
        </div>
      </div>
      {hiddenReason && (
        <p className="info-box">
          선택한 프로필은 현재 지도 필터에서 제외되어 있습니다.
          <br />
          {hiddenReason}
        </p>
      )}
      <div className="profile-quick-actions">
        <button className="secondary-button" onClick={() => onMail(person.id)}>
          <Mail size={16} />
          맞춤형 메일 초안
        </button>
        <button className="primary-button" onClick={() => onTodo(person.id)}>
          <Plus size={16} />할 일 추가
        </button>
      </div>
      <div className="profile-tabs" aria-label="프로필 보기">
        {[
          [
            "activity",
            "활동",
            meetings.length + person.history.filter((h) => !h.deletedAt).length,
          ],
          ["tasks", "할 일", todos.filter((t) => !t.done).length],
          ["info", "정보", null],
        ].map(([key, label, count]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
            {count !== null && <span>{count}</span>}
          </button>
        ))}
      </div>
      <div className="profile-info-panel" hidden={tab !== "info"}>
        {(person.businessCards || []).length > 0 && (
          <section className="profile-business-cards" aria-label="등록한 명함">
            <h3>등록한 명함</h3>
            {person.businessCards.map((card) => (
              <div key={card.id}>
                <CardViewer
                  imageUrl={`/api/source-assets/${card.displayAssetId}`}
                  label={`${person.name}님의 등록한 명함`}
                />
                {card.identity && (
                  <ContactNumberList identity={card.identity} />
                )}
              </div>
            ))}
          </section>
        )}
        <p className="profile-edit-hint">
          항목을 눌러 수정할 수 있어요. 변경 내용은 자동 저장됩니다.
        </p>
        <div className="profile-fields">
          <Editable
            version={person.version}
            label="이름"
            value={person.name}
            onSave={(v, version) => patch("name", v, version)}
          />
          <Editable
            version={person.version}
            label="소속"
            value={person.company}
            placeholder="소속 추가"
            onSave={(v, version) => patch("company", v, version)}
          />
          <Editable
            version={person.version}
            label="직함"
            value={person.job}
            placeholder="직함 미입력"
            onSave={(v, version) => patch("job", v, version)}
          />
          <Editable
            version={person.version}
            label="이메일"
            value={person.email}
            placeholder="이메일 추가"
            onSave={(v, version) => patch("email", v, version)}
          />
          <Editable
            version={person.version}
            label="전화번호"
            value={person.phone}
            placeholder="전화번호 추가"
            onSave={(v, version) => patch("phone", v, version)}
          />
        </div>
        <div className="profile-options">
          <label>
            관계 상태
            <select
              value={person.status}
              onChange={(e) => patch("status", e.target.value)}
            >
              {Object.entries(statuses).map(([k, s]) => (
                <option key={k} value={k}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="field-label">중요도</span>
            <div className="stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  aria-label={`중요도 ${n}`}
                  onClick={() => patch("importance", n)}
                >
                  <Star
                    size={19}
                    fill={n <= person.importance ? "#d8b776" : "none"}
                    color={n <= person.importance ? "#d8b776" : "#d9dce3"}
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
        <RelationshipCategoryFields
          value={personCategories(person)}
          onChange={(value) => patch("relationshipCategories", value)}
        />
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <section className="profile-section" hidden={tab !== "activity"}>
        <h3>
          함께한 만남 <span>{meetings.length}</span>
        </h3>
        {meetings.map((m) => (
          <div className="history-meeting" key={m.id}>
            <CalendarDays size={17} />
            <div>
              <strong>{m.name}</strong>
              <small>
                {m.date || "날짜 미정"} · {places[m.placeType]}
              </small>
            </div>
          </div>
        ))}
        {!meetings.length && (
          <p className="muted">아직 기록된 만남이 없어요.</p>
        )}
      </section>
      <section className="profile-section" hidden={tab !== "tasks"}>
        <div className="section-heading">
          <h3>후속 일정</h3>
          <button className="text-button" onClick={() => onTodo(person.id)}>
            <Plus size={14} />
            추가
          </button>
        </div>
        {todos.map((t) => (
          <div className="profile-todo" key={t.id}>
            <button
              className={`todo-check ${t.done ? "done" : ""}`}
              aria-label={`${t.text} ${t.done ? "완료 취소" : "완료"}`}
              onClick={() =>
                store
                  .transact((s) => toggleTodo(s, t.id))
                  .catch((e) => setError(e.message))
              }
            >
              {t.done && <Check size={13} />}
            </button>
            <div>
              <span className={t.done ? "completed" : ""}>{t.text}</span>
              <small>
                {t.kind
                  ? `${{ commitment: "기록된 약속", follow_up: "후속 행동", suggestion: "AI 제안" }[t.kind]} · `
                  : ""}
                {t.date || "날짜 미정"}
              </small>
            </div>
          </div>
        ))}
        {!todos.length && <p className="muted">다음에 할 일을 남겨보세요.</p>}
      </section>
      <section className="profile-section" hidden={tab !== "activity"}>
        <h3>기억해둘 이야기</h3>
        <form
          className="note-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const saved = store
                .getSnapshot()
                .state.people.find((p) => p.id === person.id)
                ?.history.find((h) => h.id === noteId.current);
              if (saved && saved.text !== note.trim()) noteId.current = uid();
              await store.transact((s) =>
                addNote(s, person.id, note, noteId.current),
              );
              setNote("");
              noteId.current = uid();
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <textarea
            aria-label="새 메모"
            placeholder="대화, 관심사, 작은 기억까지 남겨보세요."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
          />
          <button className="secondary-button" disabled={!note.trim()}>
            메모 저장
          </button>
        </form>
        {person.history
          .filter((h) => !h.deletedAt)
          .map((h) => (
            <div className="note-card" key={h.id}>
              <small>{h.date || "날짜 미정"}</small>
              <p>{h.text}</p>
              <button
                className="icon-button"
                aria-label="메모 삭제"
                onClick={() =>
                  store
                    .transact((s) =>
                      patchPerson(s, person.id, {
                        history: s.people
                          .find((p) => p.id === person.id)
                          .history.map((n) =>
                            n.id === h.id
                              ? { ...n, deletedAt: new Date().toISOString() }
                              : n,
                          ),
                      }),
                    )
                    .catch((e) => setError(e.message))
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
      </section>
      <button
        className="danger-button"
        hidden={tab !== "info"}
        onClick={async () => {
          if (
            window.confirm(
              `${person.name}님을 삭제할까요? 삭제 보관함에서 복원할 수 있습니다.`,
            )
          ) {
            try {
              await store.transact((s) => setDeleted(s, "people", [person.id]));
              onDeleted();
              onClose();
            } catch (e) {
              setError(e.message);
            }
          }
        }}
      >
        <Trash2 size={15} />
        지도에서 삭제
      </button>
    </Modal>
  );
}
