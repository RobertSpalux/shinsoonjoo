import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, category, message, privacy_agreed } = body;

    if (!name?.trim() || !phone?.trim() || !category || !privacy_agreed) {
      return NextResponse.json(
        { error: "필수 항목을 입력해 주세요." },
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
      privacy_agreed,
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

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
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
