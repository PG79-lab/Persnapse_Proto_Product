import { getSourceAsset } from "../../../../server/db/business-card-repository";
import { getServerEnv } from "../../../../server/env";
import { assertPrototypeAccess } from "../../../../server/security/prototype-access";
import { downloadBusinessCardAsset } from "../../../../server/storage/business-card-storage";
import { uuidSchema } from "../../../../domain/workspace/contracts";
import { workspaceErrorResponse } from "../../../../server/http/workspace-response";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  try {
    assertPrototypeAccess(request);
    const { assetId } = await params;
    uuidSchema.parse(assetId);
    const environment = getServerEnv();
    const asset = await getSourceAsset(
      environment.APP_DEFAULT_WORKSPACE_ID,
      assetId,
    );
    if (!asset) {
      return Response.json(
        { error: "이미지를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const blob = await downloadBusinessCardAsset(asset.path);
    return new Response(blob, {
      headers: {
        "Content-Type": asset.mimeType,
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
