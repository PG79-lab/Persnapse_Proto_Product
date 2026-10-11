import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  Mic,
  Pause,
  Play,
  Square,
  Upload,
  Download,
  FileAudio,
  Trash2,
  Headphones,
  FileText,
  Check,
  ArrowUpRight,
  Loader2,
} from "lucide-react";
import useAudioRecorder, {
  MAX_AUDIO_BYTES,
} from "../hooks/useAudioRecorder.js";
import { uid } from "../domain/model.js";
import { addNote } from "../domain/editing.js";
import {
  loadLocalRecordings,
  saveLocalRecording,
  updateLocalRecording,
  deleteLocalRecording,
} from "../services/recording-library.js";

export function durationLabel(seconds = 0) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
const emptyDraft = () => ({ title: "", notes: "", personId: "" });
function extension(type) {
  return type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
}
function fileName(title) {
  return Array.from(title || "녹음")
    .map((char) => (char.charCodeAt(0) < 32 ? "_" : char))
    .join("")
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 100);
}
function Waveform({ media, phase }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    let frame, audioContext, analyser, source;
    if (media && phase === "recording") {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContext();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 128;
        source = audioContext.createMediaStreamSource(media);
        source.connect(analyser);
        audioContext.resume().catch(() => {});
      } catch {
        /* The recorder can still work without the volume meter. */
      }
    }
    const data = new Uint8Array(64);
    function draw() {
      const width = Math.max(1, canvas.clientWidth),
        height = 64,
        ratio = devicePixelRatio || 1;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
      }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (analyser) analyser.getByteFrequencyData(data);
      const count = Math.floor(width / 9);
      ctx.fillStyle = phase === "recording" ? "#7541d6" : "#d8cde9";
      for (let i = 0; i < count; i++) {
        const level = analyser
          ? 4 + (data[Math.floor((i * 64) / count)] / 255) * 54
          : 4;
        ctx.beginPath();
        ctx.roundRect(i * 9 + 2, (height - level) / 2, 4, level, 2);
        ctx.fill();
      }
      if (analyser) frame = requestAnimationFrame(draw);
    }
    draw();
    const observer = new ResizeObserver(() => {
      if (!analyser) draw();
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      source?.disconnect();
      audioContext?.close().catch(() => {});
    };
  }, [media, phase]);
  return (
    <canvas ref={canvasRef} className="recording-waveform" aria-hidden="true" />
  );
}

export default function RecordingPage({
  people,
  store,
  active,
  onStateChange,
  stopSignal,
  onViewPerson,
}) {
  const [clips, setClips] = useState([]),
    [selectedId, setSelectedId] = useState(null);
  const [libraryStatus, setLibraryStatus] = useState("loading"),
    [libraryError, setLibraryError] = useState("");
  const [draft, setDraft] = useState(emptyDraft),
    [error, setError] = useState(""),
    [captureError, setCaptureError] = useState(""),
    [saving, setSaving] = useState(false);
  const input = useRef(null),
    player = useRef(null),
    detail = useRef(null),
    urls = useRef(new Set()),
    pendingNote = useRef(null),
    initialWrites = useRef(new Map());
  const selected = clips.find((clip) => clip.id === selectedId);
  const value = selected || draft;
  const recorder = useAudioRecorder(({ blob, duration }) => {
    addClip(
      blob,
      draft.title.trim() || `새 녹음 ${clips.length + 1}`,
      duration,
      draft,
    );
    setDraft(emptyDraft());
  });
  const busy = recorder.phase !== "idle";
  const labels = {
    idle: "녹음 준비",
    requesting: "마이크 연결 중",
    recording: "녹음 중",
    paused: "일시정지",
    finishing: "녹음 정리 중",
  };
  useEffect(() => {
    let mounted = true;
    loadLocalRecordings()
      .then((saved) => {
        if (!mounted) return;
        const restored = saved.map((clip) => {
          const url = URL.createObjectURL(clip.blob);
          urls.current.add(url);
          return { ...clip, url, localSaved: true };
        });
        setClips((current) => [
          ...current,
          ...restored.filter(
            (clip) => !current.some((item) => item.id === clip.id),
          ),
        ]);
        setLibraryStatus("ready");
      })
      .catch(() => {
        if (!mounted) return;
        setLibraryStatus("unavailable");
        setLibraryError(
          "이 브라우저에 음성을 보관할 수 없어요. 녹음 후 파일을 내려받아 주세요.",
        );
      });
    return () => {
      mounted = false;
    };
  }, []);
  function persistDetails(clip) {
    if (libraryStatus !== "ready") return;
    const initial = initialWrites.current.get(clip.id) || Promise.resolve();
    void initial
      .then(() => updateLocalRecording(clip))
      .catch(() => {
        setLibraryError(
          "녹음 정보 변경을 보관하지 못했어요. 필요한 음성은 내려받아 주세요.",
        );
      });
  }
  useEffect(() => {
    onStateChange({
      phase: recorder.phase,
      hasDraft: clips.length > 0 || Boolean(draft.notes || draft.title),
    });
  }, [recorder.phase, clips.length, draft.notes, draft.title, onStateChange]);
  const stopFromEffect = useEffectEvent(() => recorder.stop());
  useEffect(() => {
    if (stopSignal) stopFromEffect();
  }, [stopSignal]);
  useEffect(() => {
    if (!active) player.current?.pause();
  }, [active]);
  useEffect(() => {
    if (active && selectedId && matchMedia("(max-width: 900px)").matches)
      detail.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [selectedId, active]);
  useEffect(() => {
    if (
      !busy &&
      !clips.some((clip) => !clip.localSaved) &&
      !draft.notes &&
      !draft.title
    )
      return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, clips, draft.notes, draft.title]);
  useEffect(() => {
    const current = urls.current;
    return () => current.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  function addClip(blob, title, duration, extra = {}) {
    const url = URL.createObjectURL(blob);
    urls.current.add(url);
    const clip = {
      ...emptyDraft(),
      ...extra,
      id: uid("recording"),
      blob,
      url,
      title,
      duration,
      createdAt: new Date().toISOString(),
      downloaded: false,
      localSaved: false,
    };
    setClips((current) => [clip, ...current]);
    setSelectedId(clip.id);
    const write = saveLocalRecording(clip)
      .then(() => {
        setClips((current) =>
          current.map((item) =>
            item.id === clip.id ? { ...item, localSaved: true } : item,
          ),
        );
      })
      .catch(() => {
        setLibraryError(
          "음성을 이 브라우저에 보관하지 못했어요. 탭을 닫기 전에 파일을 내려받아 주세요.",
        );
      })
      .finally(() => initialWrites.current.delete(clip.id));
    initialWrites.current.set(clip.id, write);
  }
  function update(key, next) {
    setError("");
    if (selected) {
      persistDetails({ ...selected, [key]: next, noteSaved: false });
      setClips((current) =>
        current.map((clip) =>
          clip.id === selected.id
            ? { ...clip, [key]: next, noteSaved: false }
            : clip,
        ),
      );
    } else
      setDraft((current) => ({ ...current, [key]: next, noteSaved: false }));
  }
  function start() {
    setError("");
    setCaptureError("");
    if (libraryStatus === "loading") return;
    if (clips.length >= 10) {
      setCaptureError(
        "이 브라우저에는 최대 10개를 보관해요. 필요한 파일을 내려받고 목록을 정리해주세요.",
      );
      return;
    }
    player.current?.pause();
    setSelectedId(null);
    recorder.start();
  }
  function importFile(files) {
    setError("");
    setCaptureError("");
    if (busy || libraryStatus === "loading" || !files?.length) return;
    const file = files[0];
    if (files.length !== 1 || clips.length >= 10) {
      setCaptureError("한 번에 한 파일씩, 최대 10개까지 불러올 수 있어요.");
      return;
    }
    if (
      !/\.(mp3|m4a|mp4|wav|ogg|webm)$/i.test(file.name) ||
      (!file.type.startsWith("audio/") &&
        !["", "video/mp4", "video/webm"].includes(file.type)) ||
      !file.size ||
      file.size > MAX_AUDIO_BYTES
    ) {
      setCaptureError(
        "50MB 이하의 MP3·M4A·WAV·OGG·WebM 음성 파일을 선택해주세요.",
      );
      return;
    }
    recorder.clearError();
    player.current?.pause();
    addClip(file, file.name.replace(/\.[^.]+$/, ""), null, {
      originalName: file.name,
    });
  }
  async function remove(clip) {
    if (
      !window.confirm(
        "이 녹음을 이 브라우저에서 삭제할까요? 내려받지 않은 음성은 복구할 수 없습니다.",
      )
    )
      return;
    try {
      await (initialWrites.current.get(clip.id) || Promise.resolve());
      if (libraryStatus === "ready") await deleteLocalRecording(clip.id);
    } catch {
      setLibraryError(
        "브라우저에서 녹음을 삭제하지 못했어요. 다시 시도해주세요.",
      );
      return;
    }
    if (selectedId === clip.id) {
      player.current?.pause();
      setSelectedId(null);
    }
    URL.revokeObjectURL(clip.url);
    urls.current.delete(clip.url);
    setClips((current) => current.filter((item) => item.id !== clip.id));
  }
  async function saveNote() {
    if (!value.personId || !value.notes.trim() || saving) return;
    const snapshot = {
      target: selected?.id,
      personId: value.personId,
      notes: value.notes,
    };
    setSaving(true);
    setError("");
    try {
      const current = store.getSnapshot();
      const pending = pendingNote.current;
      if (pending) {
        const exists = current.state.people
          .find((person) => person.id === pending.snapshot.personId)
          ?.history.some((note) => note.id === pending.noteId);
        // A restore may remove the pending note; a global retry may already save it.
        if (
          (!exists && current.status !== "저장 결과 확인 필요") ||
          (current.status === "저장됨" &&
            JSON.stringify(pending.snapshot) !== JSON.stringify(snapshot))
        )
          pendingNote.current = null;
      }
      if (pendingNote.current) {
        if (
          JSON.stringify(pendingNote.current.snapshot) !==
          JSON.stringify(snapshot)
        )
          throw new Error(
            "이전 메모가 미저장 상태예요. 데이터 관리에서 저장을 복구한 뒤 다시 시도해주세요.",
          );
        await store.retry();
      } else {
        if (
          !store
            .getSnapshot()
            .state.people.some(
              (p) => p.id === snapshot.personId && !p.deletedAt,
            )
        )
          throw new Error("연결할 인맥을 다시 선택해주세요.");
        const noteId = uid();
        pendingNote.current = { snapshot, noteId };
        await store.transact((state) => {
          return addNote(state, snapshot.personId, snapshot.notes, noteId);
        });
      }
      if (!(await store.flush()))
        throw new Error(
          "메모를 저장하지 못했어요. 다시 시도하거나 데이터 관리에서 복구해주세요.",
        );
      pendingNote.current = null;
      if (snapshot.target) {
        const savedClip = clips.find((clip) => clip.id === snapshot.target);
        if (
          savedClip &&
          savedClip.notes === snapshot.notes &&
          savedClip.personId === snapshot.personId
        )
          persistDetails({ ...savedClip, noteSaved: true });
        setClips((current) =>
          current.map((clip) =>
            clip.id === snapshot.target &&
            clip.notes === snapshot.notes &&
            clip.personId === snapshot.personId
              ? { ...clip, noteSaved: true }
              : clip,
          ),
        );
      } else
        setDraft((current) =>
          current.notes === snapshot.notes &&
          current.personId === snapshot.personId
            ? { ...current, noteSaved: true }
            : current,
        );
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="recording-workspace">
      <div className="recording-capability-note" role="note">
        <FileText size={18} />
        <p>
          <strong>녹음하고, 중요한 내용은 직접 메모하세요.</strong> 자동 텍스트
          변환은 준비 중입니다.{" "}
          {libraryStatus === "unavailable"
            ? "이 브라우저에서 음성을 보관할 수 없어 파일 다운로드가 필요합니다."
            : "음성은 이 브라우저에 보관됩니다. 다른 기기에서 들으려면 파일을 내려받아 옮겨야 합니다."}
        </p>
      </div>
      {libraryError && (
        <p className="recording-library-alert" role="alert">
          {libraryError}
        </p>
      )}
      <div className="recording-main-column">
        <section
          className="capture-panel recorder-panel"
          aria-label="음성 녹음"
        >
          <div className="capture-panel-heading recording-panel-heading">
            <div>
              <h2>대화를 놓치지 마세요</h2>
              <p>녹음을 마친 뒤 다시 듣고 중요한 내용을 남겨보세요.</p>
            </div>
            <span className="capture-tag">음성 기록</span>
          </div>
          <div className={`recorder-stage ${recorder.phase}`}>
            <span className="recorder-status">
              <i />
              {labels[recorder.phase]}
            </span>
            <span className="recorder-time" aria-label="녹음 시간">
              {durationLabel(busy ? recorder.seconds : 0)}
            </span>
            <Waveform
              media={active ? recorder.media : null}
              phase={recorder.phase}
            />
            <div className="recorder-controls">
              {recorder.phase === "idle" ? (
                <button
                  className="primary-button record-start"
                  onClick={start}
                  disabled={libraryStatus === "loading"}
                >
                  <Mic size={20} />
                  녹음 시작
                </button>
              ) : recorder.phase === "requesting" ? (
                <>
                  <span className="muted">
                    <Loader2 size={16} className="spin" />
                    마이크 권한을 허용해주세요
                  </span>
                  <button className="secondary-button" onClick={recorder.stop}>
                    연결 취소
                  </button>
                </>
              ) : recorder.phase === "finishing" ? (
                <span className="muted">
                  <Loader2 size={18} className="spin" />
                  음성을 정리하고 있어요
                </span>
              ) : (
                <>
                  <button
                    className="secondary-button"
                    onClick={
                      recorder.phase === "paused"
                        ? recorder.resume
                        : recorder.pause
                    }
                  >
                    {recorder.phase === "paused" ? (
                      <Play size={18} />
                    ) : (
                      <Pause size={18} />
                    )}
                    {recorder.phase === "paused" ? "녹음 계속" : "일시정지"}
                  </button>
                  <button className="primary-button" onClick={recorder.stop}>
                    <Square size={16} />
                    녹음 마치기
                  </button>
                </>
              )}
            </div>
            <p className="recorder-hint">
              {busy
                ? recorder.phase === "paused"
                  ? "일시정지한 시간은 녹음 길이에 포함되지 않아요."
                  : "다른 메뉴로 이동해도 녹음은 계속됩니다."
                : "녹음 시작을 누르면 마이크 권한을 요청합니다. · 최대 30분"}
            </p>
          </div>
          {(captureError || recorder.error) && (
            <p className="error-text capture-error" role="alert">
              {captureError || recorder.error}
            </p>
          )}
          <div
            className="audio-import-row"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              importFile(e.dataTransfer.files);
            }}
          >
            <div>
              <strong>이미 녹음한 파일이 있나요?</strong>
              <small>MP3, M4A, WAV, OGG, WebM · 최대 50MB</small>
            </div>
            <button
              className="secondary-button"
              disabled={busy || libraryStatus === "loading"}
              onClick={() => input.current.click()}
            >
              <Upload size={16} />
              파일 불러오기
            </button>
            <input
              ref={input}
              type="file"
              aria-label="음성 파일"
              accept="audio/*,.m4a,.webm"
              hidden
              onChange={(e) => {
                importFile(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </section>
        <section
          className="capture-panel recording-library"
          aria-label="이 브라우저의 녹음 목록"
        >
          <div className="capture-panel-heading">
            <h2>
              이 브라우저의 녹음 <span>{clips.length}</span>
            </h2>
            <p>
              새로고침 후에도 이 기기에서 다시 들을 수 있어요. 다른 기기에는
              자동 공유되지 않습니다.
            </p>
          </div>
          {!clips.length ? (
            <div className="recording-list-empty">
              <Headphones size={25} />
              <div>
                <strong>아직 녹음이 없어요</strong>
                <p>녹음을 마치거나 파일을 불러오면 여기에 표시됩니다.</p>
              </div>
            </div>
          ) : (
            <div className="recording-items">
              {clips.map((clip) => (
                <div
                  className={`recording-item ${selectedId === clip.id ? "selected" : ""}`}
                  key={clip.id}
                >
                  <button
                    className="recording-select"
                    aria-pressed={selectedId === clip.id}
                    disabled={busy}
                    onClick={() => {
                      player.current?.pause();
                      setSelectedId(clip.id);
                      setError("");
                    }}
                  >
                    <span className="audio-file-icon">
                      <FileAudio size={20} />
                    </span>
                    <span>
                      <strong>{clip.title || "제목 없는 녹음"}</strong>
                      <small>
                        {new Date(clip.createdAt).toLocaleTimeString("ko-KR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        ·{" "}
                        {clip.duration === null
                          ? "음성 파일"
                          : durationLabel(clip.duration)}{" "}
                        ·{" "}
                        {clip.localSaved
                          ? "이 브라우저에 보관"
                          : "보관 확인 필요"}
                      </small>
                    </span>
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`${clip.title || "제목 없는 녹음"} 삭제`}
                    disabled={busy}
                    onClick={() => remove(clip)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <section
        ref={detail}
        className="capture-panel recording-detail"
        aria-label="녹음 내용 정리"
      >
        <div className="capture-panel-heading">
          <h2>{selected ? "녹음 내용" : "녹음 메모"}</h2>
          <p>
            {selected
              ? "다시 듣고, 기억할 내용을 인맥에 연결하세요."
              : "녹음 중에도 제목과 메모를 남길 수 있어요."}
          </p>
        </div>
        <div className="recording-detail-body">
          <label>
            제목
            <input
              aria-label="녹음 제목"
              maxLength={120}
              value={value.title}
              onChange={(e) => update("title", e.target.value)}
              placeholder="예: 서지윤님과 협업 미팅"
            />
          </label>
          {selected && (
            <div className="recording-playback">
              <audio
                key={selected.id}
                ref={player}
                controls
                preload="metadata"
                src={selected.url}
                aria-label="녹음 재생"
                onError={() =>
                  setError(
                    "이 브라우저에서 재생할 수 없는 파일이에요. 내려받아 다른 플레이어에서 열어주세요.",
                  )
                }
                onLoadedMetadata={(e) => {
                  const duration = e.currentTarget.duration;
                  if (selected.duration === null && Number.isFinite(duration))
                    setClips((current) =>
                      current.map((clip) =>
                        clip.id === selected.id ? { ...clip, duration } : clip,
                      ),
                    );
                }}
              />
              <a
                className="secondary-button"
                href={selected.url}
                download={
                  selected.originalName ||
                  `${fileName(selected.title)}.${extension(selected.blob.type)}`
                }
                onClick={() => {
                  persistDetails({ ...selected, downloaded: true });
                  setClips((current) =>
                    current.map((clip) =>
                      clip.id === selected.id
                        ? { ...clip, downloaded: true }
                        : clip,
                    ),
                  );
                }}
              >
                <Download size={16} />
                음성 내려받기
              </a>
            </div>
          )}
          <div className="recording-note-label">
            <span>
              <FileText size={16} />
              직접 메모
            </span>
            <small>자동 텍스트 변환 준비 중</small>
          </div>
          <textarea
            aria-label="녹음 메모"
            maxLength={2000}
            rows={8}
            value={value.notes}
            onChange={(e) => update("notes", e.target.value)}
            placeholder={
              "기억할 이야기나 다음 할 일을 적어두세요.\n\n예: 금요일까지 제안서 전달하기"
            }
          />
          <label>
            관련 인맥 <small>선택</small>
            <select
              aria-label="녹음 관련 인맥"
              value={value.personId}
              onChange={(e) => update("personId", e.target.value)}
            >
              <option value="">인맥 선택</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                  {person.company || person.job
                    ? ` · ${person.company || person.job}`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button"
            disabled={
              !value.personId ||
              !value.notes.trim() ||
              saving ||
              value.noteSaved
            }
            onClick={saveNote}
          >
            {saving ? (
              <Loader2 size={16} className="spin" />
            ) : value.noteSaved ? (
              <Check size={16} />
            ) : (
              <FileText size={16} />
            )}
            {value.noteSaved
              ? "인맥에 메모 저장됨"
              : saving
                ? "저장 중…"
                : "인맥에 메모 저장"}
          </button>
          {value.noteSaved && (
            <button
              className="text-button"
              onClick={() => onViewPerson(value.personId)}
            >
              인맥 프로필에서 보기
              <ArrowUpRight size={14} />
            </button>
          )}
          <p className="recording-storage-note">
            음성은 현재 브라우저에만 보관됩니다. 브라우저 데이터를 지우면 음성도
            사라질 수 있어요. 인맥에 저장한 텍스트 메모는 팀 공유 공간에
            저장됩니다. 자동 텍스트 변환은 아직 지원하지 않습니다.
          </p>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
