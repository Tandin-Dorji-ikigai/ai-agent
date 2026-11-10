import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, accessToken, sameText } from "@/lib/access";

// The demo password gate (see src/lib/access.ts). Only active when
// DEMO_PASSWORD is set, as on a hosted test deployment.
export async function proxy(request: NextRequest) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname === "/access" || pathname === "/api/access") return NextResponse.next();

  const cookie = request.cookies.get(ACCESS_COOKIE)?.value ?? "";
  if (cookie && sameText(cookie, await accessToken(password))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, code: "ACCESS_REQUIRED", message: "Enter the demo password first." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/access";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next.js build files and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
