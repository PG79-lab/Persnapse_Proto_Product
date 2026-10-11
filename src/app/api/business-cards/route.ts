import { businessCardUploadMetadataSchema } from "../../../domain/business-card/business-card-workflow";
import { createAndExtractBusinessCard } from "../../../server/application/business-card-service";
import { getServerEnv } from "../../../server/env";
import { assertPrototypeAccess } from "../../../server/security/prototype-access";
import {
  assertRequestBodyWithinLimit,
  maxBusinessCardHttpBodyBytes,
} from "../../../server/security/request-body-limit";
import { businessCardErrorResponse } from "./response";
import {
  readFormDataBody,
  RequestInputError,
} from "../../../server/http/request-body";

export const runtime = "nodejs";
export const maxDuration = 30;

function requiredFile(formData: FormData, name: string): File {
  const value = formData.get(name);
  if (!(value instanceof File)) {
    throw new RequestInputError(
      "명함 원본과 표시용 이미지 파일을 모두 첨부해 주세요.",
      "BUSINESS_CARD_IMAGE_REQUIRED",
    );
  }
  return value;
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  try {
    assertPrototypeAccess(request);
    assertRequestBodyWithinLimit(request, maxBusinessCardHttpBodyBytes);
    const formData = await readFormDataBody(request);
    const metadata = businessCardUploadMetadataSchema.parse({
      idempotencyKey: formData.get("idempotencyKey"),
      referenceTime: formData.get("referenceTime"),
      originalWidth: formData.get("originalWidth"),
      originalHeight: formData.get("originalHeight"),
      displayWidth: formData.get("displayWidth"),
      displayHeight: formData.get("displayHeight"),
      processingRecipe: formData.get("processingRecipe"),
    });
    const environment = getServerEnv();
    const card = await createAndExtractBusinessCard({
      workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
      ...metadata,
      originalFile: requiredFile(formData, "original"),
      displayFile: requiredFile(formData, "display"),
    });
    return Response.json(card, {
      status: 201,
      headers: {
        "Server-Timing": `total;dur=${Math.round(performance.now() - startedAt)}, ocr;dur=${card.ocrLatencyMs ?? 0}`,
      },
    });
  } catch (error) {
    return businessCardErrorResponse(error);
  }
}
