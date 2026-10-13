"use client";

import { useEffect, useRef, useState } from "react";
import { boundaryMetrics, isClockwiseConvex } from "./benchmark-metrics";
import { orderCardCorners, type CardCorners, type CardPoint } from "./geometry";
import manifest from "./models/manifest.json";
import { selectedBoundaryModelId } from "./model-policy";
import { restoreBusinessCardImage } from "./restore-image";
import { CardInferenceClient } from "./runtime/inference-client";

type Result = {
  engine: string;
  url: string | null;
  corners: CardPoint[];
  peaks?: number[];
  width: number;
  height: number;
  bytes: number;
  timings: Record<string, number>;
  iou: number | null;
};
const sampleCorners: CardCorners = [
  { x: 320, y: 160 },
  { x: 780, y: 80 },
  { x: 925, y: 660 },
  { x: 70, y: 620 },
];

export function CardRecognitionTestLab() {
  const [source, setSource] = useState<{
    file: File;
    url: string;
    sample: boolean;
  } | null>(null);
  const [engine, setEngine] = useState<string>(selectedBoundaryModelId);
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState("샘플 또는 사진을 선택하세요.");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0),
    client = useRef<CardInferenceClient | null>(null),
    urls = useRef(new Set<string>());

  useEffect(() => {
    const owned = urls.current;
    const revision = sequence;
    const runtime = client;
    return () => {
      revision.current++;
      runtime.current?.dispose();
      for (const url of owned) URL.revokeObjectURL(url);
      owned.clear();
    };
  }, []);

  function cancel() {
    sequence.current++;
    client.current?.dispose();
    client.current = null;
    setBusy(false);
    setStatus("테스트를 중단했습니다.");
  }
  function select(file: File, sample = false) {
    cancel();
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    setResult(null);
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setSource(null);
      setStatus("JPEG·PNG·WebP, 10MiB 이하 파일을 선택하세요.");
      return;
    }
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    setSource({ file, url, sample });
    setStatus("준비됐습니다. 외곽·복원 테스트를 실행하세요.");
  }
  async function sample() {
    const request = ++sequence.current;
    try {
      const response = await fetch("/card-test/sample.png");
      if (!response.ok) throw new Error("샘플을 준비하지 못했습니다.");
      const blob = await response.blob();
      if (sequence.current !== request) return;
      select(
        new File([blob], "synthetic-card.png", {
          type: "image/png",
        }),
        true,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "샘플 오류");
    }
  }

  async function run() {
    if (!source) return;
    client.current?.dispose();
    const job = ++sequence.current;
    setBusy(true);
    clearResult();
    setStatus("촬영 파일을 준비하고 있습니다.");
    const start = performance.now(),
      timings: Record<string, number> = {};
    let bitmap: ImageBitmap | null = null;
    const active = () => sequence.current === job;
    try {
      bitmap = await createImageBitmap(source.file, {
        imageOrientation: "from-image",
      });
      if (!active()) return;
      const originalWidth = bitmap.width,
        originalHeight = bitmap.height;
      const scale = Math.min(
        1,
        Math.sqrt(2_000_000 / (originalWidth * originalHeight)),
      );
      const width = Math.max(1, Math.floor(originalWidth * scale)),
        height = Math.max(1, Math.floor(originalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas를 사용할 수 없습니다.");
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      bitmap = null;
      const rgba = context.getImageData(0, 0, width, height);
      canvas.width = canvas.height = 0;
      timings.decodeMs = performance.now() - start;
      let normalized: CardCorners | undefined;
      let peaks: number[] | undefined;
      if (engine !== "legacy") {
        const model = manifest.models.find((model) => model.id === engine);
        if (!model) throw new Error("모델을 선택하세요.");
        const inference = new CardInferenceClient();
        client.current = inference;
        setStatus("실제 ONNX 모델을 불러오고 있습니다.");
        let before = performance.now();
        await inference.prepare(model.staticUrl);
        timings.prepareMs = performance.now() - before;
        if (!active()) return;
        setStatus("명함 외곽을 계산하고 있습니다.");
        before = performance.now();
        const input = await inference.preprocess(
          new Uint8Array(rgba.data.buffer),
          width,
          height,
        );
        timings.preprocessMs = performance.now() - before;
        const output = await inference.infer(input);
        const plane = output.dims[2] * output.dims[3];
        peaks = Array.from({ length: 4 }, (_, channel) => {
          let maximum = 0;
          for (let i = channel * plane; i < (channel + 1) * plane; i++)
            maximum = Math.max(maximum, output.data[i]);
          return maximum;
        });
        timings.inferenceMs = output.inferenceMs;
        before = performance.now();
        const points = await inference.corners(
          output.data,
          output.dims,
          width,
          height,
        );
        timings.postprocessMs = performance.now() - before;
        if (!active()) return;
        const corners = orderCardCorners(points);
        if (
          !corners ||
          !isClockwiseConvex(corners) ||
          corners.some(
            (p) => p.x < 0 || p.y < 0 || p.x >= width || p.y >= height,
          )
        ) {
          timings.totalMs = performance.now() - start;
          setResult({
            engine,
            url: null,
            corners: points.map((p) => ({ x: p.x / width, y: p.y / height })),
            peaks,
            width: 0,
            height: 0,
            bytes: 0,
            timings,
            iou: source.sample ? 0 : null,
          });
          setStatus(
            `테스트 완료 · 검출 ${points.length}/4점. 유효한 외곽이 없어 보정하지 않았습니다. 다른 모델이나 사진으로 비교하세요.`,
          );
          return;
        }
        normalized = corners.map((p) => ({
          x: p.x / width,
          y: p.y / height,
        })) as CardCorners;
      }
      setStatus("외곽으로 보정 미리보기를 만들고 있습니다.");
      // Yield so the progress/cancel UI paints before the legacy warp path runs.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      if (!active()) return;
      const before = performance.now();
      const restored = await restoreBusinessCardImage(source.file, normalized);
      timings.warpEncodeMs = performance.now() - before;
      if (!active()) return;
      if (restored.kind !== "restored")
        throw new Error(
          restored.reason === "engine-unavailable"
            ? "OpenCV를 불러오지 못했습니다."
            : "기존 검출기가 명함 외곽을 찾지 못했습니다.",
        );
      if (!normalized) {
        const legacyScale = Math.min(
          1,
          2560 / Math.max(originalWidth, originalHeight),
        );
        normalized = restored.corners.map((p) => ({
          x: p.x / Math.round(originalWidth * legacyScale),
          y: p.y / Math.round(originalHeight * legacyScale),
        })) as CardCorners;
      }
      const url = URL.createObjectURL(restored.file);
      urls.current.add(url);
      timings.totalMs = performance.now() - start;
      const truth = sampleCorners.map((p) => ({
        x: p.x / 1000,
        y: p.y / 760,
      })) as CardCorners;
      setResult({
        engine,
        peaks,
        url,
        corners: normalized,
        width: restored.width,
        height: restored.height,
        bytes: restored.file.size,
        timings,
        iou: source.sample ? boundaryMetrics(normalized, truth).iou : null,
      });
      setStatus("테스트 완료 · 외곽과 보정 이미지를 확인하세요.");
    } catch (error) {
      if (active())
        setStatus(error instanceof Error ? error.message : "테스트 실패");
    } finally {
      bitmap?.close();
      if (active()) {
        client.current?.dispose();
        client.current = null;
        setBusy(false);
      }
    }
  }

  function clearResult() {
    if (result?.url) {
      URL.revokeObjectURL(result.url);
      urls.current.delete(result.url);
    }
    setResult(null);
  }

  return (
    <section
      aria-label="명함 외곽 로컬 테스트"
      className="mb-6 rounded-2xl border border-[var(--border)] bg-white p-5"
    >
      <h2 className="text-lg font-semibold">명함 외곽·복원 테스트</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        사진을 선택해 실제 모델 결과를 비교하세요. 처리는 이 브라우저 안에서만
        수행하며 OCR·DB 저장은 실행하지 않습니다.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void sample()}
          disabled={busy}
          className="rounded-xl border px-4 py-2"
        >
          합성 샘플 불러오기
        </button>
        <label className="text-sm">
          테스트 사진{" "}
          <input
            aria-label="테스트 사진 선택"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) select(file);
              event.target.value = "";
            }}
          />
        </label>
        <label className="text-sm">
          검출 모델{" "}
          <select
            aria-label="검출 모델"
            value={engine}
            disabled={busy}
            onChange={(event) => {
              setEngine(event.target.value);
              clearResult();
            }}
            className="rounded-lg border p-2"
          >
            <option value="docaligner-t8">DocAligner T8</option>
            <option value="docaligner-lc100">DocAligner LC100</option>
            <option value="legacy">기존 OpenCV</option>
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !source}
          onClick={() => void run()}
          className="rounded-xl bg-[var(--accent)] px-4 py-2 text-white disabled:opacity-40"
        >
          외곽·복원 테스트 실행
        </button>
        {busy ? (
          <button
            type="button"
            onClick={cancel}
            className="rounded-xl border px-4 py-2"
          >
            테스트 중단
          </button>
        ) : null}
      </div>
      <p role="status" className="mt-3 text-sm">
        {status}
      </p>
      {source ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <figure>
            <figcaption className="mb-2 text-sm">
              촬영 이미지 · 검출 외곽
            </figcaption>
            <div className="relative inline-block max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={source.url}
                alt="테스트 촬영 이미지"
                className="block max-h-96 max-w-full"
              />
              {result ? (
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-0 size-full"
                  aria-label="검출한 네 모서리"
                >
                  {result.url ? (
                    <polygon
                      points={result.corners
                        .map((p) => `${p.x * 100},${p.y * 100}`)
                        .join(" ")}
                      fill="rgba(22,163,74,.12)"
                      stroke="#16a34a"
                      strokeWidth=".5"
                    />
                  ) : null}
                  {result.corners.map((p, i) => (
                    <circle
                      key={i}
                      cx={p.x * 100}
                      cy={p.y * 100}
                      r="1"
                      fill="#ef4444"
                    />
                  ))}
                </svg>
              ) : null}
            </div>
          </figure>
          {result?.url ? (
            <figure>
              <figcaption className="mb-2 text-sm">
                보정 미리보기 · 비율은 근사값
              </figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.url}
                alt="테스트 보정 미리보기"
                className="max-h-96 max-w-full"
              />
              <a
                href={result.url}
                download="card-test-result.jpg"
                className="mt-3 inline-block rounded-xl border px-4 py-2 text-sm"
              >
                보정 JPEG 다운로드
              </a>
            </figure>
          ) : null}
        </div>
      ) : null}
      {result ? (
        <div aria-label="테스트 측정 결과" className="mt-4 text-sm">
          <p>
            {result.engine} ·{" "}
            {result.url
              ? `${result.width}×${result.height}px · ${Math.round(result.bytes / 1024)}KiB`
              : `보정 없음 · 검출 ${result.corners.length}/4점`}
            {result.iou !== null
              ? ` · 샘플 외곽 IoU ${result.iou.toFixed(4)}`
              : ""}
          </p>
          {result.peaks ? (
            <p className="mt-1">
              코너별 최대 모델 응답:{" "}
              {result.peaks.map((value) => value.toFixed(3)).join(" / ")} (성공
              확률 아님)
            </p>
          ) : null}
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {Object.entries(result.timings).map(([name, time]) => (
              <div key={name}>
                <dt className="inline text-[var(--muted)]">{name} </dt>
                <dd className="inline">{time.toFixed(1)}ms</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <p className="mt-4 text-xs text-[var(--muted)]">
        이 패널은 현재 구현의 동작 확인용입니다. 모델 품질 통과·정확한 비율
        복원·모바일 성능·v2 저장 검증은 아직 완료되지 않았습니다. 검출 입력은
        최대 2MP로 준비하고 보정에는 선택한 파일을 사용합니다.
      </p>
    </section>
  );
}
