import { frontendGraphSnapshot } from "../../features/workspace/preview/fixture";

// Explicit opt-in in the local launch command. Never inferred from missing secrets.
export function graphPreviewEnabled() {
  return process.env.PERSNAPSE_GRAPH_PREVIEW === "1" && !process.env.VERCEL;
}

export function graphPreviewResponse(request: Request): Response {
  const path = new URL(request.url).pathname;
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Persnapse-Preview": "FG-FIXTURE-01",
  };
  if (request.method === "GET" && path === "/api/workspace") {
    return Response.json(frontendGraphSnapshot(), { headers });
  }
  if (request.method === "GET" && path === "/api/business-cards") {
    return Response.json([], { headers });
  }
  if (request.method === "GET" && path === "/api/recall/preparation") {
    return Response.json(
      {
        mode: "mock",
        ready: false,
        total: 0,
        prepared: 0,
        remaining: 0,
        retryable: 0,
        processing: 0,
      },
      { headers },
    );
  }
  return Response.json(
    {
      code: "PREVIEW_OPERATION_UNAVAILABLE",
      error:
        "이 합성 데이터 미리보기에서는 아직 이 작업을 지원하지 않습니다. 입력은 유지되며 실제 서버에는 저장하지 않았습니다.",
    },
    { status: 501, headers },
  );
}
