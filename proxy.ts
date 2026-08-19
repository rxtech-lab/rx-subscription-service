import { proxy as authProxy } from "@/lib/auth";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAuthorizedE2EHeaders } from "@/lib/e2e/request";

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (isAuthorizedE2EHeaders(request.headers)) return NextResponse.next();
  return authProxy(request, event);
}

/**
 * `test` and the machine endpoints are excluded: the storefront authenticates
 * with its own signed test-session cookie, `api/v1` and `api/e2e` with an
 * application API key, and `api/stripe` with a webhook signature. Routing any of
 * them through the console's interactive login would only break them.
 */
export const config = {
  matcher: [
    "/((?!api/auth|api/v1|api/e2e|api/stripe|test|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
