import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow access to login page and API routes for login/logout
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/api/logout") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    // PWA: ໄຟລ໌ເຫຼົ່ານີ້ browser ດຶງເອງໂດຍບໍ່ມີ session (ຕອນຕິດຕັ້ງ, ຕອນອັບເດດ SW).
    // ຖ້າຖືກ redirect ໄປ /login ຈະໄດ້ HTML ແທນ JavaScript ແລ້ວ SW ຈະລົງທະບຽນບໍ່ໄດ້.
    pathname === "/sw.js" ||
    pathname === "/manifest.json" ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/public/")
  ) {
    return NextResponse.next();
  }

  // Check for session cookie
  const sessionCookie = request.cookies.get("wms_session");
  if (!sessionCookie) {
    // Redirect to login
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}