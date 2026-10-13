import type { CV } from "@techstark/opencv-js";

import {
  orderCardCorners,
  rectifiedCardSize,
  type CardCorners,
} from "./geometry";

export type CardRestoration =
  | {
      kind: "restored";
      file: File;
      width: number;
      height: number;
      corners: CardCorners;
      coverage: number;
    }
  | { kind: "fallback"; reason: "no-card-boundary" | "engine-unavailable" };

let opencvPromise: Promise<CV> | null = null;

async function openCv(): Promise<CV> {
  if (!opencvPromise) {
    opencvPromise = new Promise<CV>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/vendor/opencv.js";
      script.async = true;
      script.onload = () => {
        const runtime = (window as Window & { cv?: CV | Promise<CV> }).cv;
        if (!runtime) {
          reject(new Error("OpenCV browser runtime was not initialized."));
          return;
        }
        Promise.resolve(runtime).then(resolve, reject);
      };
      script.onerror = () =>
        reject(new Error("OpenCV browser runtime could not be loaded."));
      document.head.appendChild(script);
    }).catch((error: unknown) => {
      opencvPromise = null;
      throw error;
    });
  }
  return opencvPromise;
}

async function drawSource(file: File): Promise<HTMLCanvasElement> {
  const source = document.createElement("canvas");
  let image: ImageBitmap | HTMLImageElement;
  let url: string | null = null;
  if (typeof createImageBitmap === "function") {
    image = await createImageBitmap(file, { imageOrientation: "from-image" });
  } else {
    url = URL.createObjectURL(file);
    image = new Image();
    image.src = url;
    await image.decode();
  }
  try {
    const bitmap =
      typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap;
    const width = bitmap
      ? image.width
      : (image as HTMLImageElement).naturalWidth;
    const height = bitmap
      ? image.height
      : (image as HTMLImageElement).naturalHeight;
    const scale = Math.min(1, 2560 / Math.max(width, height));
    source.width = Math.max(1, Math.round(width * scale));
    source.height = Math.max(1, Math.round(height * scale));
    const context = source.getContext("2d");
    if (!context)
      throw new Error("명함 이미지 처리 환경을 사용할 수 없습니다.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, source.width, source.height);
    return source;
  } finally {
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
      image.close();
    if (url) URL.revokeObjectURL(url);
  }
}

function detectCardCorners(
  cv: CV,
  source: HTMLCanvasElement,
): { corners: CardCorners; coverage: number } | null {
  const scale = Math.min(1, 1280 / Math.max(source.width, source.height));
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(source.width * scale));
  small.height = Math.max(1, Math.round(source.height * scale));
  const smallContext = small.getContext("2d");
  if (!smallContext)
    throw new Error("명함 이미지 처리 환경을 사용할 수 없습니다.");
  smallContext.drawImage(source, 0, 0, small.width, small.height);

  const input = cv.imread(small);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.cvtColor(input, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 45, 140);
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
    );

    let best: { corners: CardCorners; coverage: number } | null = null;
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      const approximation = new cv.Mat();
      try {
        const coverage = cv.contourArea(contour) / (small.width * small.height);
        if (
          coverage < 0.12 ||
          coverage > 0.985 ||
          coverage <= (best?.coverage ?? 0)
        ) {
          continue;
        }
        cv.approxPolyDP(
          contour,
          approximation,
          0.025 * cv.arcLength(contour, true),
          true,
        );
        if (approximation.rows !== 4 || !cv.isContourConvex(approximation)) {
          continue;
        }
        const points = Array.from({ length: 4 }, (_, point) => ({
          x: (approximation.data32S[point * 2] * source.width) / small.width,
          y:
            (approximation.data32S[point * 2 + 1] * source.height) /
            small.height,
        }));
        const corners = orderCardCorners(points);
        if (corners && rectifiedCardSize(corners)) {
          best = { corners, coverage };
        }
      } finally {
        approximation.delete();
        contour.delete();
      }
    }
    return best;
  } finally {
    hierarchy.delete();
    contours.delete();
    edges.delete();
    blurred.delete();
    gray.delete();
    input.delete();
  }
}

function warpCard(
  cv: CV,
  source: HTMLCanvasElement,
  corners: CardCorners,
  size: { width: number; height: number },
): HTMLCanvasElement {
  const input = cv.imread(source);
  const output = new cv.Mat();
  const from = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    corners.flatMap((point) => [point.x, point.y]),
  );
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    size.width - 1,
    0,
    size.width - 1,
    size.height - 1,
    0,
    size.height - 1,
  ]);
  const transform = cv.getPerspectiveTransform(from, to);
  try {
    cv.warpPerspective(
      input,
      output,
      transform,
      new cv.Size(size.width, size.height),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
    );
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    cv.imshow(canvas, output);
    return canvas;
  } finally {
    transform.delete();
    to.delete();
    from.delete();
    output.delete();
    input.delete();
  }
}

function jpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("명함 이미지를 저장하지 못했습니다.")),
      "image/jpeg",
      quality,
    );
  });
}

async function encodeRestoredCard(
  canvas: HTMLCanvasElement,
): Promise<{ file: File; width: number; height: number }> {
  let current = canvas;
  let quality = 0.94;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const blob = await jpegBlob(current, quality);
    if (blob.size <= 3_200_000) {
      return {
        file: new File([blob], "restored-business-card.jpg", {
          type: "image/jpeg",
          lastModified: Date.now(),
        }),
        width: current.width,
        height: current.height,
      };
    }
    if (quality > 0.7) {
      quality -= 0.08;
    } else {
      const smaller = document.createElement("canvas");
      smaller.width = Math.round(current.width * 0.85);
      smaller.height = Math.round(current.height * 0.85);
      const context = smaller.getContext("2d");
      if (!context)
        throw new Error("명함 이미지 처리 환경을 사용할 수 없습니다.");
      context.drawImage(current, 0, 0, smaller.width, smaller.height);
      current = smaller;
    }
  }
  throw new Error("복원 이미지를 전송 가능한 크기로 만들지 못했습니다.");
}

export async function restoreBusinessCardImage(
  file: File,
  manualCorners?: CardCorners,
): Promise<CardRestoration> {
  let cv: CV;
  try {
    cv = await openCv();
  } catch {
    return { kind: "fallback", reason: "engine-unavailable" };
  }
  const source = await drawSource(file);
  const detected = manualCorners
    ? (() => {
        const corners = orderCardCorners(
          manualCorners.map((point) => ({
            x: point.x * source.width,
            y: point.y * source.height,
          })),
        );
        if (
          !corners ||
          manualCorners.some(
            (point) => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1,
          )
        )
          return null;
        const doubledArea = corners.reduce((sum, point, index) => {
          const next = corners[(index + 1) % 4];
          return sum + point.x * next.y - next.x * point.y;
        }, 0);
        return {
          corners,
          coverage: doubledArea / (2 * source.width * source.height),
        };
      })()
    : detectCardCorners(cv, source);
  if (!detected) return { kind: "fallback", reason: "no-card-boundary" };
  const size = rectifiedCardSize(detected.corners);
  if (!size) return { kind: "fallback", reason: "no-card-boundary" };
  const canvas = warpCard(cv, source, detected.corners, size);
  const restored = await encodeRestoredCard(canvas);
  return {
    kind: "restored",
    file: restored.file,
    width: restored.width,
    height: restored.height,
    corners: detected.corners,
    coverage: detected.coverage,
  };
}
