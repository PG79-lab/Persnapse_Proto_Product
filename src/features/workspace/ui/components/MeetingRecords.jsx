import { useState } from "react";
import {
  CalendarDays,
  Coffee,
  ExternalLink,
  ImageOff,
  MapPin,
  Pencil,
  Trash2,
  UserRound,
  Search,
  X,
} from "lucide-react";
import { Avatar, Empty, places } from "./ui.jsx";
import { validDate } from "../domain/dates.js";

function webUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function monthLabel(value) {
  if (value === "unknown") return "날짜 미정";
  const [year, month] = value.split("-");
  return `${year}년 ${Number(month)}월`;
}

function MeetingImage({ meeting, src, source }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="record-image">
      {failed ? (
        <div className="record-image-fallback">
          <ImageOff size={20} />
          <span>이미지를 불러올 수 없어요</span>
        </div>
      ) : (
        <img
          src={src}
          alt={`${meeting.name} 행사 이미지`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      )}
      {source && (
        <a href={source} target="_blank" rel="noopener noreferrer">
          이미지 출처 <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}

function MeetingCard({ meeting, participants, onSelect, onEdit, onDelete }) {
  const guests = [
    ...new Set(
      (meeting.guests || []).map((name) => name.trim()).filter(Boolean),
    ),
  ];
  const imageUrl = webUrl(meeting.imageUrl);
  const imageSource = webUrl(meeting.imageSourceUrl);
  const eventUrl = webUrl(meeting.eventUrl);
  return (
    <article className="record-card" aria-label={meeting.name}>
      {imageUrl && (
        <MeetingImage
          key={imageUrl}
          meeting={meeting}
          src={imageUrl}
          source={imageSource}
        />
      )}
      <div className="record-card-body">
        <div className="record-card-heading">
          <span className="record-kind">
            <Coffee size={15} />
            {places[meeting.placeType] || "기타 만남"}
          </span>
          <div className="record-actions">
            <button
              className="icon-button"
              aria-label={`${meeting.name} 수정`}
              onClick={() => onEdit(meeting)}
            >
              <Pencil size={15} />
            </button>
            <button
              className="icon-button"
              aria-label={`${meeting.name} 삭제`}
              onClick={() => onDelete(meeting.id)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
        <h3>{meeting.name}</h3>
        <div className="record-details">
          <span>
            <CalendarDays size={14} />
            <span className="sr-only">날짜: </span>
            {validDate(meeting.date) ? (
              <time dateTime={meeting.date}>{meeting.date}</time>
            ) : (
              "날짜 미정"
            )}
          </span>
          <span>
            <MapPin size={14} />
            <span className="sr-only">장소: </span>
            {meeting.place || places[meeting.placeType] || "장소 미입력"}
          </span>
        </div>
        {meeting.description && (
          <p className="record-description">{meeting.description}</p>
        )}
        {eventUrl && (
          <a
            className="record-event-link"
            href={eventUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            행사 정보 <ExternalLink size={13} />
          </a>
        )}
        <div className="record-participants">
          <h4>
            함께한 사람 <span>{participants.length + guests.length}명</span>
          </h4>
          <div className="record-people">
            {participants.map((person) => (
              <button
                key={person.id}
                className="record-person"
                aria-label={`${person.name} 프로필 보기`}
                onClick={() => onSelect(person.id)}
              >
                <Avatar person={person} size="small" />
                <span>
                  <strong>{person.name}</strong>
                  <small>{person.company || person.job || "등록된 인맥"}</small>
                </span>
              </button>
            ))}
            {guests.map((name) => (
              <div key={name} className="record-person record-guest">
                <span className="record-guest-avatar" aria-hidden="true">
                  <UserRound size={17} />
                </span>
                <span>
                  <strong>{name}</strong>
                  <small>게스트</small>
                </span>
              </div>
            ))}
            {!participants.length && !guests.length && (
              <p className="record-no-people">참석자를 추가해보세요.</p>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function MeetingRecords({
  meetings,
  people,
  edges,
  onSelect,
  onEdit,
  onDelete,
  onAdd,
}) {
  const [month, setMonth] = useState("all");
  const [query, setQuery] = useState("");
  const liveMeetings = meetings.filter((meeting) => !meeting.deletedAt);
  const groups = new Map();
  for (const meeting of [...liveMeetings].sort((a, b) =>
    (b.date || "").localeCompare(a.date || ""),
  )) {
    const key = validDate(meeting.date) ? meeting.date.slice(0, 7) : "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(meeting);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === "unknown") return 1;
    if (b === "unknown") return -1;
    return b.localeCompare(a);
  });
  const selected = month === "all" || groups.has(month) ? month : "all";
  const matching = (meeting) => {
    const participantIds = new Set(
      edges
        .filter((edge) => !edge.deletedAt && edge.meetingId === meeting.id)
        .map((edge) => edge.personId),
    );
    const names = people
      .filter((person) => participantIds.has(person.id))
      .map((person) => `${person.name} ${person.company || ""}`);
    return [
      meeting.name,
      meeting.description,
      meeting.place,
      ...(meeting.guests || []),
      ...names,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase());
  };
  const visibleKeys = (selected === "all" ? keys : [selected]).filter((key) =>
    groups.get(key).some(matching),
  );
  const count = visibleKeys.reduce(
    (total, key) => total + groups.get(key).filter(matching).length,
    0,
  );
  if (!liveMeetings.length) {
    return (
      <div className="meeting-records">
        <Empty
          title="첫 만남을 기록해보세요"
          description="행사와 만남, 함께한 사람을 월별로 정리할 수 있어요."
          action={
            <button className="primary-button" onClick={onAdd}>
              만남 기록
            </button>
          }
        />
      </div>
    );
  }
  return (
    <section className="meeting-records" aria-label="월별 만남 기록">
      <div className="records-toolbar">
        <label className="inline-search">
          <Search size={18} />
          <input
            aria-label="만남 기록 검색"
            placeholder="행사, 사람, 대화 내용으로 찾기"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button aria-label="만남 검색 초기화" onClick={() => setQuery("")}>
              <X size={16} />
            </button>
          )}
        </label>
        <p>
          만남 기록 <strong>{count}</strong>건
        </p>
        <label>
          월별 보기{" "}
          <select
            aria-label="만남 기록 월 선택"
            value={selected}
            onChange={(event) => setMonth(event.target.value)}
          >
            <option value="all">전체 기간</option>
            {keys.map((key) => (
              <option key={key} value={key}>
                {monthLabel(key)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!count && (
        <Empty
          title="찾는 만남이 없어요"
          description="검색어와 기간을 바꾸어 다시 찾아보세요."
          action={
            <button
              className="secondary-button"
              onClick={() => {
                setQuery("");
                setMonth("all");
              }}
            >
              검색·기간 초기화
            </button>
          }
        />
      )}
      {visibleKeys.map((key) => (
        <section
          className="record-month"
          key={key}
          aria-label={`${monthLabel(key)} 만남`}
        >
          <div className="record-month-heading">
            <h2>{monthLabel(key)}</h2>
            <span>{groups.get(key).filter(matching).length}건</span>
          </div>
          <div className="records-grid">
            {groups
              .get(key)
              .filter(matching)
              .map((meeting) => {
                const participantIds = new Set(
                  edges
                    .filter(
                      (edge) =>
                        !edge.deletedAt && edge.meetingId === meeting.id,
                    )
                    .map((edge) => edge.personId),
                );
                const participants = people.filter(
                  (person) =>
                    !person.deletedAt && participantIds.has(person.id),
                );
                return (
                  <MeetingCard
                    key={meeting.id}
                    meeting={meeting}
                    participants={participants}
                    onSelect={onSelect}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                );
              })}
          </div>
        </section>
      ))}
    </section>
  );
}
