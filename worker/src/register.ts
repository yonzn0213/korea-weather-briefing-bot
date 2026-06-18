import type { Env, TgMessage, TgCallback, User, InlineKeyboard, InlineButton } from "./types";
import { MAX_REGIONS, DEFAULT_BRIEF_HOUR } from "./types";
import { sidoKeyboard, sigunguKeyboard, resolveRegion } from "./regions";
import { getUser, putUser, deleteUser, listUsers } from "./store";
import { sendMessage, answerCallback, editMessageText } from "./telegram";

// 아침 브리핑 선택 가능 시각(KST)과 시각당 정원(메시지 수 기준).
// 시각을 분산하면 매 cron 실행이 subrequest 50 한도 안에 들어와 무료로 수용 인원이 늘어난다.
export const BRIEF_HOURS = [5, 6, 7, 8, 9, 10];
export const BRIEF_SLOT_CAP = 35; // 비 알람과 예산을 나눠 쓰므로 50보다 보수적으로

const WELCOME =
  "👋 안녕하세요! <b>전국 아침 브리핑 봇</b>이에요.\n" +
  "매일 아침 원하는 시각에 비 소식·기온·미세먼지를 알려드립니다.\n\n" +
  "먼저 시/도를 선택해주세요 👇 (지역 → 받는 시각 순으로 고르면 끝!)";

function regionsLabel(user: User): string {
  return user.regions.map((r) => `${r.sido} ${r.sigungu}`).join(" · ");
}

function briefHourOf(user: User): number {
  return user.briefHour ?? DEFAULT_BRIEF_HOUR;
}

// 시각별 현재 인원(메시지 수 = 지역 수 합). 메뉴 열 때 1회 스캔해 근사 표시·정원 판단에 쓴다.
// KV에 정확한 카운터를 두지 않는 "느슨한" 방식 — 초과분은 발송 시 subrequest 가드가 흡수.
export async function countByHour(env: Env): Promise<Record<number, number>> {
  const counts: Record<number, number> = {};
  for (const { user } of await listUsers(env)) {
    const h = briefHourOf(user);
    counts[h] = (counts[h] ?? 0) + user.regions.length;
  }
  return counts;
}

function chunk(buttons: InlineButton[], cols = 3): InlineButton[][] {
  const out: InlineButton[][] = [];
  for (let i = 0; i < buttons.length; i += cols) out.push(buttons.slice(i, i + cols));
  return out;
}

function timeKeyboard(counts: Record<number, number>): InlineKeyboard {
  const buttons = BRIEF_HOURS.map((h) => {
    const c = counts[h] ?? 0;
    const full = c >= BRIEF_SLOT_CAP;
    return { text: full ? `${h}시 · 만석` : `${h}시 · ${c}`, callback_data: `bh:${h}` };
  });
  const kb = chunk(buttons);
  kb.push([{ text: "⬅ 뒤로", callback_data: "m" }]);
  return { inline_keyboard: kb };
}

// 설정 메뉴: 등록 지역 목록 + 지역 추가/변경/삭제 + 비 알람 토글
function settingsMenu(user: User): { text: string; keyboard: InlineKeyboard } {
  const lines = ["⚙️ <b>설정</b>", ""];
  user.regions.forEach((r, i) => lines.push(`${i + 1}. ${r.sido} ${r.sigungu}`));
  lines.push("");
  lines.push(`⏰ 받는 시각: <b>${briefHourOf(user)}시</b>`);
  lines.push(`🔔 실시간 비 알람: <b>${user.rainAlert ? "켜짐" : "꺼짐"}</b>`);
  lines.push("");
  lines.push("바꿀 항목을 선택해주세요 👇");

  const rows: InlineKeyboard["inline_keyboard"] = [];
  user.regions.forEach((r, i) => {
    const row = [{ text: `✏️ ${i + 1}. ${r.sigungu} 변경`, callback_data: `pick:${i}` }];
    if (user.regions.length > 1) row.push({ text: "🗑 삭제", callback_data: `del:${i}` });
    rows.push(row);
  });
  if (user.regions.length < MAX_REGIONS) {
    rows.push([{ text: "➕ 지역 추가", callback_data: `pick:${user.regions.length}` }]);
  }
  rows.push([{ text: "⏰ 받는 시각 변경", callback_data: "bh" }]);
  rows.push([{ text: `🔔 비 알람 ${user.rainAlert ? "끄기" : "켜기"}`, callback_data: "ra" }]);
  return { text: lines.join("\n"), keyboard: { inline_keyboard: rows } };
}

export async function handleMessage(env: Env, msg: TgMessage): Promise<void> {
  if (msg.chat?.id === undefined) return; // 비정상 업데이트 방어
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

  if (text === "/rainalert") {
    if (user === null) {
      await sendMessage(token, chatId, "먼저 /start 로 지역을 등록해주세요.");
      return;
    }
    const next = !user.rainAlert;
    await putUser(env, chatId, { ...user, rainAlert: next });
    await sendMessage(token, chatId, next
      ? "🔔 실시간 비 알람을 <b>켰어요</b>. 비가 다가오면 미리 알려드릴게요!"
      : "🔕 실시간 비 알람을 <b>껐어요</b>.");
    return;
  }

  if (user === null) {
    await sendMessage(token, chatId, WELCOME, { reply_markup: sidoKeyboard(0) });
    return;
  }

  if (text === "/start" || text === "/region") {
    const menu = settingsMenu(user);
    await sendMessage(token, chatId, menu.text, { reply_markup: menu.keyboard });
    return;
  }

  // 등록 유저의 일반 메시지 → 현황 안내
  await sendMessage(token, chatId,
    `✅ 매일 아침 ${briefHourOf(user)}시에 <b>${regionsLabel(user)}</b> 브리핑을 보내드리고 있어요.\n\n` +
    "/region — 지역/설정 변경\n/rainalert — 실시간 비 알람 켜기·끄기\n/stop — 알림 해지");
}

export async function handleCallback(env: Env, cq: TgCallback): Promise<void> {
  if (cq.message?.chat?.id === undefined) return; // 비정상 업데이트 방어
  const token = env.TELEGRAM_BOT_TOKEN;
  const data = cq.data || "";
  const chatId = String(cq.message.chat.id);
  const messageId = cq.message.message_id;

  // 설정 메뉴로 돌아가기
  if (data === "m") {
    const user = await getUser(env, chatId);
    await answerCallback(token, cq.id);
    if (user) {
      const menu = settingsMenu(user);
      await editMessageText(token, chatId, messageId, menu.text, { reply_markup: menu.keyboard });
    }
    return;
  }

  // 비 알람 토글
  if (data === "ra") {
    const user = await getUser(env, chatId);
    if (!user) { await answerCallback(token, cq.id, "먼저 /start 를 보내주세요."); return; }
    const next = !user.rainAlert;
    const updated = { ...user, rainAlert: next };
    await putUser(env, chatId, updated);
    await answerCallback(token, cq.id, next ? "비 알람 켜짐 🔔" : "비 알람 꺼짐 🔕");
    const menu = settingsMenu(updated);
    await editMessageText(token, chatId, messageId, menu.text, { reply_markup: menu.keyboard });
    return;
  }

  // 받는 시각 변경: 시각 선택 키보드(현재 인원 표시)
  if (data === "bh") {
    const user = await getUser(env, chatId);
    if (!user) { await answerCallback(token, cq.id, "먼저 /start 를 보내주세요."); return; }
    const counts = await countByHour(env);
    await answerCallback(token, cq.id);
    await editMessageText(token, chatId, messageId,
      `⏰ 브리핑 받을 시각을 골라주세요\n(숫자 = 현재 인원, 시각당 정원 ${BRIEF_SLOT_CAP})`,
      { reply_markup: timeKeyboard(counts) });
    return;
  }

  // 시각 확정. 형식: bh:{hour}. 정원 초과면 거부(락 없는 느슨한 체크).
  if (data.startsWith("bh:")) {
    const hour = Number(data.slice(3));
    const user = await getUser(env, chatId);
    if (!user) { await answerCallback(token, cq.id, "먼저 /start 를 보내주세요."); return; }
    if (!BRIEF_HOURS.includes(hour)) { await answerCallback(token, cq.id, "고를 수 없는 시각이에요."); return; }

    const counts = await countByHour(env);
    const already = briefHourOf(user) === hour;
    if (!already && (counts[hour] ?? 0) + user.regions.length > BRIEF_SLOT_CAP) {
      await answerCallback(token, cq.id, `${hour}시는 정원이 찼어요. 다른 시각을 골라주세요.`);
      await editMessageText(token, chatId, messageId,
        `⏰ 다른 시각을 골라주세요 (시각당 정원 ${BRIEF_SLOT_CAP})`,
        { reply_markup: timeKeyboard(counts) });
      return;
    }

    const updated = { ...user, briefHour: hour };
    await putUser(env, chatId, updated);
    await answerCallback(token, cq.id, `${hour}시로 설정 완료!`);
    const menu = settingsMenu(updated);
    await editMessageText(token, chatId, messageId, menu.text, { reply_markup: menu.keyboard });
    return;
  }

  // 지역 추가/변경: 해당 slot의 시/도 선택으로 진입
  if (data.startsWith("pick:")) {
    const slot = Number(data.slice(5));
    await answerCallback(token, cq.id);
    await editMessageText(token, chatId, messageId, "시/도를 선택해주세요 👇", { reply_markup: sidoKeyboard(slot) });
    return;
  }

  // 지역 삭제
  if (data.startsWith("del:")) {
    const slot = Number(data.slice(4));
    const user = await getUser(env, chatId);
    if (!user || user.regions.length <= 1 || !user.regions[slot]) {
      await answerCallback(token, cq.id, "삭제할 수 없어요.");
      return;
    }
    const removed = user.regions[slot].sigungu;
    const updated = { ...user, regions: user.regions.filter((_, i) => i !== slot) };
    await putUser(env, chatId, updated);
    await answerCallback(token, cq.id, `${removed} 삭제됨`);
    const menu = settingsMenu(updated);
    await editMessageText(token, chatId, messageId, menu.text, { reply_markup: menu.keyboard });
    return;
  }

  // 뒤로(시군구 → 시/도 목록)
  if (data.startsWith("b:")) {
    const slot = Number(data.slice(2));
    await answerCallback(token, cq.id);
    await editMessageText(token, chatId, messageId, "시/도를 선택해주세요 👇", { reply_markup: sidoKeyboard(slot) });
    return;
  }

  // 시/도 선택 → 시군구 키보드. 형식: s:{slot}:{sidoIdx}
  if (data.startsWith("s:")) {
    const parts = data.split(":");
    const slot = Number(parts[1]);
    let kb;
    try {
      kb = sigunguKeyboard(slot, Number(parts[2]));
    } catch {
      await answerCallback(token, cq.id, "다시 시도해주세요.");
      return;
    }
    await answerCallback(token, cq.id);
    await editMessageText(token, chatId, messageId, "세부 지역(시/군/구)을 선택해주세요 👇", { reply_markup: kb });
    return;
  }

  // 시군구 확정 → 저장. 형식: r:{slot}:{sidoIdx}:{sigunguIdx}
  if (data.startsWith("r:")) {
    const parts = data.split(":");
    const slot = Number(parts[1]);
    let sido: string, sigungu: string;
    try {
      [sido, sigungu] = resolveRegion(Number(parts[2]), Number(parts[3]));
    } catch {
      await answerCallback(token, cq.id, "알 수 없는 지역이에요.");
      return;
    }

    const existing = await getUser(env, chatId);
    const isNew = existing === null;
    const regions = existing ? [...existing.regions] : [];
    if (slot < regions.length) regions[slot] = { sido, sigungu };       // 변경
    else if (regions.length < MAX_REGIONS) regions.push({ sido, sigungu }); // 추가
    else regions[MAX_REGIONS - 1] = { sido, sigungu };                  // 한도 초과 방어

    const updated: User = {
      regions,
      name: existing?.name || cq.from?.first_name || "",
      rainAlert: existing?.rainAlert ?? false,
      briefHour: existing?.briefHour ?? DEFAULT_BRIEF_HOUR,
      ...(existing?.rainSeen ? { rainSeen: existing.rainSeen } : {}),
    };
    await putUser(env, chatId, updated);
    await answerCallback(token, cq.id, `${sigungu} 설정 완료!`);
    await editMessageText(token, chatId, messageId, `📍 <b>${sido} ${sigungu}</b>로 설정했어요!`);

    if (isNew) {
      // 신규 가입: 지역 등록 직후 받는 시각까지 고르도록 이어붙인다(안 고르면 기본 7시).
      const counts = await countByHour(env);
      await sendMessage(token, chatId,
        `✅ <b>${sigungu}</b> 등록 완료!\n` +
        "⏰ 마지막으로 브리핑 받을 시각을 골라주세요.\n(고르지 않으면 기본 7시, 나중에 /region 에서 변경할 수 있어요)",
        { reply_markup: timeKeyboard(counts) });
    } else {
      const menu = settingsMenu(updated);
      await sendMessage(token, chatId, menu.text, { reply_markup: menu.keyboard });
    }
    return;
  }

  await answerCallback(token, cq.id);
}
