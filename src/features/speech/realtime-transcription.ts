export type LiveProgress = { text: string; finalized: boolean };
export class RealtimeTranscription {
  private socket: WebSocket;
  private items = new Map<string, string>();
  private closed = false;
  private finalizing = false;
  private failure: string | null = null;
  private audioBytes = 0;
  private settle: ((text: string) => void) | null = null;
  private rejectFinal: ((error: Error) => void) | null = null;
  private finalTimer: ReturnType<typeof setTimeout> | null = null;
  get text() {
    return [...this.items.values()].join(" ").trim();
  }
  private constructor(
    socket: WebSocket,
    private onProgress: (progress: LiveProgress) => void,
    private onError: (message: string) => void,
  ) {
    this.socket = socket;
  }
  static async connect(
    language: string,
    hints: string,
    onProgress: (progress: LiveProgress) => void,
    onError: (message: string) => void,
    signal: AbortSignal,
  ) {
    const response = await fetch("/api/stt/realtime-session", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Persnapse-STT": "1" },
      body: JSON.stringify({ language, hints }),
      signal,
    });
    const payload = await response.json();
    if (!response.ok || typeof payload.token !== "string")
      throw new Error(payload.error || "실시간 전사에 연결하지 못했습니다.");
    if (signal.aborted) throw new Error("실시간 전사 연결이 취소됐습니다.");
    const socket = new WebSocket(
      "wss://api.openai.com/v1/realtime?intent=transcription",
      ["realtime", `openai-insecure-api-key.${payload.token}`],
    );
    const live = new RealtimeTranscription(socket, onProgress, onError);
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => {
        live.close();
        reject(new Error("실시간 전사 연결 시간이 초과됐습니다."));
      }, 12000);
      const abort = () => {
        cleanup();
        live.close();
        reject(new Error("실시간 전사 연결이 취소됐습니다."));
      };
      signal.addEventListener("abort", abort, { once: true });
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      };
      socket.onmessage = (event) => {
        if (live.closed) return;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (
          data.type === "session.created" ||
          data.type === "transcription_session.created"
        ) {
          ready = true;
          cleanup();
          resolve();
        }
        if (
          data.type === "error" ||
          data.type === "conversation.item.input_audio_transcription.failed"
        ) {
          const message = "실시간 전사가 중단됐습니다. 녹음 파일은 보관됩니다.";
          live.fail(message);
          if (!ready) {
            cleanup();
            reject(new Error(message));
          }
          return;
        }
        if (typeof data.item_id === "string") {
          if (
            data.type === "conversation.item.input_audio_transcription.delta" &&
            typeof data.delta === "string"
          ) {
            live.items.set(
              data.item_id,
              (live.items.get(data.item_id) ?? "") + data.delta,
            );
            live.onProgress({ text: live.text, finalized: false });
          }
          if (
            data.type ===
              "conversation.item.input_audio_transcription.completed" &&
            typeof data.transcript === "string"
          ) {
            live.items.set(data.item_id, data.transcript);
            live.onProgress({ text: live.text, finalized: true });
            if (live.finalizing) live.settle?.(live.text);
          }
        }
      };
      socket.onerror = () => {
        live.fail("실시간 전사 연결이 끊겼습니다. 녹음 파일은 보관됩니다.");
        if (!ready) {
          cleanup();
          reject(new Error("실시간 전사 연결에 실패했습니다."));
        }
      };
      socket.onclose = () => {
        if (!live.closed)
          live.fail("실시간 전사 연결이 종료됐습니다. 녹음 파일은 보관됩니다.");
        if (!ready) {
          cleanup();
          reject(new Error("실시간 전사 연결에 실패했습니다."));
        }
      };
    });
    return live;
  }
  append(samples: Int16Array) {
    if (
      this.closed ||
      this.failure ||
      this.socket.readyState !== WebSocket.OPEN
    )
      return;
    if (this.socket.bufferedAmount > 1_000_000) {
      this.fail(
        "네트워크가 느려 실시간 전사를 중단했습니다. 녹음 파일은 보관됩니다.",
      );
      return;
    }
    const bytes = new Uint8Array(
      samples.buffer,
      samples.byteOffset,
      samples.byteLength,
    );
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    this.socket.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: btoa(binary),
      }),
    );
    this.audioBytes += bytes.length;
  }
  async finish() {
    if (this.failure) {
      this.close();
      throw new Error(this.failure);
    }
    if (this.closed || this.audioBytes < 4800) {
      this.close();
      return "";
    }
    this.finalizing = true;
    try {
      return await new Promise<string>((resolve, reject) => {
        this.settle = resolve;
        this.rejectFinal = reject;
        this.finalTimer = setTimeout(
          () =>
            reject(
              new Error(
                "최종 전사 결과를 확정하지 못했습니다. 녹음 파일에서 다시 변환해 주세요.",
              ),
            ),
          25000,
        );
        this.socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      });
    } finally {
      this.close();
    }
  }
  private fail(message: string) {
    if (this.closed || this.failure) return;
    this.failure = message;
    this.onError(message);
    this.rejectFinal?.(new Error(message));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.finalTimer) clearTimeout(this.finalTimer);
    this.rejectFinal?.(new Error("실시간 전사가 종료됐습니다."));
    this.socket.close();
  }
}
