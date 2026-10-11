import { useEffect, useEffectEvent, useRef, useState } from "react";

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_SECONDS = 30 * 60;

export default function useAudioRecorder(onComplete) {
  const [phase, setPhase] = useState("idle");
  const [seconds, setSeconds] = useState(0);
  const [media, setMedia] = useState(null);
  const [error, setError] = useState("");
  const recorder = useRef(null),
    stream = useRef(null),
    request = useRef(0);
  const mounted = useRef(true),
    busy = useRef(false),
    total = useRef(0),
    started = useRef(null);
  const complete = useRef(onComplete);
  useEffect(() => {
    complete.current = onComplete;
  }, [onComplete]);
  const elapsed = () =>
    (total.current +
      (started.current === null ? 0 : performance.now() - started.current)) /
    1000;
  function freezeTime() {
    if (started.current !== null)
      total.current += performance.now() - started.current;
    started.current = null;
    setSeconds(total.current / 1000);
  }
  function release() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (mounted.current) setMedia(null);
  }
  function stop() {
    if (!recorder.current) {
      request.current++;
      busy.current = false;
      setPhase("idle");
      release();
      return;
    }
    if (recorder.current.state === "inactive") return;
    freezeTime();
    setPhase("finishing");
    recorder.current.stop();
    release();
  }
  async function start() {
    if (busy.current) return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      setError(
        "이 브라우저에서는 직접 녹음을 사용할 수 없어요. 음성 파일을 불러와주세요.",
      );
      return;
    }
    busy.current = true;
    const version = ++request.current;
    setPhase("requesting");
    try {
      const source = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!mounted.current || version !== request.current) {
        source.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = source;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recording = new MediaRecorder(
        source,
        mimeType ? { mimeType } : undefined,
      );
      recorder.current = recording;
      const chunks = [];
      let bytes = 0;
      total.current = 0;
      started.current = performance.now();
      setSeconds(0);
      recording.ondataavailable = (event) => {
        if (!event.data.size) return;
        chunks.push(event.data);
        bytes += event.data.size;
        if (bytes >= MAX_AUDIO_BYTES && recording.state !== "inactive") {
          setError(
            "50MB에 도달해 녹음을 마쳤어요. 녹음된 파일을 내려받아주세요.",
          );
          stop();
        }
      };
      recording.onstop = () => {
        const duration = elapsed();
        started.current = null;
        release();
        recorder.current = null;
        busy.current = false;
        if (!mounted.current) return;
        setPhase("idle");
        const blob = new Blob(chunks, {
          type: recording.mimeType || chunks[0]?.type || "audio/webm",
        });
        if (blob.size) complete.current({ blob, duration });
        else
          setError(
            "녹음된 소리가 없어요. 마이크를 확인하고 다시 시도해주세요.",
          );
      };
      recording.onerror = () => {
        if (mounted.current)
          setError(
            "녹음이 중단됐어요. 남은 음성을 확인하고 필요하면 다시 녹음해주세요.",
          );
        stop();
      };
      source.getAudioTracks().forEach((track) =>
        track.addEventListener("ended", () => {
          if (recording.state !== "inactive") stop();
        }),
      );
      recording.start(1000);
      setMedia(source);
      setPhase("recording");
    } catch (e) {
      if (!mounted.current || version !== request.current) return;
      recorder.current = null;
      busy.current = false;
      release();
      setPhase("idle");
      setError(
        e.name === "NotAllowedError"
          ? "마이크 권한이 차단되었어요. 주소창의 사이트 권한에서 마이크를 허용하거나 음성 파일을 불러와주세요."
          : e.name === "NotFoundError"
            ? "연결된 마이크가 없어요. 마이크를 연결하거나 음성 파일을 불러와주세요."
            : "마이크를 시작하지 못했어요. 다른 앱에서 사용 중인지 확인하거나 음성 파일을 불러와주세요.",
      );
    }
  }
  function pause() {
    if (recorder.current?.state !== "recording") return;
    recorder.current.pause();
    freezeTime();
    // Paused recordings do not need microphone samples; retain the stream for resume.
    stream.current?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    setPhase("paused");
  }
  function resume() {
    if (recorder.current?.state !== "paused") return;
    stream.current?.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
    recorder.current.resume();
    started.current = performance.now();
    setPhase("recording");
  }
  const stopFromEffect = useEffectEvent(stop);
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => {
      const value = elapsed();
      setSeconds(value);
      if (value >= MAX_SECONDS) {
        setError(
          "30분에 도달해 녹음을 마쳤어요. 이어서 새 녹음을 시작할 수 있어요.",
        );
        stopFromEffect();
      }
    }, 200);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Invalidate the latest pending permission request on unmount. This is a counter, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      request.current++;
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.ondataavailable = null;
        recorder.current.onerror = null;
        if (recorder.current.state !== "inactive") recorder.current.stop();
      }
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  return {
    phase,
    seconds,
    media,
    error,
    clearError: () => setError(""),
    start,
    pause,
    resume,
    stop,
  };
}
