import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      name,
      phone,
      category,
      message,
      privacy_collect_agreed,
      privacy_thirdparty_agreed,
    } = body;

    // 필수 동의 2종 모두 참이어야 접수 (심의 반려 5)
    if (
      !name?.trim() ||
      !phone?.trim() ||
      !category ||
      !privacy_collect_agreed ||
      !privacy_thirdparty_agreed
    ) {
      return NextResponse.json(
        { error: "필수 항목과 개인정보 동의 2종을 확인해 주세요." },
        { status: 400 }
      );
    }

    // 비UTF-8 인코딩 방어(버그픽스) — 요청 본문이 UTF-8이 아니면(예: Windows 셸 CP949)
    // request.json()이 한글을 U+FFFD(�)로 디코딩한다. 그대로 두면 깨진 이름·내용이
    // DB와 텔레그램 리드 알림까지 흘러간다(���� 증상). 유입 시점에 차단한다.
    if ([name, phone, category, message].some((v) => typeof v === "string" && v.includes("�"))) {
      return NextResponse.json(
        { error: "문자 인코딩이 올바르지 않습니다. UTF-8로 다시 시도해 주세요." },
        { status: 400 }
      );
    }

    // Supabase 클라이언트 (서버 런타임에서 환경변수 직접 사용)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing Supabase env vars");
      return NextResponse.json(
        { error: "서버 설정 오류" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Supabase에 저장
    const { error: dbError } = await supabase.from("consultations").insert({
      name: name.trim(),
      phone: phone.trim(),
      category,
      message: message?.trim() || null,
      privacy_collect_agreed,
      privacy_thirdparty_agreed,
      // 기존 컬럼 호환 — 두 필수 동의가 모두 참일 때만 true
      privacy_agreed: privacy_collect_agreed && privacy_thirdparty_agreed,
    });

    if (dbError) {
      console.error("Supabase insert error:", dbError);
      return NextResponse.json(
        { error: "데이터 저장에 실패했습니다." },
        { status: 500 }
      );
    }

    // 2. 텔레그램 알림 발송
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (botToken && chatId) {
      const text = [
        "📋 새로운 상담 신청",
        "",
        `👤 이름: ${name.trim()}`,
        `📞 연락처: ${phone.trim()}`,
        `📂 분야: ${category}`,
        message?.trim() ? `💬 내용: ${message.trim()}` : "",
        "",
        `🕐 ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
      ]
        .filter(Boolean)
        .join("\n");

      // 크론 요약(collect-and-generate 등)과 동일한 전송 방식 — POST + JSON.stringify(UTF-8)
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      }).catch((err) => console.error("Telegram send error:", err));
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
