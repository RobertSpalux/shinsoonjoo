import { NextResponse } from "next/server";
import { passwordHash } from "@/lib/admin-auth";

export async function POST(request: Request) {
  const { password } = await request.json().catch(() => ({}));
  const pw = process.env.ADMIN_PASSWORD;
  const hash = passwordHash();

  if (!pw || !hash) {
    return NextResponse.json({ error: "ADMIN_PASSWORD가 설정되지 않았습니다." }, { status: 500 });
  }
  if (password !== pw) {
    return NextResponse.json({ error: "비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set("shin_admin", hash, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30일
    path: "/",
  });
  return res;
}
