import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isPrototypeRequestAllowed } from "./server/security/prototype-access-policy";
import {
  graphPreviewEnabled,
  graphPreviewResponse,
} from "./server/preview/frontend-graph";

export function proxy(request: NextRequest): Response {
  if (isPrototypeRequestAllowed(request)) {
    if (graphPreviewEnabled() && request.nextUrl.pathname.startsWith("/api/")) {
      // All API requests terminate here; unregistered routes cannot reach a provider or DB.
      return graphPreviewResponse(request);
    }
    return NextResponse.next();
  }

  return new NextResponse("Not Found", {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const config = {
  matcher: "/:path*",
};
