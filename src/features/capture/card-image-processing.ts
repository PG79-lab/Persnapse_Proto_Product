export interface ProcessedCardImage {
  originalFile: File;
  displayFile: File;
  originalWidth: number;
  originalHeight: number;
  displayWidth: number;
  displayHeight: number;
}

const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxOriginalBytes = 10 * 1024 * 1024;
export const maxBusinessCardRequestBytes = 4 * 1024 * 1024;
export const maxProcessedOriginalBytes = 2_300_000;
export const maxProcessedDisplayBytes = 1_500_000;

async function decodedImage(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  await image.decode();
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(url),
  };
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("이미지 보정에 실패했습니다.")),
      "image/jpeg",
      quality,
    );
  });
}

async function compressedJpeg(input: {
  source: CanvasImageSource;
  width: number;
  height: number;
  filename: string;
  maxBytes: number;
  filter?: string;
}): Promise<{ file: File; width: number; height: number }> {
  let width = input.width;
  let height = input.height;
  let quality = 0.88;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지 처리 환경을 사용할 수 없습니다.");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (input.filter) context.filter = input.filter;
    context.drawImage(input.source, 0, 0, canvas.width, canvas.height);

    const blob = await canvasBlob(canvas, quality);
    if (blob.size <= input.maxBytes) {
      return {
        file: new File([blob], input.filename, {
          type: "image/jpeg",
          lastModified: Date.now(),
        }),
        width: canvas.width,
        height: canvas.height,
      };
    }

    if (quality > 0.66) {
      quality -= 0.08;
    } else {
      width *= 0.84;
      height *= 0.84;
    }
  }

  throw new Error("모바일 전송에 맞게 명함 이미지를 압축하지 못했습니다.");
}

export async function processBusinessCardImage(
  originalFile: File,
): Promise<ProcessedCardImage> {
  if (!supportedTypes.has(originalFile.type)) {
    throw new Error("JPEG, PNG 또는 WebP 이미지를 선택해 주세요.");
  }
  if (originalFile.size <= 0 || originalFile.size > maxOriginalBytes) {
    throw new Error("이미지는 10MB 이하만 사용할 수 있습니다.");
  }

  const decoded = await decodedImage(originalFile);
  try {
    const longEdge = Math.max(decoded.width, decoded.height);
    const originalScale = Math.min(1, 2560 / longEdge);
    const targetLongEdge = Math.min(
      1960,
      Math.max(longEdge, Math.min(longEdge * 2, 1600)),
    );
    const displayScale = targetLongEdge / longEdge;
    const baseName =
      originalFile.name.replace(/\.[^.]+$/, "") || "business-card";
    const [processedOriginal, processedDisplay] = await Promise.all([
      compressedJpeg({
        source: decoded.source,
        width: decoded.width * originalScale,
        height: decoded.height * originalScale,
        filename: `${baseName}-original.jpg`,
        maxBytes: maxProcessedOriginalBytes,
      }),
      compressedJpeg({
        source: decoded.source,
        width: decoded.width * displayScale,
        height: decoded.height * displayScale,
        filename: `${baseName}-display.jpg`,
        maxBytes: maxProcessedDisplayBytes,
        filter: "contrast(1.04) saturate(1.01)",
      }),
    ]);

    if (
      processedOriginal.file.size + processedDisplay.file.size >=
      maxBusinessCardRequestBytes
    ) {
      throw new Error("명함 이미지 전송 크기를 4MB 아래로 줄여 주세요.");
    }

    return {
      originalFile: processedOriginal.file,
      displayFile: processedDisplay.file,
      originalWidth: processedOriginal.width,
      originalHeight: processedOriginal.height,
      displayWidth: processedDisplay.width,
      displayHeight: processedDisplay.height,
    };
  } finally {
    decoded.close();
  }
}

export async function captureBusinessCardFrame(
  video: HTMLVideoElement,
): Promise<File> {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (!videoWidth || !videoHeight) {
    throw new Error("카메라 화면이 준비되지 않았습니다.");
  }

  const desiredRatio = 1.586;
  let cropWidth = videoWidth * 0.88;
  let cropHeight = cropWidth / desiredRatio;
  if (cropHeight > videoHeight * 0.82) {
    cropHeight = videoHeight * 0.82;
    cropWidth = cropHeight * desiredRatio;
  }
  const sourceX = (videoWidth - cropWidth) / 2;
  const sourceY = (videoHeight - cropHeight) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cropWidth);
  canvas.height = Math.round(cropHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("촬영 이미지를 만들 수 없습니다.");
  context.drawImage(
    video,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const blob = await canvasBlob(canvas, 0.9);
  return new File([blob], `business-card-${Date.now()}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}
