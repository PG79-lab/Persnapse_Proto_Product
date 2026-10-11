import { ZodError } from "zod";
import { PrototypeAccessError } from "../security/prototype-access";
import { RequestInputError } from "./request-body";

export class WorkspaceError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function workspaceResponse(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export function workspaceErrorResponse(error: unknown) {
  if (error instanceof PrototypeAccessError)
    return workspaceResponse(
      { error: "접근할 수 없습니다.", code: "NOT_FOUND" },
      404,
    );
  if (error instanceof WorkspaceError)
    return workspaceResponse(
      { error: error.message, code: error.code },
      error.status,
    );
  if (error instanceof ZodError || error instanceof RequestInputError)
    return workspaceResponse(
      {
        error: "입력 형식과 필수 항목을 확인해 주세요.",
        code: "INVALID_INPUT",
      },
      400,
    );
  return workspaceResponse(
    {
      error: "서버에 연결하지 못했습니다. 입력을 유지하고 다시 시도해 주세요.",
      code: "WORKSPACE_UNAVAILABLE",
    },
    503,
  );
}
