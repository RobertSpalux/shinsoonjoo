import { NextResponse } from "next/server";
import { BRAND } from "@/lib/brand";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * 카카오톡 채널로 가는 클릭을 세는 리다이렉트 (LK1, 2026-11-10).
 * 네이버 글 안의 상담 안내(scripts/consult_line.py)가 `https://goodfinance.kr/go/kakao?ref=<slug>` 로 건다 —
 * 네이버 → pf.kakao.com 직행 링크는 우리 쪽에서 클릭을 잴 방법이 없었다.
 * 본진 글 안의 카카오 링크는 GA kakao_click(AnalyticsClient 위임)으로 이미 잰다 — 여기를 거치지 않는다.
 *
 * - 화면 문구 없음(텍스트 노드 0) → 사이트 골격 원안 변경 아님(§6.11-9). 목적지는 PAMS 사전등록된 카카오 채널.
 * - 기록 실패는 이동을 막지 않는다(저장 오류여도 고객은 채팅으로 간다).
 * - 개인정보 없음: slug·유입 출처·리퍼러 호스트·봇 여부만. IP·UA 원문을 저장하지 않는다.
 * - 테이블: sql/011_link_clicks.sql (적용 전이면 insert 가 실패하고 이동만 한다).
 */
export const dynamic = "force-dynamic";

const BOT = /bot|crawl|spider|slurp|yeti|daum|preview|facebookexternalhit|headless|scrap/i;

function hostOf(v: string | null): string | null {
  try {
    return v ? new URL(v).host.slice(0, 80) : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ref = url.searchParams.get("ref") ?? "";
  const src = url.searchParams.get("src") ?? "naver";
  try {
    const { error } = await createAdminClient().from("link_clicks").insert({
      target: "kakao",
      ref: /^[a-z0-9-]{1,120}$/.test(ref) ? ref : null,
      src: /^[a-z_]{1,30}$/.test(src) ? src : null,
      referer_host: hostOf(request.headers.get("referer")),
      is_bot: BOT.test(request.headers.get("user-agent") ?? ""),
    });
    if (error) console.error("link_clicks insert:", error.message);
  } catch (e) {
    console.error("link_clicks:", e);
  }
  return NextResponse.redirect(BRAND.social.kakaoChat, 302);
}
