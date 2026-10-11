export class RequestInputError extends Error {
  constructor(
    message: string,
    public readonly code:
      "INVALID_JSON" | "INVALID_FORM_DATA" | "BUSINESS_CARD_IMAGE_REQUIRED",
  ) {
    super(message);
    this.name = "RequestInputError";
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    // Only parsing the HTTP body is classified here. A service/provider parsing
    // failure after this step must remain an application error.
    throw new RequestInputError(
      "요청 내용이 올바른 JSON 형식이 아닙니다. 입력을 확인한 뒤 다시 시도해 주세요.",
      "INVALID_JSON",
    );
  }
}

export async function readFormDataBody(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new RequestInputError(
      "명함 업로드 형식이 올바르지 않습니다. 이미지를 다시 선택해 주세요.",
      "INVALID_FORM_DATA",
    );
  }
}

export function requestInputErrorResponse(error: unknown): Response | null {
  if (!(error instanceof RequestInputError)) return null;
  return Response.json(
    { error: error.message, code: error.code },
    { status: 400, headers: { "Cache-Control": "private, no-store" } },
  );
}
