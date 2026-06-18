import type { Env, TgUpdate } from "./types";
import { handleMessage, handleCallback } from "./register";
import { runBriefing, toKst } from "./briefing";
import { runRainAlerts } from "./rainalert";
import { sendMessage } from "./telegram";

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

  // 매시간 cron 하나가: (1) 그 시각(KST)을 브리핑 시각으로 고른 유저에게 아침 브리핑,
  // (2) 옵트인 유저에게 실시간 비 알람을 처리한다. 시각별 분산으로 cron 추가 없이 수용 인원을 늘린다.
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const now = new Date(event.scheduledTime);
    const hour = toKst(now).getUTCHours();

    const b = await runBriefing(env, now, hour);
    console.log(`${hour}시 브리핑: 전송 ${b.sent} / 실패 ${b.failed} / 건너뜀 ${b.skipped} / 대상 ${b.total}`);
    const bProblems: string[] = [];
    if (b.total > 0 && b.sent === 0) bProblems.push(`전송 0건(대상 ${b.total}건)`);
    if (b.failed > 0) bProblems.push(`발송 실패 ${b.failed}건`);
    if (b.skipped > 0) bProblems.push(`예산 초과로 ${b.skipped}건 누락`);
    await notifyDegraded(env, `${hour}시 브리핑`, bProblems);

    const r = await runRainAlerts(env, now);
    console.log(`비 알람: 전송 ${r.sent} / 점검 ${r.checked} / 건너뜀 ${r.skipped} / 실패 ${r.failed}`);
    if (r.failed > 0) await notifyDegraded(env, "비 알람", [`조회/발송 실패 ${r.failed}건`]); // 비 0건은 정상
  },
};
