import { restoredCardMetadataSchema } from "../../../../../../card_recognition/contracts";
import { uuidSchema } from "../../../../../domain/workspace/contracts";
import { replaceBusinessCardDisplay } from "../../../../../server/application/business-card-service";
import { getServerEnv } from "../../../../../server/env";
import {
  readFormDataBody,
  RequestInputError,
} from "../../../../../server/http/request-body";
import {
  assertRequestBodyWithinLimit,
  maxBusinessCardHttpBodyBytes,
} from "../../../../../server/security/request-body-limit";
import { assertPrototypeAccess } from "../../../../../server/security/prototype-access";
import { businessCardErrorResponse } from "../../response";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ captureId: string }> },
) {
  try {
    assertPrototypeAccess(request);
    assertRequestBodyWithinLimit(request, maxBusinessCardHttpBodyBytes);
    const { captureId } = await params;
    uuidSchema.parse(captureId);
    const formData = await readFormDataBody(request);
    const file = formData.get("image");
    const metadataValue = formData.get("metadata");
    if (!(file instanceof File) || typeof metadataValue !== "string") {
      throw new RequestInputError(
        "복원 이미지와 처리 정보를 첨부해 주세요.",
        "INVALID_FORM_DATA",
      );
    }
    let rawMetadata: unknown;
    try {
      rawMetadata = JSON.parse(metadataValue) as unknown;
    } catch {
      throw new RequestInputError(
        "복원 이미지 처리 정보가 올바르지 않습니다.",
        "INVALID_FORM_DATA",
      );
    }
    const metadata = restoredCardMetadataSchema.parse(rawMetadata);
    const environment = getServerEnv();
    return Response.json(
      await replaceBusinessCardDisplay({
        workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
        captureId,
        file,
        ...metadata,
      }),
    );
  } catch (error) {
    return businessCardErrorResponse(error);
  }
}
