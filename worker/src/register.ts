import type { Env, TgMessage, TgCallback } from "./types";
import { sidoKeyboard, sigunguKeyboard, resolveRegion } from "./regions";
import { getUser, putUser, deleteUser } from "./store";
import { sendMessage, answerCallback, editMessageText } from "./telegram";

const WELCOME =
  "👋 안녕하세요! <b>전국 아침 브리핑 봇</b>이에요.\n" +
  "매일 아침 7시, 선택하신 지역의 비 소식과 미세먼지를 알려드립니다.\n\n" +
  "먼저 시/도를 선택해주세요 👇";

function help(region: string): string {
  return (
    `✅ 매일 아침 7시에 <b>${region}</b> 브리핑을 보내드리고 있어요.\n\n` +
    "/region — 지역 변경\n/stop — 알림 해지"
  );
}

export async function handleMessage(env: Env, msg: TgMessage): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = String(msg.chat.id);
  const text = (msg.text || "").trim();

  if (text === "/stop") {
    const existed = await deleteUser(env, chatId);
    await sendMessage(token, chatId, existed
      ? "알림을 해지했어요. 다시 받고 싶으면 /start 를 보내주세요. 👋"
      : "등록된 알림이 없어요. /start 로 시작할 수 있어요.");
    return;
  }

  const user = await getUser(env, chatId);
  if (text === "/start" || text === "/region" || user === null) {
    await sendMessage(token, chatId,
      user === null ? WELCOME : "변경할 시/도를 선택해주세요 👇",
      { reply_markup: sidoKeyboard() });
    return;
  }

  await sendMessage(token, chatId, help(`${user.sido} ${user.sigungu}`));
}

export async function handleCallback(env: Env, cq: TgCallback): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const data = cq.data || "";
  const chatId = String(cq.message.chat.id);
  const messageId = cq.message.message_id;

  if (data === "s:back") {
    await answerCallback(token, cq.id);
    await editMessageText(token, chatId, messageId, "시/도를 선택해주세요 👇", { reply_markup: sidoKeyboard() });
    return;
  }

  if (data.startsWith("s:")) {
    const sidoIdx = Number(data.slice(2));
    let kb;
    try {
      kb = sigunguKeyboard(sidoIdx);
    } catch {
      await answerCallback(token, cq.id, "다시 시도해주세요.");
      return;
    }
    await answerCallback(token, cq.id);
    await editMessageText(token, chatId, messageId, "세부 지역(시/군/구)을 선택해주세요 👇", { reply_markup: kb });
    return;
  }

  if (data.startsWith("r:")) {
    const parts = data.split(":");
    let sido: string, sigungu: string;
    try {
      [sido, sigungu] = resolveRegion(Number(parts[1]), Number(parts[2]));
    } catch {
      await answerCallback(token, cq.id, "알 수 없는 지역이에요.");
      return;
    }
    const isNew = (await getUser(env, chatId)) === null;
    await putUser(env, chatId, { sido, sigungu, name: cq.from?.first_name || "" });
    await answerCallback(token, cq.id, `${sigungu} 설정 완료!`);
    await editMessageText(token, chatId, messageId, `📍 <b>${sido} ${sigungu}</b>로 설정했어요!`);
    await sendMessage(token, chatId, isNew
      ? `등록 완료! 내일 아침 7시부터 <b>${sigungu}</b> 브리핑을 보내드릴게요. 🌅\n지역 변경은 /region, 해지는 /stop`
      : `이제부터 <b>${sigungu}</b> 기준으로 알려드릴게요!`);
    return;
  }

  await answerCallback(token, cq.id);
}
