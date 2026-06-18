import type { Env, TgUpdate } from "./types";
import { handleMessage, handleCallback } from "./register";
import { runBriefing } from "./briefing";
import { runRainAlerts } from "./rainalert";
import { sendMessage } from "./telegram";

const MORNING_CRON = "0 22 * * *"; // KST 07:00 일일 브리핑 (그 외 cron은 실시간 비 알람)

// dead-man switch: cron 이상 징후를 운영자(ADMIN_CHAT_ID)에게 1건 경보.
// 키 만료·기상청 장애·발송 실패를 사용자 항의가 아니라 즉시 알기 위함.
async function notifyDegraded(env: Env, label: string, problems: string[]): Promise<void> {
  if (!env.ADMIN_CHAT_ID || problems.length === 0) return;
  try {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID, `⚠️ [날씨봇] ${label} 점검 필요 — ${problems.join(", ")}`);
  } catch (e) {
    console.error("운영 경보 발송 실패:", e instanceof Error ? e.message : e);
  }
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (req.method !== "POST") return new Response("ok");
    if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    let update: TgUpdate;
    try {
      update = (await req.json()) as TgUpdate;
    } catch {
      return new Response("ok");
    }
    try {
      if (update.message) await handleMessage(env, update.message);
      else if (update.callback_query) await handleCallback(env, update.callback_query);
    } catch (e) {
      console.error("webhook 처리 실패:", e instanceof Error ? e.message : e);
    }
    return new Response("ok"); // 텔레그램 재시도 폭주 방지 — 항상 200
  },

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const now = new Date(event.scheduledTime);
    if (event.cron === MORNING_CRON) {
      const res = await runBriefing(env, now);
      console.log(`브리핑 완료: 전송 ${res.sent} / 실패 ${res.failed} / 건너뜀 ${res.skipped} / 대상 ${res.total}`);
      const problems: string[] = [];
      if (res.total > 0 && res.sent === 0) problems.push(`전송 0건(대상 ${res.total}명)`);
      if (res.failed > 0) problems.push(`발송 실패 ${res.failed}건`);
      if (res.skipped > 0) problems.push(`예산 초과로 ${res.skipped}건 누락`);
      await notifyDegraded(env, "아침 브리핑", problems);
    } else {
      const res = await runRainAlerts(env, now);
      console.log(`비 알람 완료: 전송 ${res.sent} / 점검 ${res.checked} / 건너뜀 ${res.skipped} / 실패 ${res.failed}`);
      const problems: string[] = [];
      if (res.failed > 0) problems.push(`조회/발송 실패 ${res.failed}건`); // 비 0건은 정상이라 실패만 경보
      await notifyDegraded(env, "비 알람", problems);
    }
  },
};
