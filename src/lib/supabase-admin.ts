import { createClient } from "@supabase/supabase-js";

/**
 * 서버 전용 Supabase 클라이언트 (service_role).
 * RLS를 우회하므로 절대 클라이언트 컴포넌트에서 import 금지.
 * 콘텐츠 팩토리 적재, 발행 상태 변경, 리드 조회에 사용.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Supabase 서버 환경변수(SUPABASE_SERVICE_ROLE_KEY)가 없습니다.");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}
