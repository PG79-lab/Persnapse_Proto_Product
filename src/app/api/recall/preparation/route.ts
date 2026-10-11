import {
  inspectSearchPreparation,
  prepareSearch,
} from "../../../../server/application/search-preparation-service";
import { getServerEnv } from "../../../../server/env";
import {
  assertPrototypeAccess,
  PrototypeAccessError,
} from "../../../../server/security/prototype-access";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

function unavailable(error: unknown): Response {
  if (error instanceof PrototypeAccessError)
    return Response.json({ error: "Not Found" }, { status: 404, headers });
  return Response.json(
    {
      error:
        "저장소 연결 또는 검색 준비에 실패했습니다. 저장된 기억은 유지됩니다. 연결을 확인한 뒤 다시 시도해 주세요.",
      code: "SEARCH_PREPARATION_UNAVAILABLE",
    },
    { status: 503, headers },
  );
}

export async function GET(request: Request) {
  try {
    assertPrototypeAccess(request);
    return Response.json(
      await inspectSearchPreparation(getServerEnv().APP_DEFAULT_WORKSPACE_ID),
      { headers },
    );
  } catch (error) {
    return unavailable(error);
  }
}

export async function POST(request: Request) {
  try {
    assertPrototypeAccess(request);
    // No client-supplied person/workspace identifiers: repair only this workspace.
    return Response.json(
      await prepareSearch(getServerEnv().APP_DEFAULT_WORKSPACE_ID),
      { headers },
    );
  } catch (error) {
    return unavailable(error);
  }
}
