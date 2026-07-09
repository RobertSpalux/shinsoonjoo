import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

/** 자산 진단 퀴즈 리드 수집 — lead_consultings 저장 + 텔레그램 즉시 알림 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, quiz_responses, quiz_score, lead_source, privacy_agreed } = body;

    if (!name?.trim() || !phone?.trim() || !privacy_agreed) {
      return NextResponse.json({ error: "필수 항목을 입력해 주세요." }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { error: dbError } = await supabase.from("lead_consultings").insert({
      name: name.trim(),
      phone: phone.trim(),
      quiz_responses: quiz_responses ?? null,
      quiz_score: typeof quiz_score === "number" ? quiz_score : null,
      lead_source: lead_source ?? "direct",
      privacy_agreed: true,
    });

    if (dbError) {
      console.error("lead_consultings insert error:", dbError);
      return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 500 });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      const r = quiz_responses ?? {};
      const text = [
        "🎯 자산 방어력 진단 리드 접수",
        "",
        `👤 ${name.trim()} / 📞 ${phone.trim()}`,
        `📊 방어력 점수: ${quiz_score ?? "-"}점`,
        `💰 월 보험료: ${r.premium ?? "-"}`,
        `🛡 보유 보장: ${Array.isArray(r.coverages) ? r.coverages.join(", ") : "-"}`,
        `⚠️ 최대 관심 리스크: ${r.risk ?? "-"}`,
        `👥 연령/가족: ${r.profile ?? "-"}`,
        `📍 유입: ${lead_source ?? "direct"}`,
        "",
        `🕐 ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
      ].join("\n");

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ chat_id: chatId, text }),
      }).catch((err) => console.error("Telegram send error:", err));
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Diagnosis API error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
