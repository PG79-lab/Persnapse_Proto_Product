import type { CV } from "@techstark/opencv-js";
import { CardInferenceClient } from "../../card_recognition/runtime/inference-client";
import { docalignerCorners } from "../../card_recognition/detectors/docaligner";
import {
  orderCardCorners,
  type CardCorners,
} from "../../card_recognition/geometry";
import { boundaryMetrics } from "../../card_recognition/benchmark-metrics";
import { restoreBusinessCardImage } from "../../card_recognition/restore-image";
import { rotateCardImage } from "../../card_recognition/rotate-card";
import manifest from "../../card_recognition/models/manifest.json";

// Baseline is supplied by the runner from its first immutable local snapshot.
declare global {
  interface Window {
    quickPilot: typeof run;
    cv: Promise<CV>;
  }
}

async function dataUrl(file: Blob) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

async function run(
  images: {
    imageId: string;
    file: string;
    truth?: { x: number; y: number }[];
    angles?: readonly (0 | 90 | 180 | 270)[];
  }[],
  synthetic = false,
) {
  const baselineUrl = "/baseline.js";
  const baseline = await import(/* webpackIgnore: true */ baselineUrl);
  // Initialize through the production restoration loader, avoiding two CV loads.
  const seedBlob = await (await fetch(`/pilot/${images[0].file}`)).blob();
  const seedFile = new File([seedBlob], "seed.png", { type: "image/png" });
  const seedBitmap = await createImageBitmap(seedFile);
  const seedCorners = images[0].truth
    ? (images[0].truth.map((p) => ({
        x: p.x / seedBitmap.width,
        y: p.y / seedBitmap.height,
      })) as CardCorners)
    : ([
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ] as CardCorners);
  seedBitmap.close();
  await restoreBusinessCardImage(seedFile, seedCorners);
  const cv = await window.cv;
  const client = new CardInferenceClient(),
    signal = new AbortController().signal;
  const start = performance.now();
  await client.prepare(
    manifest.models.find((m) => m.id === "docaligner-lc100")!.staticUrl,
    signal,
  );
  const modelLoadMs = performance.now() - start;
  const rows: Record<string, unknown>[] = [];
  try {
    for (const image of images) {
      const blob = await (await fetch(`/pilot/${image.file}`)).blob();
      const file = new File([blob], `${image.imageId}.png`, {
        type: "image/png",
      });
      const angles = image.angles ?? ([0] as const);
      for (const angle of angles) {
        console.log(`PILOT ${image.imageId} ${angle}`);
        const rotated = await rotateCardImage(file, angle, signal);
        const bitmap = await createImageBitmap(rotated.file);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const rgba = new Uint8Array(
          ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer,
        );
        const input = await client.preprocess(
          rgba,
          canvas.width,
          canvas.height,
          signal,
        );
        const heatmap = await client.infer(input, signal);
        const samples: {
          baselineMs: number;
          optimizedMs: number;
          identical: boolean;
        }[] = [];
        let points: CardCorners | null = null;
        for (let attempt = 0; attempt < (angle === 0 ? 3 : 1); attempt++) {
          let before = performance.now();
          const old = baseline.docalignerCorners(
            cv,
            heatmap.data,
            heatmap.dims,
            canvas.width,
            canvas.height,
          );
          const baselineMs = performance.now() - before;
          before = performance.now();
          const fresh = docalignerCorners(
            cv,
            heatmap.data,
            heatmap.dims,
            canvas.width,
            canvas.height,
          );
          samples.push({
            baselineMs,
            optimizedMs: performance.now() - before,
            identical: JSON.stringify(old) === JSON.stringify(fresh),
          });
          points = orderCardCorners(fresh);
        }
        const truth =
          angle === 0 && image.truth ? (image.truth as CardCorners) : undefined;
        const normalized = points?.map((p) => ({
          x: p.x / canvas.width,
          y: p.y / canvas.height,
        })) as CardCorners | undefined;
        const manual =
          !normalized && truth
            ? (truth.map((p) => ({
                x: p.x / canvas.width,
                y: p.y / canvas.height,
              })) as CardCorners)
            : undefined;
        const before = performance.now();
        const restoration =
          normalized || manual
            ? await restoreBusinessCardImage(rotated.file, normalized ?? manual)
            : null;
        const row = {
          imageId: image.imageId,
          angle,
          width: canvas.width,
          height: canvas.height,
          samples,
          inferred: Boolean(points),
          points,
          truth,
          metrics: truth ? boundaryMetrics(points, truth) : null,
          restoration: restoration?.kind ?? "NOT_RUN",
          manual: Boolean(manual),
          warpMs: performance.now() - before,
          source: await dataUrl(rotated.file),
          output:
            restoration?.kind === "restored"
              ? await dataUrl(restoration.file)
              : null,
        };
        rows.push(row);
        console.log(`DONE ${image.imageId} ${angle}`);
      }
    }
    // Known trapezoids test the perspective/manual recovery independently of LC100.
    if (synthetic)
      for (const [i, points] of [
        [
          { x: 150, y: 140 },
          { x: 850, y: 220 },
          { x: 800, y: 600 },
          { x: 200, y: 660 },
        ],
        [
          { x: 300, y: 100 },
          { x: 870, y: 300 },
          { x: 620, y: 700 },
          { x: 120, y: 500 },
        ],
      ].entries()) {
        const source = document.createElement("canvas");
        source.width = 640;
        source.height = 360;
        const c = source.getContext("2d")!;
        c.fillStyle = "white";
        c.fillRect(0, 0, 640, 360);
        c.fillStyle = "black";
        c.font = "40px sans-serif";
        c.fillText("PERSNAPSE TEST", 40, 100);
        c.fillText("UP  ↑   012345", 40, 200);
        const input = cv.imread(source),
          warped = new cv.Mat();
        const from = cv.matFromArray(
          4,
          1,
          cv.CV_32FC2,
          [0, 0, 639, 0, 639, 359, 0, 359],
        );
        const to = cv.matFromArray(
          4,
          1,
          cv.CV_32FC2,
          points.flatMap((p) => [p.x, p.y]),
        );
        const transform = cv.getPerspectiveTransform(from, to);
        const canvas = document.createElement("canvas");
        try {
          cv.warpPerspective(input, warped, transform, new cv.Size(1000, 800));
          cv.imshow(canvas, warped);
          const blob = await new Promise<Blob>((resolve) =>
            canvas.toBlob((b) => resolve(b!), "image/png"),
          );
          const result = await restoreBusinessCardImage(
            new File([blob], "skew.png", { type: "image/png" }),
            points.map((p) => ({ x: p.x / 1000, y: p.y / 800 })) as CardCorners,
          );
          rows.push({
            imageId: `synthetic-skew-${i + 1}`,
            angle: 0,
            manual: true,
            restoration: result.kind,
            source: await dataUrl(blob),
            output:
              result.kind === "restored" ? await dataUrl(result.file) : null,
          });
        } finally {
          transform.delete();
          to.delete();
          from.delete();
          warped.delete();
          input.delete();
        }
      }
    return {
      modelLoadMs,
      rows,
      scope:
        "Small same-heatmap browser experiment; provisional single-author GT; no external OCR",
    };
  } finally {
    client.dispose();
  }
}
window.quickPilot = run;
