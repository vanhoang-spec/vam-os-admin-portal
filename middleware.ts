import { NextRequest, NextResponse } from "next/server";
import { ADMIN_UNLOCK_COOKIE, ADMIN_UNLOCK_SALT } from "@/lib/password-gate";

async function unlockToken(password: string) {
  const payload = new TextEncoder().encode(`${ADMIN_UNLOCK_SALT}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  const password = process.env.VAM_OS_ADMIN_PASSWORD;
  if (!password) {
    console.warn("VAM_OS_ADMIN_PASSWORD is not set. Temporary password gate is disabled.");
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  const expectedToken = await unlockToken(password);
  const currentToken = request.cookies.get(ADMIN_UNLOCK_COOKIE)?.value;

  if (currentToken === expectedToken) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!unlock|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"]
};

