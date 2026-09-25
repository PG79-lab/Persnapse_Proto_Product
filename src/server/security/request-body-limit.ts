export const maxBusinessCardHttpBodyBytes = 4_400_000;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("명함 이미지 요청 크기가 너무 큽니다.");
    this.name = "RequestBodyTooLargeError";
  }
}

export function assertRequestBodyWithinLimit(
  request: Request,
  maxBytes: number,
): void {
  const header = request.headers.get("content-length");
  if (header === null) return;

  const contentLength = Number(header);
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0 ||
    contentLength > maxBytes
  ) {
    throw new RequestBodyTooLargeError();
  }
}
