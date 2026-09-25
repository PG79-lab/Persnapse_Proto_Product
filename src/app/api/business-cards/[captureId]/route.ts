import { discardBusinessCardCapture } from "../../../../server/application/business-card-service";
import { getBusinessCardCapture } from "../../../../server/db/business-card-repository";
import { getServerEnv } from "../../../../server/env";
import { assertPrototypeAccess } from "../../../../server/security/prototype-access";
import { businessCardErrorResponse } from "../response";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ captureId: string }> },
) {
  try {
    assertPrototypeAccess(request);
    const { captureId } = await params;
    const environment = getServerEnv();
    const card = await getBusinessCardCapture(
      environment.APP_DEFAULT_WORKSPACE_ID,
      captureId,
    );
    if (!card) {
      return Response.json(
        { error: "명함 Capture를 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    return Response.json(card);
  } catch (error) {
    return businessCardErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ captureId: string }> },
) {
  try {
    assertPrototypeAccess(request);
    const { captureId } = await params;
    const environment = getServerEnv();
    await discardBusinessCardCapture(
      environment.APP_DEFAULT_WORKSPACE_ID,
      captureId,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return businessCardErrorResponse(error);
  }
}
