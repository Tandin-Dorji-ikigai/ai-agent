import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, OLD_SIGN_IN_PATHS, ROLE_LABEL, SIGN_IN_PATH, gateOn, mayOpen, roleFromCookie, rolePasswords } from "@/lib/access";

// Role sign-in (see src/lib/access.ts). Only active when a role password is
// set, as on a hosted test deployment. Pages send people to the one sign-in
// page (/login); API calls answer 401 (not signed in) or 403 (signed in as
// another role).
export async function proxy(request: NextRequest) {
  // Earlier sign-in addresses forward to /login (with sign-in on or off).
  if ((OLD_SIGN_IN_PATHS as readonly string[]).includes(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = SIGN_IN_PATH;
    return NextResponse.redirect(url);
  }
  const passwords = rolePasswords();
  if (!gateOn(passwords)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const role = await roleFromCookie(request.cookies.get(ACCESS_COOKIE)?.value, passwords);
  if (mayOpen(role, pathname)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return role
      ? NextResponse.json({ ok: false, code: "WRONG_ROLE", message: `You are signed in as ${ROLE_LABEL[role]}, who cannot do this.` }, { status: 403 })
      : NextResponse.json({ ok: false, code: "ACCESS_REQUIRED", message: "Sign in first." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = SIGN_IN_PATH;
  const params = new URLSearchParams({ next: pathname + search });
  if (role) params.set("signed_in_as", role); // the sign-in page explains why they are there
  url.search = `?${params}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next.js build files, the favicon and the public images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|[^/]+\\.svg$).*)"],
};
