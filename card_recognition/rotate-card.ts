export type CardRotation = 0 | 90 | 180 | 270;

/** Rotate encoded pixels, always from the unrotated rectification. */
export async function rotateCardImage(
  file: File,
  rotation: CardRotation,
  signal: AbortSignal,
): Promise<{ file: File; width: number; height: number }> {
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const canvas = document.createElement("canvas");
  try {
    signal.throwIfAborted();
    const swap = rotation === 90 || rotation === 270;
    canvas.width = swap ? bitmap.height : bitmap.width;
    canvas.height = swap ? bitmap.width : bitmap.height;
    if (rotation === 0)
      return { file, width: canvas.width, height: canvas.height };
    const context = canvas.getContext("2d");
    if (!context) throw new Error("명함 회전 환경을 사용할 수 없습니다.");
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("명함 회전에 실패했습니다.")),
        "image/jpeg",
        0.94,
      ),
    );
    signal.throwIfAborted();
    return {
      file: new File([blob], "rotated-business-card.jpg", {
        type: "image/jpeg",
      }),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}
