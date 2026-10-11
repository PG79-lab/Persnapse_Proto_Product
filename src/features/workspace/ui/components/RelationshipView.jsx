import {
  Network,
  FolderKanban,
  BriefcaseBusiness,
  Handshake,
  SlidersHorizontal,
} from "lucide-react";
import NetworkMap from "./NetworkMap.jsx";
import {
  relationshipCategories,
  personCategories,
} from "../domain/relationship-categories.js";
import { statuses, places } from "./ui.jsx";
const icons = {
  project: FolderKanban,
  work: BriefcaseBusiness,
  networking: Network,
  customer: Handshake,
};

export default function RelationshipView({
  live,
  graph,
  filters,
  filtersOpen,
  onFiltersOpen,
  onFilter,
  category,
  onCategory,
  years,
  selectedId,
  onSelect,
  onMeeting,
  onAdd,
  onOpenPeople,
  mode,
}) {
  const categoryCounts = Object.entries(relationshipCategories)
    .map(([key, label]) => ({
      key,
      label,
      count: live.people.filter((person) =>
        personCategories(person).includes(key),
      ).length,
    }))
    .filter(({ count }) => count > 0);
  const unclassifiedCount = live.people.filter(
    (person) => !personCategories(person).length,
  ).length;
  const activeFilters =
    Object.values(filters).filter((value) => value !== "all").length +
    (category !== "all" ? 1 : 0);
  function resetFilters() {
    onFilter({
      status: "all",
      importance: "all",
      place: "all",
      year: "all",
      month: "all",
    });
    onCategory("all");
  }
  return (
    <div className="relationship-view">
      {categoryCounts.length ? (
        <div className="relationship-summary" aria-label="용도별 관계 요약">
          {categoryCounts.map(({ key, label, count }) => {
            const Icon = icons[key];
            return (
              <button
                key={key}
                className="relationship-category-card"
                aria-pressed={category === key}
                onClick={() => onCategory(category === key ? "all" : key)}
              >
                <Icon size={20} />
                <div>
                  <span>{label}</span>
                  <strong>{count}</strong>
                  <small>명</small>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <section
          className="relationship-classification-prompt"
          aria-label="관계 용도 안내"
        >
          <div className="relationship-classification-icon">
            <Network size={20} />
          </div>
          <div>
            <span>관계 용도 정리</span>
            <h2>
              {live.people.length
                ? "연결은 준비됐어요"
                : "첫 인맥을 등록해 보세요"}
            </h2>
            <p>
              {live.people.length
                ? `${live.people.length}명의 인맥과 만남을 아래 지도에서 살펴볼 수 있어요. 인맥에 용도를 지정하면 프로젝트·업무별로 바로 모아 볼 수 있습니다.`
                : "명함이나 인맥을 등록하면 만남과 연결이 여기에 나타납니다."}
            </p>
          </div>
          <button
            className="secondary-button"
            onClick={live.people.length ? onOpenPeople : onAdd}
          >
            {live.people.length ? "인맥 정리하기" : "인맥 추가하기"}
          </button>
        </section>
      )}
      <div className="relationship-category-filter">
        <button
          className="text-button"
          aria-pressed={category === "all"}
          onClick={() => onCategory("all")}
        >
          전체 용도 · {live.people.length}명
        </button>
        <button
          className="text-button"
          aria-pressed={category === "unclassified"}
          onClick={() => onCategory("unclassified")}
        >
          미분류 · {unclassifiedCount}명
        </button>
        {category !== "all" && (
          <span className="muted">
            현재: {relationshipCategories[category] || "미분류"}
          </span>
        )}
      </div>
      {categoryCounts.length > 0 && unclassifiedCount > 0 && (
        <p className="relationship-summary-hint">
          {unclassifiedCount}명은 아직 용도가 지정되지 않았어요. 인맥 관리에서
          분류할 수 있습니다.
          <button className="text-button" onClick={onOpenPeople}>
            인맥 관리로 이동
          </button>
        </p>
      )}
      <section className="map-card" aria-label="인맥 네트워크 패널">
        <div className="map-card-heading">
          <div>
            <h2>인맥 네트워크</h2>
            <span>인맥과 만남의 흐름을 한눈에 살펴보세요</span>
          </div>
          <button
            className={`filter-button ${filtersOpen ? "active" : ""}`}
            onClick={onFiltersOpen}
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal size={15} />
            필터{activeFilters ? ` · ${activeFilters}` : ""}
          </button>
        </div>
        <div className="map-toolbar">
          <div className="filter-pills">
            <button
              className={filters.year === "all" ? "active" : ""}
              onClick={() => onFilter({ year: "all", month: "all" })}
            >
              전체 연결
            </button>
            {years.map((y) => (
              <button
                key={y}
                className={filters.year === y ? "active" : ""}
                onClick={() => onFilter({ year: y, month: "all" })}
              >
                {y}
              </button>
            ))}
          </div>
          <span>
            {graph.people.length}명의 인맥 · {graph.meetings.length}개의 만남
          </span>
        </div>
        {filtersOpen && (
          <div className="filter-panel">
            <label>
              상태
              <select
                value={filters.status}
                onChange={(e) => onFilter({ status: e.target.value })}
              >
                <option value="all">전체 상태</option>
                {Object.entries(statuses).map(([key, value]) => (
                  <option value={key} key={key}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              중요도
              <select
                value={filters.importance}
                onChange={(e) => onFilter({ importance: e.target.value })}
              >
                <option value="all">전체 중요도</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}단계
                  </option>
                ))}
              </select>
            </label>
            <label>
              장소
              <select
                value={filters.place}
                onChange={(e) => onFilter({ place: e.target.value })}
              >
                <option value="all">모든 장소</option>
                {Object.entries(places).map(([key, value]) => (
                  <option value={key} key={key}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              월
              <select
                disabled={filters.year === "all"}
                value={filters.month}
                onChange={(e) => onFilter({ month: e.target.value })}
              >
                <option value="all">모든 월</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}월
                  </option>
                ))}
              </select>
            </label>
            <button className="text-button" onClick={resetFilters}>
              초기화
            </button>
          </div>
        )}
        <NetworkMap
          graph={graph}
          links={graph.personLinks || live.personLinks}
          selectedId={selectedId}
          onSelect={onSelect}
          onMeeting={onMeeting}
          onAdd={onAdd}
          onResetFilters={resetFilters}
        />
        <div className="map-footer">
          <span>
            <i />
            {mode === "demo"
              ? "가상 데이터로 자유롭게 체험해보세요"
              : "팀 공유 공간에 저장됩니다 · 다른 기기에서도 확인할 수 있어요"}
          </span>
          <span>
            {graph.hiddenCount
              ? `필터로 숨겨진 인맥 ${graph.hiddenCount}명 · 전체 검색에서 조회 가능`
              : "인맥이나 만남을 선택하면 상세 기록을 볼 수 있어요"}
          </span>
        </div>
      </section>
    </div>
  );
}
