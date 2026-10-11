import { useEffect, useRef, useState } from "react";
import { UserRound, Sparkles, Copy, Save, Mail, RefreshCw } from "lucide-react";
import { Modal } from "./ui.jsx";
import { tones, mailPurposes, makeMailPreview } from "../domain/workspace.js";
import { uid, active } from "../domain/model.js";

export function PersonaEditor({ store, onClose }) {
  const [initialVersion] = useState(
    () => store.getSnapshot().state.personaVersion,
  );
  const [value, setValue] = useState(() => ({
    tone: "formal",
    ...store.getSnapshot().state.persona,
  }));
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const field = (key, label, required = false, type = "text") => (
    <label>
      {label}
      {required ? " *" : ""}
      <input
        type={type}
        required={required}
        value={value[key] || ""}
        maxLength={key === "email" ? 254 : 200}
        onChange={(e) => setValue((v) => ({ ...v, [key]: e.target.value }))}
      />
    </label>
  );
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (
        !value.name?.trim() ||
        !value.company?.trim() ||
        !value.role?.trim() ||
        !value.bio?.trim()
      )
        throw new Error("이름, 소속, 직무와 소개를 입력해주세요.");
      await store.transact(
        (s) => ({
          ...s,
          persona: Object.fromEntries(
            Object.entries(value).map(([k, v]) => [
              k,
              typeof v === "string" ? v.trim() : v,
            ]),
          ),
        }),
        { persona: initialVersion },
      );
      if (!(await store.flush()))
        throw new Error(
          "저장하지 못했습니다. 데이터 관리에서 저장 상태를 확인해주세요.",
        );
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="내 프로필 & 페르소나" onClose={onClose} wide>
      <form className="workspace-form" onSubmit={save}>
        <div className="form-intro">
          <span className="workspace-icon">
            <UserRound size={22} />
          </span>
          <div>
            <strong>나를 소개하는 방식</strong>
            <p>
              메일에 사용할 소개와 어조를 설정하세요. 팀 공유 공간에 저장됩니다.
            </p>
          </div>
        </div>
        <div className="persona-presets">
          <span>빠른 예시</span>
          {[
            [
              "스타트업 대표",
              "대표",
              "서비스를 만들고 협업 기회를 찾고 있습니다.",
              "energetic",
            ],
            [
              "B2B 영업",
              "사업개발",
              "고객의 업무 개선을 위한 솔루션을 제안하고 있습니다.",
              "formal",
            ],
            [
              "학생·예비창업",
              "학생",
              "새로운 아이디어를 검증하고 현업의 경험을 배우고 있습니다.",
              "friendly",
            ],
          ].map(([label, role, bio, tone]) => (
            <button
              type="button"
              key={label}
              onClick={() => setValue((v) => ({ ...v, role, bio, tone }))}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="form-grid">
          {field("name", "이름", true)}
          {field("company", "소속", true)}
          {field("role", "직무·직책", true)}
          {field("department", "부서·전공")}
        </div>
        <label>
          현재 하는 일·소개 *
          <textarea
            required
            maxLength={2000}
            rows={3}
            value={value.bio || ""}
            onChange={(e) => setValue((v) => ({ ...v, bio: e.target.value }))}
            placeholder="상대에게 소개하고 싶은 활동과 서비스를 적어주세요."
          />
        </label>
        {field("goal", "교류 목적·관심 분야")}
        <fieldset className="choice-field">
          <legend>선호하는 메일 어조</legend>
          <div className="tone-choices">
            {Object.entries(tones).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={value.tone === key}
                onClick={() => setValue((v) => ({ ...v, tone: key }))}
              >
                {label}
                <small>
                  {key === "formal"
                    ? "격식 있고 신뢰감 있게"
                    : key === "friendly"
                      ? "부담 없이 자연스럽게"
                      : key === "concise"
                        ? "짧고 명확하게"
                        : "적극적이고 밝게"}
                </small>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="form-grid">
          {field("email", "회신 이메일", true, "email")}
          {field("phone", "연락처", "", "tel")}
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="sticky-actions">
          <button type="button" className="text-button" onClick={onClose}>
            취소
          </button>
          <button className="primary-button" disabled={saving}>
            <Save size={16} />내 페르소나 저장
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function MailComposer({ person, state, store, onClose, onPersona }) {
  const [configOpen, setConfigOpen] = useState(
    () => !matchMedia("(max-width: 760px)").matches,
  );
  const bodyRef = useRef(null);
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const resize = () => setConfigOpen(!media.matches);
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  const previous = (state.mailDrafts || []).find(
    (d) => d.personId === person.id,
  );
  const [draftId] = useState(previous?.id || uid("mail"));
  const draftVersion = useRef(previous?.version);
  const [purpose, setPurpose] = useState(previous?.purpose || "hello");
  const [subject, setSubject] = useState(previous?.subject || ""),
    [body, setBody] = useState(previous?.body || "");
  const [reference, setReference] = useState(previous?.reference || ""),
    [includeContext, setIncludeContext] = useState(true);
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const persona = state.persona || {};
  const context = (person.history || [])
    .filter(active)
    .slice(0, 3)
    .map((h) => h.text)
    .join("\n");
  function generate() {
    if (
      body &&
      !window.confirm("편집 중인 제목과 본문을 예시 초안으로 교체할까요?")
    )
      return;
    const result = makeMailPreview(
      persona,
      person,
      purpose,
      [includeContext ? context : "", reference].filter(Boolean).join("\n"),
    );
    setSubject(result.subject);
    setBody(result.body);
    setMessage(
      "페르소나를 반영한 예시 초안을 만들었어요. 내용을 직접 확인해주세요.",
    );
    setError("");
    if (matchMedia("(max-width: 760px)").matches) {
      setConfigOpen(false);
      requestAnimationFrame(() =>
        bodyRef.current?.scrollIntoView({ block: "nearest" }),
      );
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setMessage("제목과 본문을 복사했어요.");
      setError("");
    } catch {
      setError("복사 권한이 없습니다. 본문을 선택해 직접 복사해주세요.");
    }
  }
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (!subject.trim() || !body.trim())
        throw new Error("제목과 본문을 입력해주세요.");
      await store.transact(
        (s) => ({
          ...s,
          mailDrafts: [
            ...(s.mailDrafts || []).filter((d) => d.id !== draftId),
            {
              id: draftId,
              personId: person.id,
              purpose,
              subject: subject.trim(),
              body: body.trim(),
              reference,
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
        draftVersion.current == null ? {} : { [draftId]: draftVersion.current },
      );
      draftVersion.current = store
        .getSnapshot()
        .state.mailDrafts.find((d) => d.id === draftId)?.version;
      if (!(await store.flush()))
        throw new Error("저장하지 못했습니다. 데이터 관리에서 확인해주세요.");
      setMessage("초안을 저장했어요. 인맥 프로필에서 다시 열 수 있습니다.");
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title="맞춤형 메일 초안"
      onClose={onClose}
      wide
      className="mail-composer-modal"
    >
      <form className="workspace-form mail-form" onSubmit={save}>
        <div className="form-intro">
          <span className="workspace-icon">
            <Mail size={23} />
          </span>
          <div>
            <strong>{person.name}님께 보내는 메일</strong>
            <p>
              {[person.company, person.email || "이메일 미등록"]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        <div className="persona-strip">
          <span>
            발신 페르소나 <strong>{persona.name || "설정되지 않음"}</strong>
            <small>
              {[persona.company, persona.role].filter(Boolean).join(" · ")}
            </small>
          </span>
          <button className="text-button" type="button" onClick={onPersona}>
            페르소나 {persona.name ? "변경" : "설정"}
          </button>
        </div>
        <p className="prototype-note">
          프론트엔드 미리보기 · 예시 문구를 조합합니다. 실제 AI 생성·메일함
          연동·발송은 아직 연결되지 않았습니다.
        </p>
        <div className="mail-config">
          <details
            className="mail-options"
            open={configOpen}
            onToggle={(e) => setConfigOpen(e.currentTarget.open)}
          >
            <summary>
              초안 작성 설정 <span>· {mailPurposes[purpose]}</span>
            </summary>
            <fieldset className="choice-field">
              <legend>메일 목적</legend>
              <div className="purpose-choices">
                {Object.entries(mailPurposes).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={purpose === key}
                    onClick={() => setPurpose(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="check-label">
              <input
                type="checkbox"
                checked={includeContext}
                onChange={(e) => setIncludeContext(e.target.checked)}
              />
              만남 기록 참고하기
            </label>
            {includeContext && (
              <div className="context-preview">
                {context ||
                  "저장된 만남 맥락이 없습니다. 아래에 참고 내용을 입력할 수 있습니다."}
              </div>
            )}
            <label>
              참고할 이메일·추가 요청
              <textarea
                maxLength={5000}
                rows={3}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="관련 이메일 내용이나 꼭 전달할 내용을 붙여 넣으세요."
              />
            </label>
          </details>
          <button
            className="secondary-button generate-mail"
            type="button"
            onClick={generate}
          >
            {body ? <RefreshCw size={16} /> : <Sparkles size={16} />}예시 초안{" "}
            {body ? "다시 만들기" : "만들기"}
          </button>
        </div>
        <div className="mail-editor">
          <label>
            제목
            <input
              required
              maxLength={250}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="메일 제목"
            />
          </label>
          <label>
            본문
            <textarea
              ref={bodyRef}
              className="mail-body"
              aria-label="본문"
              required
              maxLength={12000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="예시 초안을 만들거나 직접 작성하세요."
            />
          </label>
        </div>
        {message && (
          <p className="inline-success" aria-live="polite">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="sticky-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!body}
            onClick={copy}
          >
            <Copy size={16} />
            내용 복사
          </button>
          <button
            className="primary-button"
            disabled={saving || !body || !subject}
          >
            <Save size={16} />
            초안 저장
          </button>
        </div>
      </form>
    </Modal>
  );
}
