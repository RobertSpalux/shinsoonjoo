import { createHash } from "crypto";
import { cookies } from "next/headers";

/**
 * 초경량 관리자 인증 — 1인 운영자용.
 * ADMIN_PASSWORD 환경변수와 대조하고, 세션은 비밀번호 해시를 httpOnly 쿠키로 보관.
 */

export function passwordHash() {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return createHash("sha256").update(`shin-admin:${pw}`).digest("hex");
}

export async function isAdminAuthed(): Promise<boolean> {
  const hash = passwordHash();
  if (!hash) return false;
  const store = await cookies();
  return store.get("shin_admin")?.value === hash;
}
