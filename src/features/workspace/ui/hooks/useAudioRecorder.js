import { useEffect, useEffectEvent, useRef, useState } from "react";
import { PcmRecorder } from "../../../speech/pcm-recorder";
import { RealtimeTranscription } from "../../../speech/realtime-transcription";

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_SECONDS = 30 * 60;

export default function useAudioRecorder(
  onComplete,
  { realtime = false, language = "ko", hints = "", onTranscript } = {},
) {
  const [phase, setPhase] = useState("idle");
  const [seconds, setSeconds] = useState(0);
  const [media, setMedia] = useState(null);
  const [error, setError] = useState("");
  const [liveText, setLiveText] = useState("");
  const live = useRef(null),
    connection = useRef(null);
  const finalSession = useRef(null),
    transcriptCallback = useRef(onTranscript);
  useEffect(() => {
    transcriptCallback.current = onTranscript;
  }, [onTranscript]);
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
    if (finalSession.current) return;
    if (!recorder.current) {
      request.current++;
      busy.current = false;
      setPhase("idle");
      release();
      connection.current?.abort();
      live.current?.close();
      live.current = null;
      return;
    }
    if (recorder.current.state === "inactive") return;
    freezeTime();
    setPhase("finishing");
    recorder.current.stop();
  }
  async function start() {
    if (busy.current) return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioWorkletNode) {
      setError(
        "이 브라우저에서는 직접 녹음을 사용할 수 없어요. 음성 파일을 불러와주세요.",
      );
      return;
    }
    busy.current = true;
    const version = ++request.current;
    setPhase("requesting");
    setLiveText("");
    let microphoneRequested = false;
    try {
      if (realtime) {
        const abort = new AbortController();
        connection.current = abort;
        live.current = await RealtimeTranscription.connect(
          language,
          hints,
          ({ text }) => {
            if (mounted.current && version === request.current)
              setLiveText(text);
          },
          (message) => {
            if (mounted.current && version === request.current)
              setError(message);
          },
          abort.signal,
        );
      }
      if (!mounted.current || version !== request.current) {
        live.current?.close();
        return;
      }
      microphoneRequested = true;
      const source = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!mounted.current || version !== request.current) {
        source.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = source;
      const recording = await PcmRecorder.create(
        source,
        realtime ? 24000 : 16000,
      );
      if (!mounted.current || version !== request.current) {
        recording.dispose();
        source.getTracks().forEach((track) => track.stop());
        return;
      }
      recorder.current = recording;
      recording.onpcmdata = (samples) => live.current?.append(samples);
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
      recording.onstop = async () => {
        const duration = recording.duration;
        started.current = null;
        release();
        recorder.current = null;
        if (!mounted.current) {
          live.current?.close();
          return;
        }
        const blob = new Blob(chunks, {
          type: recording.mimeType || chunks[0]?.type || "audio/webm",
        });
        const session = live.current;
        live.current = null;
        // Preserve the WAV immediately; provider finalization must not delay storage.
        const clipId = blob.size
          ? complete.current({ blob, duration, realtime: Boolean(session) })
          : null;
        if (session) {
          finalSession.current = session;
          setPhase("finishing");
          let transcript = "",
            finalError = "";
          try {
            transcript = await session.finish();
            if (!transcript)
              finalError = "인식된 말이 없습니다. 녹음을 확인해 주세요.";
          } catch (caught) {
            finalError = caught.message;
          }
          finalSession.current = null;
          if (mounted.current && version === request.current) {
            if (finalError) setError(finalError);
            transcriptCallback.current?.(clipId, transcript, finalError);
          }
        }
        busy.current = false;
        if (!mounted.current || version !== request.current) return;
        setPhase("idle");
        if (!blob.size)
          setError(
            "녹음된 소리가 없어요. 마이크를 확인하고 다시 시도해주세요.",
          );
      };
      recording.onerror = () => {
        if (mounted.current)
          setError(
            "녹음이 중단됐어요. 남은 음성을 확인하고 필요하면 다시 녹음해주세요.",
          );
        recorder.current = null;
        live.current?.close();
        live.current = null;
        busy.current = false;
        release();
        setPhase("idle");
      };
      recording.onlimit = () => {
        setError("50MB에 도달해 녹음을 마쳤어요.");
        stop();
      };
      source.getAudioTracks().forEach((track) =>
        track.addEventListener("ended", () => {
          if (recording.state !== "inactive") stop();
        }),
      );
      recording.start();
      setMedia(source);
      setPhase("recording");
    } catch (e) {
      if (!mounted.current || version !== request.current) return;
      connection.current?.abort();
      live.current?.close();
      live.current = null;
      recorder.current = null;
      busy.current = false;
      release();
      setPhase("idle");
      setError(
        realtime && !microphoneRequested
          ? e.message
          : e.name === "NotAllowedError"
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
      if (value >= (realtime ? 100 : MAX_SECONDS)) {
        setError(
          realtime
            ? "100초에 도달해 녹음을 마쳤어요."
            : "30분에 도달해 녹음을 마쳤어요. 이어서 새 녹음을 시작할 수 있어요.",
        );
        stopFromEffect();
      }
    }, 200);
    return () => clearInterval(timer);
  }, [phase, realtime]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      connection.current?.abort();
      live.current?.close();
      finalSession.current?.close();
      // Invalidate the latest pending permission request on unmount. This is a counter, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      request.current++;
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.ondataavailable = null;
        recorder.current.onerror = null;
        recorder.current.dispose();
      }
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  return {
    phase,
    seconds,
    media,
    error,
    liveText,
    clearError: () => setError(""),
    start,
    pause,
    resume,
    stop,
  };
}
