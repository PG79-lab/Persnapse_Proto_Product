export function encodeMonoWav(
  samples: Float32Array,
  sampleRate = 16_000,
): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  function label(offset: number, text: string) {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  }
  label(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
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
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(
      44 + i * 2,
      Math.round(sample * (sample < 0 ? 32768 : 32767)),
      true,
    );
  }
  return buffer;
}

// A WAV with a complete header has a finite duration and reliable seeking, unlike
// some streaming WebM blobs produced by MediaRecorder. Use the browser resampler.
export async function prepareRecording(blob: Blob) {
  if (!blob.size || blob.size > 10 * 1024 * 1024)
    throw new Error("음성 변환은 10MB 이하의 짧은 녹음에서 사용할 수 있어요.");
  const context = new AudioContext();
  try {
    let decoded: AudioBuffer;
    try {
      decoded = await context.decodeAudioData(await blob.arrayBuffer());
    } catch {
      throw new Error(
        "녹음 파일의 음성 데이터를 읽을 수 없습니다. 파일을 내려받아 확인하거나 새로 녹음해 주세요.",
      );
    }
    if (!decoded.length || decoded.duration > 100.5)
      throw new Error(
        "텍스트 변환은 최대 100초 녹음을 지원합니다. 더 짧게 녹음해 주세요.",
      );
    const duration = Math.min(decoded.duration, 100);
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(duration * 16_000),
      16_000,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return new Blob([encodeMonoWav(rendered.getChannelData(0))], {
      type: "audio/wav",
    });
  } finally {
    await context.close();
  }
}
