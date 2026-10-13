class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.ended = false;
    this.buffer = new Int16Array(4096);
    this.used = 0;
    this.port.onmessage = ({ data }) => {
      if (data === "start" || data === "resume") this.recording = true;
      if (data === "pause") {
        this.recording = false;
        this.flush();
      }
      if (data === "stop") {
        this.recording = false;
        this.flush();
        this.ended = true;
        this.port.postMessage({ type: "stopped" });
      }
    };
  }
  flush() {
    if (!this.used) return;
    const samples = this.buffer.slice(0, this.used);
    this.port.postMessage({ type: "samples", samples }, [samples.buffer]);
    this.used = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (this.recording && channels?.length) {
      for (let frame = 0; frame < channels[0].length; frame++) {
        let value = 0;
        for (const channel of channels) value += channel[frame];
        value = Math.max(-1, Math.min(1, value / channels.length));
        this.buffer[this.used++] = Math.round(
          value * (value < 0 ? 32768 : 32767),
        );
        if (this.used === this.buffer.length) this.flush();
      }
    }
    return !this.ended;
  }
}
registerProcessor("persnapse-pcm-recorder", PcmRecorderProcessor);
