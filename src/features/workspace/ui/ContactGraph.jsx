import { useEffect, useMemo, useState } from "react";
import {
  Network,
  Users,
  CalendarDays,
  Coffee,
  Sparkles,
  Search,
  Plus,
  ArrowUpRight,
  ChevronRight,
  Settings2,
  Check,
  Pencil,
  Trash2,
  X,
  ArrowRight,
  ShieldCheck,
  Monitor,
  CircleHelp,
  PanelLeftClose,
  PanelLeftOpen,
  ContactRound,
  Mic,
  MoreHorizontal,
  Square,
} from "lucide-react";
import { useContactStore } from "./app/useContactStore.js";
import StorageControls from "./app/StorageControls.jsx";
import {
  activeState,
  selectGraph,
  selectPerson,
  setDeleted,
  toggleTodo,
} from "./domain/model.js";
import { todayStr } from "./domain/dates.js";
import { statuses, places, Modal, PersonLine } from "./components/ui.jsx";
import {
  PersonEditor,
  MeetingEditor,
  TodoEditor,
  Profile,
} from "./components/Editors.jsx";
import Assistant from "./components/Assistant.jsx";
import WorkManagement from "./components/WorkManagement.jsx";
import MeetingRecords from "./components/MeetingRecords.jsx";
import RelationshipView from "./components/RelationshipView.jsx";
import PeopleManagement from "./components/PeopleManagement.jsx";
import { PersonaEditor, MailComposer } from "./components/PersonaMail.jsx";
import CardImport from "./components/CardImport.jsx";
import RecordingPage from "./components/RecordingPage.jsx";
import { taskTypes } from "./domain/task-options.js";

const navigation = [
  ["todos", "일정/업무관리", CalendarDays],
  ["map", "관계 지도", Network],
  ["people", "인맥 관리", Users],
  ["meetings", "만남 기록", Coffee],
  ["cards", "명함 등록", ContactRound],
  ["recordings", "녹음", Mic],
];
const titles = {
  todos: [
    "일정/업무관리",
    "기억해 둔 약속을 확인하고, 다음 연락을 준비하세요.",
  ],
  map: ["관계 지도", "프로젝트·업무·네트워킹·고객별로 연결을 살펴보세요."],
  people: ["인맥 관리", "연락처와 관계 분류, 기록을 관리하세요."],
  meetings: ["만남 기록", "월별 행사와 만남, 함께한 인맥을 기록하세요."],
  cards: ["명함 등록", "명함 속 새로운 인연을 내 인맥으로 연결하세요."],
  recordings: ["녹음", "대화를 다시 듣고, 다음 만남에 필요한 기억을 남기세요."],
};

function TodoItem({
  todo,
  person,
  onToggle,
  onEdit,
  onDelete,
  onPerson,
  compact = false,
}) {
  const overdue = !todo.done && todo.date && todo.date < todayStr();
  return (
    <div className={`todo-item ${compact ? "compact" : ""}`}>
      <button
        className={`todo-check ${todo.done ? "done" : ""}`}
        aria-label={`${todo.text} ${todo.done ? "완료 취소" : "완료"}`}
        onClick={onToggle}
      >
        {todo.done && <Check size={12} />}
      </button>
      <div className="todo-content">
        <strong className={todo.done ? "completed" : ""}>{todo.text}</strong>
        {(todo.kind ||
          (todo.type && todo.type !== "general") ||
          todo.importance >= 4) && (
          <div className="task-badges">
            {todo.kind && (
              <span>
                {
                  {
                    commitment: "기록된 약속",
                    follow_up: "후속 행동",
                    suggestion: "AI 제안",
                  }[todo.kind]
                }
              </span>
            )}
            {todo.type && todo.type !== "general" && (
              <span>{taskTypes[todo.type]}</span>
            )}
            {todo.importance >= 4 && (
              <span className="priority-badge">중요도 {todo.importance}</span>
            )}
          </div>
        )}
        <div>
          {person && (
            <button className="todo-person" onClick={onPerson}>
              {person.name}
            </button>
          )}
          <span className={overdue ? "overdue" : ""}>
            {overdue ? "기한 지남 · " : ""}
            {todo.date === todayStr() ? "오늘" : todo.date || "날짜 미정"}
            {todo.time ? ` · ${todo.time}` : ""}
          </span>
        </div>
      </div>
      {!compact && (
        <div className="row-actions">
          <button
            className="icon-button"
            aria-label={`${todo.text} 수정`}
            onClick={onEdit}
          >
            <Pencil size={15} />
          </button>
          <button
            className="icon-button"
            aria-label={`${todo.text} 삭제`}
            onClick={onDelete}
          >
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function ContactGraphApp({ mode = "server" }) {
  const session = useContactStore(mode),
    { store, state } = session;
  const live = useMemo(() => activeState(state), [state]);
  const [page, updatePage] = useState(() => {
      const key = window.location.hash.slice(1);
      return navigation.some(([id]) => id === key) ? key : "todos";
    }),
    [query, setQuery] = useState(""),
    [selectedId, setSelectedId] = useState(null);
  const [assistant, setAssistant] = useState(false),
    [editor, setEditor] = useState(null),
    [settings, setSettings] = useState(false),
    [help, setHelp] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false),
    [status, setStatus] = useState("all"),
    [importance, setImportance] = useState("all"),
    [place, setPlace] = useState("all"),
    [year, setYear] = useState("all"),
    [month, setMonth] = useState("all"),
    [category, setCategory] = useState("all");
  const [toast, setToast] = useState("");
  function setPage(key) {
    if (key !== page) window.history.pushState(null, "", `#${key}`);
    updatePage(key);
    setQuery("");
  }
  useEffect(() => {
    const restore = () => {
      const key = window.location.hash.slice(1);
      updatePage(navigation.some(([id]) => id === key) ? key : "todos");
      setQuery("");
    };
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("hashchange", restore);
    };
  }, []);
  const [profileTab, setProfileTab] = useState("activity");
  const [moreOpen, setMoreOpen] = useState(false);
  const [recordingState, setRecordingState] = useState({
    phase: "idle",
    hasDraft: false,
  });
  const [stopRecording, setStopRecording] = useState(0);
  const recordingBusy = recordingState.phase !== "idle";
  const [assistantHost, setAssistantHost] = useState(null);
  const [assistantFocus, setAssistantFocus] = useState(0);
  const [assistantSeed, setAssistantSeed] = useState({
    question: "",
    version: 0,
  });
  function findSavedMemory(question) {
    setCardTab(null);
    setPage("todos");
    setAssistantSeed((current) => ({ question, version: current.version + 1 }));
    setAssistantFocus((current) => current + 1);
  }
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("persnapse-sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "persnapse-sidebar-collapsed",
        String(sidebarCollapsed),
      );
    } catch {
      // A display preference must not interrupt recording when browser storage is unavailable.
    }
  }, [sidebarCollapsed]);
  const graph = useMemo(
    () =>
      selectGraph(state, {
        categoryFilter: category,
        statusFilter: Object.fromEntries(
          Object.keys(statuses).map((k) => [
            k,
            status === "all" || k === status,
          ]),
        ),
        importanceFilter: Object.fromEntries(
          [1, 2, 3, 4, 5].map((k) => [
            k,
            importance === "all" || k === Number(importance),
          ]),
        ),
        placeFilter: Object.fromEntries(
          Object.keys(places).map((k) => [k, place === "all" || k === place]),
        ),
        year: year === "all" ? null : Number(year),
        month: month === "all" ? null : Number(month),
      }),
    [state, status, importance, place, year, month, category],
  );
  const [cardTab, setCardTab] = useState(null),
    [personaOpen, setPersonaOpen] = useState(false),
    [mailId, setMailId] = useState(null);
  const mailPerson = selectPerson(state, mailId);
  function openCard(tab) {
    setCardTab(tab);
  }
  const person = selectPerson(state, selectedId);
  const matches = live.people.filter((p) =>
    `${p.name} ${p.company || ""} ${p.job || ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const upcoming = live.todos
    .filter((t) => !t.done)
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  const years = [
    ...new Set(live.meetings.map((m) => m.date?.slice(0, 4)).filter(Boolean)),
  ]
    .sort()
    .reverse();
  function notify(text) {
    setToast(text);
  }
  async function remove(collection, id) {
    if (
      window.confirm("삭제할까요? 삭제 보관함에서 다시 복원할 수 있습니다.")
    ) {
      try {
        await store.transact((s) => setDeleted(s, collection, [id]));
        notify("삭제 보관함으로 이동했어요.");
      } catch {
        /* server status displays the error */
      }
    }
  }
  function select(id, tab = "activity") {
    setSelectedId(id);
    setProfileTab(tab);
    setQuery("");
  }
  function editTodoFor(id) {
    setSelectedId(null);
    setEditor({ type: "todo", personId: id });
  }
  function todoRow(todo, compact = false) {
    return (
      <TodoItem
        key={todo.id}
        todo={todo}
        person={live.people.find((p) => p.id === todo.personId)}
        compact={compact}
        onToggle={() =>
          store.transact((s) => toggleTodo(s, todo.id)).catch(() => {})
        }
        onEdit={() => setEditor({ type: "todo", value: todo })}
        onDelete={() => remove("todos", todo.id)}
        onPerson={() => select(todo.personId)}
      />
    );
  }
  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside
        className="sidebar"
        id="workspace-sidebar"
        aria-label="워크스페이스 사이드바"
      >
        <div className="sidebar-header">
          <a
            className="brand"
            aria-label="Persnapse 메인 화면"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setPage("todos");
            }}
          >
            <span className="brand-symbol">
              <Network size={22} />
            </span>
            <span className="brand-word">
              persnapse<span className="brand-dot">.</span>
            </span>
          </a>
          <button
            className="icon-button sidebar-toggle"
            aria-label={sidebarCollapsed ? "사이드바 열기" : "사이드바 접기"}
            title={sidebarCollapsed ? "사이드바 열기" : "사이드바 접기"}
            aria-expanded={!sidebarCollapsed}
            aria-controls="workspace-sidebar"
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
        </div>
        <div className="workspace-label">워크스페이스</div>
        <nav aria-label="주요 메뉴">
          {navigation.map(([key, label, Icon]) => (
            <button
              key={key}
              aria-label={label}
              title={sidebarCollapsed ? label : undefined}
              className={page === key ? "active" : ""}
              aria-current={page === key ? "page" : undefined}
              onClick={() => setPage(key)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {key === "people" && <small>{live.people.length}</small>}
              {key === "todos" && upcoming.length > 0 && (
                <i className="nav-dot" />
              )}
              {key === "recordings" && recordingBusy && (
                <i className="recording-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-card">
            <span className="workspace-icon">
              <Monitor size={18} />
            </span>
            <strong>
              {mode === "demo" ? "가볍게 둘러보세요" : "팀 공유 워크스페이스"}
            </strong>
            <p>
              {mode === "demo"
                ? "가상 인맥으로 새로운 관계 관리 방식을 경험해보세요."
                : "같은 인맥과 기록을 팀원이 함께 보고 수정하는 공간입니다."}
            </p>
            <button onClick={() => store.reload()}>
              {mode === "demo" ? "내 인맥으로 시작하기" : "최신 기록 불러오기"}
              <ArrowRight size={14} />
            </button>
          </div>
          <button
            className="sidebar-utility"
            aria-label="데이터 관리"
            title={sidebarCollapsed ? "데이터 관리" : undefined}
            onClick={() => setSettings(true)}
          >
            <Settings2 size={18} />
            <span>데이터 관리</span>
          </button>
          <button
            className="sidebar-utility"
            aria-label="사용 가이드"
            title={sidebarCollapsed ? "사용 가이드" : undefined}
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={18} />
            <span>사용 가이드</span>
          </button>
          <div className="sidebar-profile">
            <span className="avatar self">나</span>
            <div>
              <strong>팀 워크스페이스</strong>
              <small>
                {mode === "demo" ? "샘플 체험" : "서버 저장 · 공유 공간"}
              </small>
            </div>
          </div>
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            워크스페이스
            <ChevronRight size={13} />
            <strong>{titles[page][0]}</strong>
          </div>
          <div className="global-search">
            <Search size={17} />
            <input
              placeholder="이름, 회사, 직함 검색"
              aria-label="전체 인맥 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
                if (e.key === "Enter" && matches.length === 1) {
                  select(matches[0].id);
                  setQuery("");
                }
              }}
            />
            {query && (
              <button
                className="icon-button"
                aria-label="검색 지우기"
                onClick={() => setQuery("")}
              >
                <X size={14} />
              </button>
            )}
            {query.trim() && (
              <div className="search-results cg-scroll">
                {matches.length ? (
                  matches.slice(0, 8).map((p) => (
                    <PersonLine
                      key={p.id}
                      person={p}
                      onClick={() => {
                        select(p.id);
                        setQuery("");
                      }}
                    />
                  ))
                ) : (
                  <p>검색 결과가 없습니다.</p>
                )}
              </div>
            )}
          </div>
          <div className="topbar-meta">
            <span
              className={`save-state ${session.error ? "has-error" : ""}`}
              role="status"
            >
              <i />
              {page === "recordings" && !session.error
                ? recordingBusy
                  ? recordingState.phase === "paused"
                    ? "일시정지"
                    : "녹음 진행 중"
                  : "녹음 준비"
                : session.status}
            </span>
            <span className="mode-badge">
              {mode === "demo" ? "DEMO" : "팀 공유"}
            </span>
            <button
              className="persona-trigger"
              aria-label="내 프로필 및 페르소나 설정"
              onClick={() => setPersonaOpen(true)}
              disabled={!session.ready}
            >
              <span className="avatar self small">
                {state.persona?.name?.slice(-2) || "나"}
              </span>
              <span>
                {state.persona?.name || "내 프로필"}
                <small>페르소나 설정</small>
              </span>
            </button>
          </div>
        </header>
        {recordingBusy && page !== "recordings" && (
          <div className="active-recording-bar" aria-label="진행 중인 녹음">
            <span>
              <i className="recording-dot" />
              {recordingState.phase === "paused"
                ? "녹음 일시정지 중"
                : recordingState.phase === "requesting"
                  ? "마이크 연결 중"
                  : "녹음 중입니다"}
            </span>
            <div>
              <button onClick={() => setPage("recordings")}>
                녹음으로 이동
                <ArrowRight size={15} />
              </button>
              <button onClick={() => setStopRecording((value) => value + 1)}>
                <Square size={13} />
                {recordingState.phase === "requesting"
                  ? "연결 취소"
                  : "녹음 마치기"}
              </button>
            </div>
          </div>
        )}
        {session.error && (
          <div className="storage-warning" role="alert">
            <span>{session.error}</span>
            <button onClick={() => setSettings(true)}>
              서버 연결·저장 확인
              <ArrowUpRight size={14} />
            </button>
          </div>
        )}
        {state.conflicts.length > 0 && (
          <div className="storage-warning">
            <span>
              AI 적용 충돌 {state.conflicts.length}건 · 요청 중 수정되어 기존 값
              유지
            </span>
            <button onClick={() => setSettings(true)}>상세 확인</button>
          </div>
        )}
        <div className="page-content" hidden={!session.ready}>
          <div className="page-heading">
            <div>
              <h1>
                {titles[page][0]}
                {!["cards", "recordings"].includes(page) && (
                  <span>
                    {page === "map" || page === "people"
                      ? live.people.length
                      : page === "meetings"
                        ? live.meetings.length
                        : upcoming.length}
                  </span>
                )}
              </h1>
              <p>{titles[page][1]}</p>
            </div>
            {!["cards", "recordings"].includes(page) && (
              <div className="page-actions">
                {page !== "todos" && (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setAssistant((current) => !current);
                    }}
                  >
                    <Sparkles size={16} />
                    AI 어시스턴트
                  </button>
                )}
                <button
                  className="primary-button"
                  onClick={() =>
                    setEditor({
                      type:
                        page === "todos"
                          ? "todo"
                          : page === "meetings"
                            ? "meeting"
                            : "person",
                    })
                  }
                >
                  <Plus size={17} />
                  {page === "todos"
                    ? "할 일 추가"
                    : page === "meetings"
                      ? "만남 기록"
                      : "인맥 추가"}
                </button>
              </div>
            )}
          </div>
          {page === "map" && (
            <RelationshipView
              live={live}
              graph={graph}
              filters={{ status, importance, place, year, month }}
              filtersOpen={filtersOpen}
              onFiltersOpen={() => setFiltersOpen((v) => !v)}
              onFilter={(patch) => {
                if (patch.status !== undefined) setStatus(patch.status);
                if (patch.importance !== undefined)
                  setImportance(patch.importance);
                if (patch.place !== undefined) setPlace(patch.place);
                if (patch.year !== undefined) setYear(patch.year);
                if (patch.month !== undefined) setMonth(patch.month);
              }}
              category={category}
              onCategory={setCategory}
              years={years}
              selectedId={selectedId}
              onSelect={select}
              onMeeting={(id) =>
                setEditor({
                  type: "meeting",
                  value: live.meetings.find((m) => m.id === id),
                })
              }
              onAdd={() => setEditor({ type: "person" })}
              onOpenPeople={() => setPage("people")}
              mode={mode}
            />
          )}
          {page === "people" && (
            <PeopleManagement
              people={live.people}
              state={live}
              selectedId={selectedId}
              onSelect={select}
              onAdd={() => setEditor({ type: "person" })}
              onCard={() => setPage("cards")}
            />
          )}
          {page === "meetings" && (
            <MeetingRecords
              meetings={live.meetings}
              people={live.people}
              edges={live.edges}
              onSelect={select}
              onEdit={(meeting) =>
                setEditor({ type: "meeting", value: meeting })
              }
              onDelete={(id) => remove("meetings", id)}
              onAdd={() => setEditor({ type: "meeting" })}
            />
          )}
          <div hidden={page !== "todos"} inert={page !== "todos"}>
            <WorkManagement
              people={live.people}
              todos={live.todos}
              renderTodo={todoRow}
              onAdd={(date) => setEditor({ type: "todo", date })}
              onAssistantHost={setAssistantHost}
              focusSignal={assistantFocus}
              onEditTodo={(todo) => setEditor({ type: "todo", value: todo })}
              onSelect={select}
              onCard={() => setPage("cards")}
            />
          </div>
          <div hidden={page !== "cards"} inert={page !== "cards"}>
            <CardImport
              embedded
              active={page === "cards"}
              session={session}
              onSaved={() => notify("명함에서 인맥을 등록했어요.")}
              onViewPerson={select}
              onFindMemory={findSavedMemory}
            />
          </div>
          <div hidden={page !== "recordings"} inert={page !== "recordings"}>
            <RecordingPage
              active={page === "recordings"}
              people={live.people}
              store={store}
              onStateChange={setRecordingState}
              stopSignal={stopRecording}
              onViewPerson={select}
            />
          </div>
          <footer className="page-footer">
            <span>persnapse · every connection matters.</span>
            <span>
              <ShieldCheck size={13} />
              {mode === "demo"
                ? "샘플과 개인 데이터는 분리되어 있어요"
                : "기록은 서버에 저장됩니다 · 녹음은 이 브라우저에 보관"}
            </span>
          </footer>
        </div>
        {!session.ready && !session.error && (
          <div className="workspace-loading" role="status">
            <span className="loading-orbit" />
            <h2>관계 기억을 불러오고 있어요</h2>
            <p>저장된 인맥과 약속을 준비하고 있습니다.</p>
          </div>
        )}
        <nav className="mobile-nav" aria-label="모바일 메뉴">
          {navigation.slice(0, 4).map(([k, l, Icon]) => (
            <button
              key={k}
              className={page === k ? "active" : ""}
              aria-current={page === k ? "page" : undefined}
              onClick={() => setPage(k)}
            >
              <Icon size={20} />
              <span>{l}</span>
            </button>
          ))}
          <button
            aria-label="더보기"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={["cards", "recordings"].includes(page) ? "active" : ""}
            onClick={() => setMoreOpen(true)}
          >
            {page === "cards" ? (
              <ContactRound size={20} />
            ) : page === "recordings" ? (
              <Mic size={20} />
            ) : (
              <MoreHorizontal size={20} />
            )}
            <span>
              {["cards", "recordings"].includes(page)
                ? titles[page][0]
                : "더보기"}
            </span>
          </button>
        </nav>
      </main>
      {moreOpen && (
        <Modal
          title="더보기"
          onClose={() => setMoreOpen(false)}
          className="mobile-more-modal"
        >
          <div className="more-menu">
            {navigation.slice(4).map(([key, label, Icon]) => (
              <button
                key={key}
                className={page === key ? "selected" : ""}
                onClick={() => {
                  setPage(key);
                  setMoreOpen(false);
                }}
              >
                <Icon size={22} />
                <span>
                  <strong>{label}</strong>
                  <small>
                    {key === "cards"
                      ? "명함 사진을 인맥으로 등록"
                      : "대화 녹음과 음성 메모"}
                  </small>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
            <button
              onClick={() => {
                setMoreOpen(false);
                setSettings(true);
              }}
            >
              <Settings2 size={22} />
              <span>
                <strong>데이터 관리</strong>
                <small>백업·복원과 체험 공간 설정</small>
              </span>
              <ChevronRight size={17} />
            </button>
            <button
              onClick={() => {
                setMoreOpen(false);
                setHelp(true);
              }}
            >
              <CircleHelp size={22} />
              <span>
                <strong>사용 가이드</strong>
                <small>주요 기능 살펴보기</small>
              </span>
              <ChevronRight size={17} />
            </button>
          </div>
        </Modal>
      )}
      <Assistant
        open={page === "todos" || assistant}
        embedded={page === "todos"}
        host={assistantHost}
        focusSignal={assistantFocus}
        seed={assistantSeed}
        onClose={() => setAssistant(false)}
        session={session}
        onSelect={select}
        onOpenTasks={(id) => select(id, "tasks")}
        notify={notify}
        onCard={openCard}
      />
      {person && (
        <Profile
          key={person.id}
          person={person}
          state={state}
          store={store}
          hiddenReason={
            page === "map" ? graph.hiddenReasons[person.id] : undefined
          }
          people={live.people}
          onNavigate={select}
          initialTab={profileTab}
          onClose={() => setSelectedId(null)}
          onTodo={editTodoFor}
          onMail={(id) => {
            setSelectedId(null);
            setMailId(id);
          }}
          onDeleted={() => notify("삭제 보관함으로 이동했어요.")}
        />
      )}
      {editor?.type === "person" && (
        <PersonEditor
          store={store}
          onClose={() => setEditor(null)}
          onSaved={(id) => {
            select(id);
            notify("새 인맥을 추가했어요.");
          }}
        />
      )}
      {editor?.type === "meeting" && (
        <MeetingEditor
          store={store}
          state={state}
          meeting={editor.value}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.type === "todo" && (
        <TodoEditor
          store={store}
          people={live.people}
          todo={editor.value}
          personId={editor.personId}
          initialDate={editor.date}
          onClose={() => setEditor(null)}
        />
      )}
      {cardTab && (
        <CardImport
          session={session}
          initialTab={cardTab}
          onClose={() => setCardTab(null)}
          onSaved={(id) => {
            select(id);
            notify("명함에서 인맥을 등록했어요.");
          }}
          onViewPerson={(id) => {
            setCardTab(null);
            select(id);
          }}
          onFindMemory={findSavedMemory}
        />
      )}
      {mailPerson && (
        <MailComposer
          key={mailPerson.id}
          person={mailPerson}
          state={state}
          store={store}
          onClose={() => setMailId(null)}
          onPersona={() => setPersonaOpen(true)}
        />
      )}
      {personaOpen && (
        <PersonaEditor store={store} onClose={() => setPersonaOpen(false)} />
      )}
      {settings && (
        <Modal title="데이터 관리" onClose={() => setSettings(false)} wide>
          <div className="settings-intro">
            <Monitor size={22} />
            <div>
              <strong>
                {mode === "demo" ? "샘플 체험 공간" : "내 인맥 공간"}
              </strong>
              <p>
                팀 공용 서버의 기록입니다. 새로고침하면 다른 기기의 변경도
                반영됩니다.
              </p>
            </div>
          </div>
          <StorageControls session={session} />
        </Modal>
      )}
      {help && (
        <Modal title="Persnapse 사용 가이드" onClose={() => setHelp(false)}>
          <div className="help-content">
            <h3>만남을 기록하고, 연결을 이어가세요.</h3>
            <ol>
              <li>
                <strong>인맥 추가</strong>로 사람을 등록하거나 AI에 만남을
                이야기하세요.
              </li>
              <li>지도의 인맥을 눌러 연락처·메모·일정을 확인하세요.</li>
              <li>
                <strong>만남 기록</strong>에서 함께한 사람과 날짜를 연결하세요.
              </li>
              <li>일정을 완료하고, 필요한 인맥에게 다시 연락하세요.</li>
            </ol>
            <p>
              지도는 드래그·확대할 수 있고, 인맥 관리에서 키보드로도 탐색할 수
              있습니다.
            </p>
            <p>
              보호된 팀용 미리보기입니다. 모든 팀원이 같은 서버 기록을
              사용합니다. 인맥과 만남은 삭제 보관함에서 복원할 수 있습니다.
            </p>
            <p>
              AI 연결 상태는 어시스턴트에 표시됩니다. 음성 파일은 현재 탭에 임시
              보관되며, 녹음 메모만 서버에 저장됩니다.
            </p>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="alert">
          <Check size={17} />
          <span>{toast}</span>
          <button aria-label="알림 닫기" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
