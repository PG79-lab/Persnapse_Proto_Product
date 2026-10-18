"use client";
import { useMemo, useRef, useState, type Dispatch } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  Coffee,
  CalendarDays,
  ArrowRight,
  Mail,
  FileText,
  List,
  LocateFixed,
  Network,
  Pin,
  Plus,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import type { WorkspaceState } from "../../../domain/workspace/contracts";
import {
  defaultFilters,
  filterGraph,
  neighbors,
  visibleGraph,
  workspaceGraph,
  type GraphAction,
  type GraphNavigation,
  type GraphNode,
} from "./model";
import GraphCanvas from "./GraphCanvas";
import { identityTone } from "./appearance";

type Props = {
  preview?: boolean;
  state: WorkspaceState;
  nav: GraphNavigation;
  dispatch: Dispatch<GraphAction>;
  sidebarHost: HTMLElement | null;
  onAdd: () => void;
  onFullPerson: (id: string) => void;
  onMeeting: (id: string) => void;
  onTasks: (id: string) => void;
};

export default function GraphWorkspace({
  preview = false,
  state,
  nav,
  dispatch,
  sidebarHost,
  onAdd,
  onFullPerson,
  onMeeting,
  onTasks,
}: Props) {
  const graph = useMemo(() => workspaceGraph(state), [state]);
  const filtered = useMemo(
    () => filterGraph(graph, state, nav.filters),
    [graph, state, nav.filters],
  );
  const slice = useMemo(() => visibleGraph(filtered, nav), [filtered, nav]);
  const [listQuery, setListQuery] = useState("");
  const [listKind, setListKind] = useState<"person" | "interaction">("person");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandOpen, setExpandOpen] = useState(false);
  const [source, setSource] = useState<{
    selection: string;
    kind: "meeting" | "note";
    id: string;
  } | null>(null);
  const [fullSheet, setFullSheet] = useState(false);
  const toolbarRef = useRef<HTMLButtonElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const selected =
    nav.selection?.kind === "node"
      ? graph.nodes.find((n) => n.key === nav.selection?.key)
      : null;
  const edge =
    nav.selection?.kind === "edge"
      ? graph.edges.find((e) => e.key === nav.selection?.key)
      : null;
  const focus = graph.nodes.find((n) => n.key === nav.focus);
  const recentMeetings = state.meetings
    .filter((m) => !m.deletedAt)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 2);
  const person =
    selected?.kind === "person"
      ? state.people.find((p) => p.id === selected.sourceId && !p.deletedAt)
      : null;
  const meeting =
    selected?.kind === "interaction"
      ? state.meetings.find((m) => m.id === selected.sourceId && !m.deletedAt)
      : null;
  const relatedMeetings = person
    ? state.meetings
        .filter(
          (m) =>
            !m.deletedAt &&
            state.edges.some(
              (e) => e.personId === person.id && e.meetingId === m.id,
            ),
        )
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    : [];
  const relatedPeople = meeting
    ? graph.nodes.filter(
        (n) =>
          n.kind === "person" &&
          neighbors(graph, selected!.key).includes(n.key),
      )
    : [];
  const tasks = person
    ? state.todos.filter(
        (t) => !t.deletedAt && !t.done && t.personId === person.id,
      )
    : [];
  const activeSource =
    nav.inspectorOpen &&
    source?.selection === nav.selection?.key &&
    (selected || edge)
      ? source
      : null;
  const sourceMeeting =
    activeSource?.kind === "meeting"
      ? state.meetings.find(
          (m) =>
            !m.deletedAt &&
            m.id === activeSource.id &&
            (relatedMeetings.some((r) => r.id === m.id) ||
              meeting?.id === m.id ||
              edge?.to === `interaction:${m.id}`),
        )
      : null;
  const sourceNote =
    activeSource?.kind === "note"
      ? person?.history.find((n) => n.id === activeSource.id && !n.deletedAt)
      : null;
  const sourceContent = sourceMeeting
    ? {
        title: sourceMeeting.name,
        date: sourceMeeting.date,
        text: sourceMeeting.description,
      }
    : sourceNote
      ? { title: "저장 메모", date: sourceNote.date, text: sourceNote.text }
      : null;
  const outside =
    selected && !filtered.nodes.some((n) => n.key === selected.key);
  const anchor = selected?.key ?? focus?.key;
  const years = [
    ...new Set(
      state.meetings
        .filter((m) => !m.deletedAt)
        .map((m) => m.date?.slice(0, 4))
        .filter(Boolean),
    ),
  ] as string[];
  const listNodes = filtered.nodes.filter(
    (n) =>
      n.kind === listKind &&
      `${n.label} ${n.subtitle}`
        .toLowerCase()
        .includes(listQuery.toLowerCase()),
  );
  const activeFilters = Object.entries(nav.filters).filter(
    ([key, value]) =>
      value !== defaultFilters[key as keyof typeof defaultFilters],
  ).length;

  function choose(node: GraphNode) {
    setSource(null);
    setFullSheet(false);
    dispatch({ type: "select", selection: { kind: "node", key: node.key } });
  }
  function closeInspector() {
    dispatch({ type: "close" });
    setFullSheet(false);
    setSource(null);
    const target =
      nav.selection?.kind === "node"
        ? document.querySelector<SVGGElement>(
            `[data-node-key="${nav.selection.key}"]`,
          )
        : null;
    if (target) target.focus();
    else toolbarRef.current?.focus();
  }
  function expand(kind: GraphNode["kind"]) {
    if (!anchor) return;
    const id = `${anchor}/${kind}`;
    const old = nav.expansions.find((e) => e.id === id);
    const candidates = neighbors(filtered, anchor)
      .filter((key) => filtered.nodes.find((n) => n.key === key)?.kind === kind)
      .sort();
    dispatch({
      type: "expand",
      revision: nav.revision,
      expansion: {
        id,
        anchor,
        kind,
        keys: [
          ...(old?.keys ?? []),
          ...candidates
            .filter((key) => !slice.nodes.some((n) => n.key === key))
            .slice(0, 10),
        ],
      },
    });
    setExpandOpen(false);
    expandButtonRef.current?.focus();
  }
  function openSource(kind: "meeting" | "note", id: string) {
    if (nav.selection) setSource({ selection: nav.selection.key, kind, id });
  }
  const list = (
    <section className="graph-archive" aria-label="지도 탐색 목록">
      <div className="graph-archive-heading">
        <span>네트워크 탐색</span>
        <span>{filtered.nodes.length}</span>
      </div>
      <div className="graph-list-tabs" aria-label="목록 종류">
        <button
          aria-pressed={listKind === "person"}
          onClick={() => setListKind("person")}
        >
          <Users size={14} />
          인물{" "}
          <small>
            {filtered.nodes.filter((n) => n.kind === "person").length}
          </small>
        </button>
        <button
          aria-pressed={listKind === "interaction"}
          onClick={() => setListKind("interaction")}
        >
          <Coffee size={14} />
          만남
        </button>
      </div>
      <label className="graph-list-search">
        <Search size={14} />
        <input
          aria-label="지도 목록 검색"
          placeholder="이 범위에서 찾기"
          value={listQuery}
          onChange={(e) => setListQuery(e.target.value)}
        />
      </label>
      <div
        className="graph-archive-items"
        onScroll={(e) =>
          dispatch({ type: "scroll", value: e.currentTarget.scrollTop })
        }
        ref={(element) => {
          if (element && Math.abs(element.scrollTop - nav.listScroll) > 2)
            element.scrollTop = nav.listScroll;
        }}
      >
        {listNodes.map((n) => (
          <button
            key={n.key}
            className="graph-archive-row"
            aria-pressed={nav.selection?.key === n.key}
            onClick={() => choose(n)}
          >
            <span
              className={`graph-avatar ${n.kind}`}
              data-tone={identityTone(n.sourceId)}
            >
              {n.kind === "person" ? n.label.slice(-2) : <Coffee size={15} />}
            </span>
            <span>
              <strong>{n.label}</strong>
              <small>{n.subtitle || "추가 정보 없음"}</small>
            </span>
            {nav.focus === n.key && (
              <LocateFixed size={13} aria-label="탐색 중심" />
            )}
          </button>
        ))}
        {!listNodes.length && (
          <p className="graph-muted">이 범위에 해당하는 기록이 없습니다.</p>
        )}
      </div>
    </section>
  );

  return (
    <section
      className={`graph-workspace ${nav.inspectorOpen ? "has-inspector" : ""}`}
      aria-label="관계 탐색 작업 공간"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        if (filtersOpen) {
          setFiltersOpen(false);
          filterButtonRef.current?.focus();
        } else if (expandOpen) {
          setExpandOpen(false);
          expandButtonRef.current?.focus();
        } else if (source) setSource(null);
        else if (nav.inspectorOpen) closeInspector();
      }}
    >
      {sidebarHost &&
        nav.presentation === "map" &&
        createPortal(list, sidebarHost)}
      <div className="graph-page-title">
        <div>
          <h1>
            관계 지도<span>Network</span>
          </h1>
          <p>사람과 만남, 그 사이의 기억을 연결하세요.</p>
        </div>
        <div className="graph-network-counts" aria-label="네트워크 기록 수">
          <span>
            <Users size={14} />
            <strong>
              {filtered.nodes.filter((n) => n.kind === "person").length}
            </strong>{" "}
            인물
          </span>
          <i />
          <span>
            <Coffee size={14} />
            <strong>
              {filtered.nodes.filter((n) => n.kind === "interaction").length}
            </strong>{" "}
            만남
          </span>
        </div>
      </div>
      <div className="graph-toolbar">
        <button
          ref={toolbarRef}
          className="graph-icon-button"
          aria-label="이전 탐색"
          title="이전 탐색"
          disabled={!nav.history.length}
          onClick={() => dispatch({ type: "back" })}
        >
          <ArrowLeft size={17} />
        </button>
        <div className="graph-context">
          <LocateFixed size={14} />
          <span>탐색 중심</span>
          <strong>
            {focus?.label ?? (nav.focus ? "열 수 없는 기록" : "전체 네트워크")}
          </strong>
        </div>
        {nav.focus && (
          <button
            className="graph-text-button"
            onClick={() => dispatch({ type: "focus", key: null })}
          >
            전체 보기
          </button>
        )}
        <div className="graph-toolbar-end">
          <button
            className="graph-presentation"
            aria-pressed={nav.presentation === "list"}
            onClick={() =>
              dispatch({
                type: "presentation",
                value: nav.presentation === "map" ? "list" : "map",
              })
            }
          >
            {nav.presentation === "map" ? (
              <List size={16} />
            ) : (
              <Network size={16} />
            )}
            <span>{nav.presentation === "map" ? "목록" : "지도"}</span>
          </button>
          <div className="graph-popover-anchor">
            <button
              ref={filterButtonRef}
              className="graph-control"
              aria-expanded={filtersOpen}
              onClick={() => {
                setFiltersOpen(!filtersOpen);
                setExpandOpen(false);
              }}
            >
              <SlidersHorizontal size={15} />
              필터{activeFilters > 0 ? ` ${activeFilters}` : ""}
            </button>
            {filtersOpen && (
              <div
                className="graph-filter-popover"
                role="group"
                aria-label="지도 필터"
              >
                <strong className="graph-filter-title">지도 필터</strong>
                <label>
                  상태
                  <select
                    value={nav.filters.status}
                    aria-label="상태"
                    onChange={(e) =>
                      dispatch({
                        type: "filter",
                        filters: { ...nav.filters, status: e.target.value },
                      })
                    }
                  >
                    <option value="all">전체 상태</option>
                    <option value="unclassified">미분류</option>
                    <option value="pending">대기</option>
                    <option value="success">성공</option>
                    <option value="failed">실패</option>
                  </select>
                </label>
                <label>
                  관계 용도
                  <select
                    value={nav.filters.category}
                    onChange={(e) =>
                      dispatch({
                        type: "filter",
                        filters: { ...nav.filters, category: e.target.value },
                      })
                    }
                  >
                    <option value="all">전체 용도</option>
                    <option value="networking">네트워킹</option>
                    <option value="project">프로젝트</option>
                    <option value="work">업무</option>
                    <option value="customer">고객</option>
                    <option value="unclassified">미분류</option>
                  </select>
                </label>
                <label>
                  만남 연도
                  <select
                    value={nav.filters.year}
                    onChange={(e) =>
                      dispatch({
                        type: "filter",
                        filters: {
                          ...nav.filters,
                          year: e.target.value,
                          month: "all",
                        },
                      })
                    }
                  >
                    <option value="all">모든 기간</option>
                    {years
                      .sort()
                      .reverse()
                      .map((y) => (
                        <option key={y}>{y}</option>
                      ))}
                  </select>
                </label>
                <label>
                  만남 월
                  <select
                    value={nav.filters.month}
                    disabled={nav.filters.year === "all"}
                    onChange={(e) =>
                      dispatch({
                        type: "filter",
                        filters: { ...nav.filters, month: e.target.value },
                      })
                    }
                  >
                    <option value="all">모든 월</option>
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i} value={i + 1}>
                        {i + 1}월
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  장소
                  <select
                    value={nav.filters.place}
                    onChange={(e) =>
                      dispatch({
                        type: "filter",
                        filters: { ...nav.filters, place: e.target.value },
                      })
                    }
                  >
                    <option value="all">모든 장소</option>
                    <option value="expo">전시회</option>
                    <option value="industrial">산업 현장</option>
                    <option value="client_site">고객사</option>
                    <option value="unclassified">미분류</option>
                  </select>
                </label>
                <label>
                  중요도
                  <select
                    value={nav.filters.importance}
                    onChange={(e) =>
                      dispatch({
                        type: "filter",
                        filters: { ...nav.filters, importance: e.target.value },
                      })
                    }
                  >
                    <option value="all">모든 중요도</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}단계
                      </option>
                    ))}
                  </select>
                </label>
                <label className="graph-check">
                  <input
                    type="checkbox"
                    checked={nav.filters.includeUndated}
                    onChange={(e) =>
                      dispatch({
                        type: "filter",
                        filters: {
                          ...nav.filters,
                          includeUndated: e.target.checked,
                        },
                      })
                    }
                  />
                  날짜 미정 포함
                </label>
                <button
                  className="graph-text-button"
                  onClick={() =>
                    dispatch({ type: "filter", filters: { ...defaultFilters } })
                  }
                >
                  필터 초기화
                </button>
                <button
                  className="graph-control"
                  onClick={() => {
                    setFiltersOpen(false);
                    filterButtonRef.current?.focus();
                  }}
                >
                  필터 닫기
                </button>
              </div>
            )}
          </div>
          <div className="graph-popover-anchor">
            <button
              ref={expandButtonRef}
              className="graph-control"
              disabled={!anchor || !!outside}
              aria-expanded={expandOpen}
              onClick={() => {
                setExpandOpen(!expandOpen);
                setFiltersOpen(false);
              }}
            >
              <Plus size={15} />
              <span>관련 기록 펼치기</span>
            </button>
            {expandOpen && anchor && (
              <div
                className="graph-expand-popover"
                role="group"
                aria-label="확장 범위"
              >
                <strong>{selected?.label ?? focus?.label}</strong>
                <p>현재 필터 안에서 종류별 최대 10개씩 펼칩니다.</p>
                {(["interaction", "person"] as const).map((kind) => {
                  const keys = neighbors(filtered, anchor).filter(
                    (key) =>
                      filtered.nodes.find((n) => n.key === key)?.kind === kind,
                  );
                  const remaining = keys.filter(
                    (key) => !slice.nodes.some((n) => n.key === key),
                  ).length;
                  return (
                    <button
                      key={kind}
                      className="graph-control"
                      disabled={remaining === 0}
                      onClick={() => expand(kind)}
                    >
                      {kind === "person" ? "연결 인물" : "참석 만남"} ·{" "}
                      {remaining
                        ? `${Math.min(10, remaining)}개 추가 / 전체 ${keys.length}`
                        : `전체 ${keys.length}개 표시 중`}
                      <Plus size={14} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="graph-scope" role="status">
        <span>
          {preview && (
            <span className="graph-preview-label">합성 미리보기 · </span>
          )}
          {focus
            ? `${focus.label}${focus.kind === "person" ? " 님" : ""}과 이어진 연결`
            : "전체 네트워크"}
        </span>
        <span>
          {graph.nodes.length - filtered.nodes.length > 0
            ? `필터 밖 ${graph.nodes.length - filtered.nodes.length}개 · 전체 검색 가능`
            : "실제 기록을 바탕으로 연결된 관계"}
        </span>
      </div>
      <div className="graph-stage">
        <div
          className="graph-canvas-layer"
          hidden={nav.presentation !== "map"}
          inert={nav.presentation !== "map"}
        >
          <GraphCanvas graph={slice} nav={nav} dispatch={dispatch} />
        </div>
        {nav.presentation === "list" && (
          <div className="graph-inline-list">{list}</div>
        )}
        {!nav.inspectorOpen && (
          <aside className="graph-overview" aria-label="네트워크 둘러보기">
            <div className="graph-overview-top">
              <Network size={16} />
              <span>나의 네트워크</span>
            </div>
            <div className="graph-overview-intro">
              <span className="graph-overview-symbol">
                <Network size={25} strokeWidth={1.4} />
              </span>
              <h2>
                연결 속에 담긴
                <br />
                기억을 발견하세요.
              </h2>
              <p>
                한 사람을 선택하면, 함께한 만남과
                <br />
                이어갈 이야기를 볼 수 있어요.
              </p>
              {focus && (
                <button
                  className="graph-overview-start"
                  onClick={() => choose(focus)}
                >
                  {focus.label} 님부터 살펴보기
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
            <section className="graph-overview-recent">
              <h3>
                최근 만남
                <span>{state.meetings.filter((m) => !m.deletedAt).length}</span>
              </h3>
              {recentMeetings.map((m) => (
                <button
                  key={m.id}
                  onClick={() =>
                    choose(
                      graph.nodes.find((n) => n.key === `interaction:${m.id}`)!,
                    )
                  }
                >
                  <span className="graph-record-icon">
                    <Coffee size={15} />
                  </span>
                  <span>
                    <strong>{m.name}</strong>
                    <small>{m.date ?? "날짜 미정"}</small>
                  </span>
                  <ChevronRight size={14} />
                </button>
              ))}
              {!recentMeetings.length && (
                <p className="graph-muted">만남을 기록하면 이곳에 모입니다.</p>
              )}
            </section>
            <div className="graph-overview-foot">
              <span className="graph-live-dot" />
              사람을 선택하면 기록이 열립니다
            </div>
          </aside>
        )}
        {!slice.nodes.length && nav.presentation === "map" && (
          <div className="graph-empty">
            <Network size={32} />
            <h2>
              {graph.nodes.length
                ? filtered.nodes.length
                  ? "탐색 중심이 현재 범위 밖에 있어요"
                  : "조건에 맞는 연결이 없어요"
                : "첫 만남에서 시작되는 연결"}
            </h2>
            <p>
              {graph.nodes.length
                ? "필터를 바꾸거나 전체 검색에서 인물을 찾아보세요."
                : "명함이나 만남을 기록하면 사람과 맥락이 이곳에 연결됩니다."}
            </p>
            <button
              className="primary-button"
              onClick={
                filtered.nodes.length
                  ? () => dispatch({ type: "focus", key: null })
                  : graph.nodes.length
                    ? () =>
                        dispatch({
                          type: "filter",
                          filters: { ...defaultFilters },
                        })
                    : onAdd
              }
            >
              {filtered.nodes.length
                ? "현재 범위 전체 보기"
                : graph.nodes.length
                  ? "필터 초기화"
                  : "인맥 추가하기"}
            </button>
          </div>
        )}
        {nav.inspectorOpen && (
          <aside
            className={`graph-inspector ${fullSheet ? "is-expanded" : ""}`}
            aria-label="선택 기록 상세"
          >
            <header>
              <span className="graph-inspector-heading">
                {activeSource ? (
                  <FileText size={14} />
                ) : selected?.kind === "interaction" ? (
                  <Coffee size={14} />
                ) : (
                  <Users size={14} />
                )}
                {activeSource
                  ? "기록 읽기"
                  : edge
                    ? "관계 기록"
                    : selected?.kind === "interaction"
                      ? "만남"
                      : "인물"}
              </span>
              <div>
                <button
                  className="graph-sheet-toggle graph-icon-button"
                  aria-label={fullSheet ? "상세 접기" : "상세 펼치기"}
                  onClick={() => setFullSheet(!fullSheet)}
                >
                  <ArrowUpRight size={17} />
                </button>
                <button
                  className="graph-icon-button"
                  aria-label="상세 닫기"
                  onClick={closeInspector}
                >
                  <X size={18} />
                </button>
              </div>
            </header>
            <div className="graph-inspector-body">
              {activeSource ? (
                <div className="graph-source">
                  <button
                    className="graph-text-button"
                    onClick={() => setSource(null)}
                  >
                    <ArrowLeft size={14} />
                    상세로 돌아가기
                  </button>
                  <span className="graph-eyebrow">
                    저장된 기록 · {sourceContent?.date ?? "날짜 미정"}
                  </span>
                  <h2>{sourceContent?.title ?? "기록을 열 수 없습니다"}</h2>
                  <p className="graph-source-text">
                    {sourceContent?.text ??
                      "기록이 삭제되었거나 현재 연결에서 더 이상 제공되지 않습니다."}
                  </p>
                  <p className="graph-muted">
                    작성된 기록 그대로입니다. 전사 원본과는 구분됩니다.
                  </p>
                </div>
              ) : (
                <>
                  {!selected && !edge && (
                    <div className="graph-empty-detail">
                      <h2>이 기록을 열 수 없습니다</h2>
                      <p>
                        삭제되었거나 현재 접근 가능한 기록에 없습니다. 다른
                        인물을 자동으로 선택하지 않았습니다.
                      </p>
                    </div>
                  )}
                  {selected && (
                    <>
                      <div className="graph-identity">
                        <span
                          className={`graph-avatar large ${selected.kind}`}
                          data-tone={identityTone(selected.sourceId)}
                        >
                          {selected.kind === "person" ? (
                            selected.label.slice(-2)
                          ) : (
                            <Coffee size={20} />
                          )}
                        </span>
                        <div className="graph-identity-text">
                          <h2>{selected.label}</h2>
                          <p>{selected.subtitle || "추가 정보 없음"}</p>
                        </div>
                        {person && relatedMeetings[0]?.date && (
                          <small>
                            <CalendarDays size={12} />
                            최근 만남 <span>{relatedMeetings[0].date}</span>
                          </small>
                        )}
                      </div>
                      <div className="graph-detail-actions">
                        <button
                          className="graph-control"
                          onClick={() =>
                            person
                              ? onFullPerson(person.id)
                              : onMeeting(selected.sourceId)
                          }
                        >
                          전체 상세
                          <ArrowUpRight size={14} />
                        </button>
                        <button
                          className="graph-control"
                          disabled={!!outside}
                          onClick={() =>
                            dispatch({ type: "focus", key: selected.key })
                          }
                        >
                          <LocateFixed size={14} />
                          중심으로 보기
                        </button>
                        <button
                          className="graph-icon-button"
                          aria-label={
                            nav.pins.includes(selected.key)
                              ? "위치 고정 해제"
                              : "위치 고정"
                          }
                          aria-pressed={nav.pins.includes(selected.key)}
                          onClick={() =>
                            dispatch({ type: "pin", key: selected.key })
                          }
                        >
                          <Pin size={16} />
                        </button>
                      </div>
                      {outside && (
                        <div className="graph-inline-notice">
                          현재 필터 밖의 인물입니다. 상세를 열어도 필터는 바뀌지
                          않습니다.
                          <button
                            className="graph-text-button"
                            onClick={() => {
                              dispatch({
                                type: "filter",
                                filters: { ...defaultFilters },
                              });
                              dispatch({ type: "focus", key: selected.key });
                            }}
                          >
                            필터 해제 후 지도에서 보기
                          </button>
                        </div>
                      )}
                      {person && (
                        <>
                          <section className="graph-detail-section graph-connections-section">
                            <h3>
                              연결 이유 <small>{relatedMeetings.length}</small>
                            </h3>
                            {relatedMeetings.length ? (
                              relatedMeetings.slice(0, 3).map((m) => (
                                <button
                                  key={m.id}
                                  className="graph-record-row"
                                  onClick={() => {
                                    if (m.description)
                                      openSource("meeting", m.id);
                                    else
                                      choose(
                                        graph.nodes.find(
                                          (n) =>
                                            n.key === `interaction:${m.id}`,
                                        )!,
                                      );
                                  }}
                                >
                                  <span className="graph-record-icon">
                                    <Coffee size={16} />
                                  </span>
                                  <span>
                                    <strong>{m.name}</strong>
                                    <small>
                                      참석 기록 · {m.date ?? "날짜 미정"}
                                    </small>
                                  </span>
                                  <ChevronRight size={15} />
                                </button>
                              ))
                            ) : (
                              <p className="graph-muted">
                                연결 이유를 확인할 만남 기록이 없습니다.
                                명함만으로 관계를 추정하지 않습니다.
                              </p>
                            )}
                          </section>
                          <section className="graph-detail-section graph-tasks-section">
                            <h3>
                              다음 행동 <small>{tasks.length}</small>
                            </h3>
                            {tasks.length ? (
                              tasks.map((t) => (
                                <button
                                  key={t.id}
                                  className="graph-record-row"
                                  onClick={() => onTasks(person.id)}
                                >
                                  <span className="graph-task-mark" />
                                  <span>
                                    <strong>{t.text}</strong>
                                    <small>
                                      {t.kind === "suggestion"
                                        ? "AI 제안"
                                        : t.kind === "commitment"
                                          ? "기록된 약속"
                                          : "후속 업무"}{" "}
                                      · {t.date ?? "날짜 미정"}
                                    </small>
                                  </span>
                                  <ArrowUpRight size={14} />
                                </button>
                              ))
                            ) : (
                              <p className="graph-muted">
                                기록된 다음 행동이 없습니다.
                              </p>
                            )}
                          </section>
                          <section className="graph-detail-section graph-memories-section">
                            <h3>
                              기억 <FileText size={13} />
                            </h3>
                            {person.history.filter((n) => !n.deletedAt)
                              .length ? (
                              person.history
                                .filter((n) => !n.deletedAt)
                                .slice(0, 3)
                                .map((n) => (
                                  <div className="graph-memory" key={n.id}>
                                    <p>{n.text}</p>
                                    <div>
                                      <span>
                                        저장 메모 · {n.date ?? "날짜 미정"}
                                      </span>
                                      <button
                                        className="graph-text-button"
                                        onClick={() => openSource("note", n.id)}
                                      >
                                        전체 기록
                                      </button>
                                    </div>
                                  </div>
                                ))
                            ) : (
                              <p className="graph-muted">
                                저장된 기억이 없습니다.
                              </p>
                            )}
                          </section>

                          {(person.email || person.phone) && (
                            <section className="graph-detail-section">
                              <h3>연락처</h3>
                              {person.email && (
                                <p className="graph-contact-value">
                                  <Mail size={14} />
                                  {person.email}
                                </p>
                              )}
                              {person.phone && <p>{person.phone}</p>}
                            </section>
                          )}
                        </>
                      )}
                      {meeting && (
                        <>
                          <section className="graph-detail-section">
                            <h3>함께한 인물</h3>
                            {relatedPeople.map((n) => (
                              <button
                                key={n.key}
                                className="graph-record-row"
                                onClick={() => choose(n)}
                              >
                                <span className="graph-avatar">
                                  {n.label.slice(0, 2)}
                                </span>
                                <span>
                                  <strong>{n.label}</strong>
                                  <small>{n.subtitle}</small>
                                </span>
                                <ChevronRight size={14} />
                              </button>
                            ))}
                          </section>
                          <section className="graph-detail-section">
                            <h3>저장된 만남 기록</h3>
                            {meeting.description ? (
                              <>
                                <p className="graph-source-excerpt">
                                  {meeting.description}
                                </p>
                                <button
                                  className="graph-text-button"
                                  onClick={() =>
                                    openSource("meeting", meeting.id)
                                  }
                                >
                                  <FileText size={14} />
                                  기록 읽기
                                </button>
                              </>
                            ) : (
                              <p className="graph-muted">
                                이 만남의 본문 기록이 없습니다.
                              </p>
                            )}
                          </section>
                        </>
                      )}
                    </>
                  )}
                  {edge && (
                    <>
                      <h2>
                        {edge.kind === "attended" ? "만남 참석" : "소개 기록"}
                      </h2>
                      <section className="graph-detail-section">
                        {[edge.from, edge.to].map((key) => {
                          const n = graph.nodes.find((n) => n.key === key)!;
                          return (
                            <button
                              key={key}
                              className="graph-record-row"
                              onClick={() => choose(n)}
                            >
                              <span>
                                <strong>{n.label}</strong>
                                <small>
                                  {n.kind === "person" ? "인물" : "만남"} ·{" "}
                                  {n.subtitle}
                                </small>
                              </span>
                              <ChevronRight size={14} />
                            </button>
                          );
                        })}
                        <p className="graph-muted">
                          {edge.kind === "attended"
                            ? "저장된 참석 기록으로 연결되어 있습니다. 친분이나 관심을 의미하지 않습니다."
                            : "첫 번째 인물에서 두 번째 인물로의 소개 기록입니다. 소개 당시 원문은 현재 조회에 포함되지 않았습니다."}
                        </p>
                      </section>
                      {edge.kind === "attended" &&
                        (() => {
                          const m = state.meetings.find(
                            (m) => `interaction:${m.id}` === edge.to,
                          );
                          return m?.description ? (
                            <button
                              className="graph-control"
                              onClick={() => openSource("meeting", m.id)}
                            >
                              <FileText size={15} />
                              만남 기록 보기
                            </button>
                          ) : (
                            <p className="graph-muted">
                              근거 본문이 제공되지 않았습니다.
                            </p>
                          );
                        })()}
                    </>
                  )}
                </>
              )}
            </div>
          </aside>
        )}
      </div>
      <footer className="graph-statusbar">
        <span>
          {slice.nodes.length}개 표시
          {slice.hiddenCount > 0
            ? ` · ${slice.hiddenCount}개는 목록에서 접근 가능`
            : ""}
        </span>
        <div>
          {nav.expansions.map((e) => (
            <button
              key={e.id}
              onClick={() => dispatch({ type: "collapse", id: e.id })}
            >
              {graph.nodes.find((n) => n.key === e.anchor)?.label ?? "확장"} ·{" "}
              {e.keys.length}개 접기 <X size={12} />
            </button>
          ))}
        </div>
        <span>선택과 탐색 중심은 별개입니다</span>
      </footer>
    </section>
  );
}
