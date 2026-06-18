import type { Env } from "./types";
import { REGIONS } from "./regions";
import { listUsers, putUser } from "./store";
import { sendMessage } from "./telegram";
import { toKst, ymd } from "./briefing";

// 초단기예보(getUltraSrtFcst) 기반 실시간 비 알람.
// 매시간 cron에서 옵트인 유저의 등록 지역을 점검해 곧 비가 오면 미리 알린다.

const RAIN_MAX_SUBREQUESTS = 45; // 무료 50 한도 안전 마진
const WITHIN_HOURS = 2;          // 향후 몇 시간 내 강수를 알릴지
const COOLDOWN_HOURS = 3;        // 같은 비 이벤트 재알림 방지 간격
const QUIET_START = 7;           // 이 시각(포함)부터
const QUIET_END = 22;            // 이 시각(미만)까지만 알림 (KST). 새벽엔 침묵.

// 초단기예보 PTY 코드 → 한글 라벨
const PTY_RAIN_LABEL: Record<string, string> = {
  "1": "비", "2": "비/눈", "3": "눈", "5": "빗방울", "6": "진눈깨비", "7": "눈날림",
};

export interface UltraEntry { hour: number; pty: string; }
export interface RainHit { hour: number; label: string; }

// 초단기예보 base_date/base_time. 매시간 30분 발표, 약 45분에 제공.
// 45분 전이면 직전 시각 발표분을 사용한다.
export function ultraBase(kst: Date): [string, string] {
  let baseTime = kst;
  if (kst.getUTCMinutes() < 45) baseTime = new Date(kst.getTime() - 3600 * 1000);
  const h = String(baseTime.getUTCHours()).padStart(2, "0");
  return [ymd(baseTime), `${h}30`];
}

export function parseUltraItems(items: any[], today: string): UltraEntry[] {
  const out: UltraEntry[] = [];
  for (const it of items) {
    if (it.category !== "PTY" || it.fcstDate !== today) continue;
    out.push({ hour: parseInt(String(it.fcstTime).slice(0, 2), 10), pty: String(it.fcstValue) });
  }
  return out;
}

// 지금(nowHour)부터 within시간 내 가장 이른 강수를 찾는다. 없으면 null.
export function nextRain(entries: UltraEntry[], nowHour: number, within = WITHIN_HOURS): RainHit | null {
  const cand = entries
    .filter((e) => e.pty !== "0" && e.hour >= nowHour && e.hour <= nowHour + within)
    .sort((a, b) => a.hour - b.hour);
  if (cand.length === 0) return null;
  return { hour: cand[0].hour, label: PTY_RAIN_LABEL[cand[0].pty] || "비" };
}

export function rainAlertMessage(sigungu: string, rain: RainHit, nowHour: number): string {
  const when = rain.hour <= nowHour ? "곧" : `${rain.hour}시경`;
  return `☔ <b>${sigungu}</b> ${rain.label} 소식!\n${when} ${rain.label}가 예상돼요. 우산 챙기세요! ☂️`;
}

export async function fetchUltraShort(key: string, nx: number, ny: number, now: Date): Promise<UltraEntry[]> {
  const kst = toKst(now);
  const [baseDate, baseTime] = ultraBase(kst);
  const today = ymd(kst);
  const url = new URL("https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst");
  url.search = new URLSearchParams({
    serviceKey: key, numOfRows: "300", pageNo: "1", dataType: "JSON",
    base_date: baseDate, base_time: baseTime, nx: String(nx), ny: String(ny),
  }).toString();
  const r = await fetch(url.toString());
  const j = (await r.json()) as any;
  const items = (j.response.body.items.item as any[]) ?? [];
  return parseUltraItems(items, today);
}

// "YYYYMMDDHH"
function rainKey(kst: Date): string {
  return ymd(kst) + String(kst.getUTCHours()).padStart(2, "0");
}
function keyToHours(k: string): number {
  return Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), +k.slice(8, 10)) / 3600000;
}
function hoursSince(prev: string, now: string): number {
  return keyToHours(now) - keyToHours(prev);
}

export async function runRainAlerts(env: Env, now: Date): Promise<{ sent: number; checked: number; skipped: number }> {
  const kst = toKst(now);
  const hour = kst.getUTCHours();
  if (hour < QUIET_START || hour >= QUIET_END) {
    return { sent: 0, checked: 0, skipped: 0 }; // 새벽 시간대는 알림 침묵
  }

  const optedIn = (await listUsers(env)).filter(({ user }) => user.rainAlert);
  const ultraCache = new Map<string, UltraEntry[] | null>();
  const nowKey = rainKey(kst);
  let subreq = 0, sent = 0, checked = 0, skipped = 0;

  for (const { chatId, user } of optedIn) {
    const seen = { ...(user.rainSeen ?? {}) };
    let changed = false;

    for (const r of user.regions) {
      const grid = REGIONS[r.sido]?.sigungu[r.sigungu];
      if (!grid) continue;
      const gridKey = `${grid.nx},${grid.ny}`;

      const need = (ultraCache.has(gridKey) ? 0 : 1) + 1; // 예보 조회(캐시 미스 시) + 발송
      if (subreq + need > RAIN_MAX_SUBREQUESTS) { skipped++; continue; }

      if (!ultraCache.has(gridKey)) {
        try { ultraCache.set(gridKey, await fetchUltraShort(env.DATA_GO_KR_KEY, grid.nx, grid.ny, now)); subreq++; }
        catch (e) { console.error(`[ultra ${r.sigungu}]`, e instanceof Error ? e.message : e); ultraCache.set(gridKey, null); subreq++; }
      }
      const entries = ultraCache.get(gridKey);
      checked++;
      if (!entries) continue;

      const rain = nextRain(entries, hour);
      if (!rain) continue;

      const last = seen[gridKey];
      if (last && hoursSince(last, nowKey) < COOLDOWN_HOURS) continue; // 같은 비 도배 방지

      try {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, rainAlertMessage(r.sigungu, rain, hour));
        subreq++; sent++;
        seen[gridKey] = nowKey; changed = true;
      } catch (e) {
        console.error(`[rain-send ${chatId}]`, e instanceof Error ? e.message : e); subreq++;
      }
    }

    if (changed) {
      try { await putUser(env, chatId, { ...user, rainSeen: seen }); }
      catch (e) { console.error(`[rain-state ${chatId}]`, e instanceof Error ? e.message : e); }
    }
  }

  return { sent, checked, skipped };
}
