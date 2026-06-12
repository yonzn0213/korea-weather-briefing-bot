import type { Env, TgUpdate } from "./types";
import { handleMessage, handleCallback } from "./register";
import { runBriefing } from "./briefing";

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
    const res = await runBriefing(env, new Date(event.scheduledTime));
    console.log(`브리핑 완료: 전송 ${res.sent} / 실패 ${res.failed} / 건너뜀 ${res.skipped}`);
  },
};
