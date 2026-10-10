import { isFunnelNotifyLive } from "./lead";

export type NotifyResult = { sent: boolean; dryRun: boolean; reason?: string };

/**
 * 퍼널 신청 알림 → Soonjoo_PB 대화방.
 * 기본 드라이런(FUNNEL_NOTIFY_LIVE≠1): 보내지 않고 콘솔에만 남긴다.
 * 대화방은 TELEGRAM_FUNNEL_CHAT_ID 가 있으면 그쪽, 없으면 기존 상담 알림방(TELEGRAM_CHAT_ID = Soonjoo_PB).
 * 실패해도 신청 저장은 이미 끝났으므로 예외를 던지지 않는다.
 */
export async function notifyFunnelLead(
  text: string,
  fetchImpl: typeof fetch = fetch
): Promise<NotifyResult> {
  if (!isFunnelNotifyLive()) {
    console.log("[funnel notify dry-run]\n" + text);
    return { sent: false, dryRun: true };
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_FUNNEL_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { sent: false, dryRun: false, reason: "telegram env 없음" };
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return res.ok ? { sent: true, dryRun: false } : { sent: false, dryRun: false, reason: `HTTP ${res.status}` };
  } catch (e) {
    console.error("funnel telegram error:", e);
    return { sent: false, dryRun: false, reason: "fetch 실패" };
  }
}
