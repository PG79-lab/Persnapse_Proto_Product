export function pcmWavHeader(frames: number, sampleRate: number) {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const label = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  label(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  label(8, "WAVE");
  label(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, "data");
  view.setUint32(40, frames * 2, true);
  return buffer;
}

export class PcmRecorder {
  state: "inactive" | "recording" | "paused" = "inactive";
  readonly mimeType = "audio/wav";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onlimit: (() => void) | null = null;
  onpcmdata: ((samples: Int16Array) => void) | null = null;
  duration = 0;
  private chunks: ArrayBuffer[] = [];
  private frames = 0;
  private finished = false;
  private stopping = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private constructor(
    private context: AudioContext,
    private source: MediaStreamAudioSourceNode,
    private node: AudioWorkletNode,
    private gain: GainNode,
  ) {
    node.port.onmessage = ({ data }) => {
      if (this.finished) return;
      if (data.type === "samples") {
        const remaining = Math.floor((50 * 1024 * 1024 - 44) / 2) - this.frames;
        const samples = (data.samples as Int16Array).slice(
          0,
          Math.max(0, remaining),
        );
        this.chunks.push(samples.buffer);
        this.frames += samples.length;
        this.onpcmdata?.(samples);
        if (remaining <= data.samples.length && !this.stopping)
          this.onlimit?.();
      }
      if (data.type === "stopped") this.finish();
    };
    node.onprocessorerror = () => {
      this.dispose();
      this.onerror?.();
    };
  }
  static async create(stream: MediaStream, sampleRate = 16_000) {
    const context = new AudioContext({ sampleRate });
    try {
      await context.audioWorklet.addModule("/audio/pcm-recorder-worklet.js");
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "persnapse-pcm-recorder", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(node);
      node.connect(gain);
      gain.connect(context.destination);
      await context.resume();
      return new PcmRecorder(context, source, node, gain);
    } catch (error) {
      await context.close();
      throw error;
    }
  }
  start() {
    this.state = "recording";
    this.node.port.postMessage("start");
  }
  pause() {
    this.state = "paused";
    this.node.port.postMessage("pause");
  }
  resume() {
    this.state = "recording";
    this.node.port.postMessage("resume");
  }
  stop() {
    if (this.stopping || this.finished) return;
    this.stopping = true;
    this.state = "inactive";
    this.node.port.postMessage("stop");
    this.watchdog = setTimeout(() => {
      this.dispose();
      this.onerror?.();
    }, 5_000);
  }
  private finish() {
    if (this.finished) return;
    this.duration = this.frames / this.context.sampleRate;
    const blob = new Blob(
      [pcmWavHeader(this.frames, this.context.sampleRate), ...this.chunks],
      { type: this.mimeType },
    );
    const hasFrames = this.frames > 0;
    this.dispose();
    if (hasFrames) this.ondataavailable?.({ data: blob });
    this.onstop?.();
  }
  dispose() {
    this.finished = true;
    this.state = "inactive";
    if (this.watchdog) clearTimeout(this.watchdog);
    this.chunks = [];
    this.source.disconnect();
    this.node.disconnect();
    this.gain.disconnect();
    this.node.port.close();
    void this.context.close().catch(() => {});
  }
}
