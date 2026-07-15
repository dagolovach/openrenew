// proxy.ts
import { type NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Duplicated from lib/auth/session.ts — importing it would pull @/lib/db into the edge runtime
const SESSION_COOKIE = "openrenew_session";
const PUBLIC_PATHS = ["/login", "/setup"];

async function verifiedUserId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.AUTH_DISABLED === "true") {
    if (pathname === "/") return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
  }

  const userId = await verifiedUserId(request);

  if (pathname === "/") {
    return NextResponse.redirect(new URL(userId ? "/dashboard" : "/login", request.url));
  }
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    if (userId) return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
  }
  if (!userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
