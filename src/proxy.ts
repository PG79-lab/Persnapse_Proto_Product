import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isPrototypeRequestAllowed } from "./server/security/prototype-access-policy";

export function proxy(request: NextRequest): NextResponse {
  if (isPrototypeRequestAllowed(request)) {
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
