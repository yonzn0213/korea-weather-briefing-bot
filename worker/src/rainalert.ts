import type { Env } from "./types";
import { REGIONS } from "./regions";
import { listUsers, putUser } from "./store";
import { sendMessage } from "./telegram";
import { toKst, ymd, fetchKmaItems, withRetry } from "./briefing";

// 초단기예보(getUltraSrtFcst) 기반 실시간 비 알람.
// 매시간 cron에서 옵트인 유저의 등록 지역을 점검해 곧 비가 오면 미리 알린다.

const RAIN_MAX_SUBREQUESTS = 45; // 무료 50 한도 안전 마진
const WITHIN_HOURS = 1;          // 향후 1시간 내 강수만 알림(오보·양치기소년 방지). 종일 계획은 아침 브리핑이 담당.
const QUIET_START = 6;           // 이 시각(포함)부터
const QUIET_END = 23;            // 이 시각(미만)까지만 발송 (KST). 즉 침묵 23~06시.

// 초단기예보 PTY 코드 → 강수 종류
const PTY_RAIN_LABEL: Record<string, string> = {
  "1": "비", "2": "비/눈", "3": "눈", "5": "빗방울", "6": "진눈깨비", "7": "눈날림",
};

// 시간당 강수량(mm) → 강도 형용사. 보통(3~15)은 형용사 없이 종류만 표기.
export function intensityWord(rn1: number | null): string {
  if (rn1 === null) return "";
  if (rn1 < 3) return "약한";
  if (rn1 < 15) return "";
  return "강한";
}

// RN1 값은 "강수없음" / "1.0mm" / "1mm 미만" / "0" 등 형태가 섞여 옴 → 관대하게 파싱.
export function parseRn1(val: string): number | null {
  if (val == null) return null;
  if (String(val).includes("없음")) return 0;
  const m = String(val).match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}

export interface UltraEntry { hour: number; pty: string; rn1: number | null; }
export interface RainSpan { start: number; end: number; label: string; intensity: string; }

// 초단기예보 base_date/base_time. 매시간 30분 발표, 약 45분에 제공.
// 45분 전이면 직전 시각 발표분을 사용한다.
export function ultraBase(kst: Date): [string, string] {
  let baseTime = kst;
  if (kst.getUTCMinutes() < 45) baseTime = new Date(kst.getTime() - 3600 * 1000);
  const h = String(baseTime.getUTCHours()).padStart(2, "0");
  return [ymd(baseTime), `${h}30`];
}

// PTY/RN1을 시간(HH)별로 합쳐 정렬된 배열로 반환.
export function parseUltraItems(items: any[], today: string): UltraEntry[] {
  const map = new Map<number, UltraEntry>();
  for (const it of items) {
    if (it.fcstDate !== today) continue;
    const h = parseInt(String(it.fcstTime).slice(0, 2), 10);
    let e = map.get(h);
    if (!e) { e = { hour: h, pty: "0", rn1: null }; map.set(h, e); }
    if (it.category === "PTY") e.pty = String(it.fcstValue);
    else if (it.category === "RN1") e.rn1 = parseRn1(String(it.fcstValue));
  }
  return [...map.values()].sort((a, b) => a.hour - b.hour);
}

// 지금(nowHour)부터 within시간 내 시작하는 비를 찾아, 연속 강수 구간(end)과 강도를 함께 반환.
export function detectRain(entries: UltraEntry[], nowHour: number, within = WITHIN_HOURS): RainSpan | null {
  const byHour = new Map<number, UltraEntry>();
  for (const e of entries) byHour.set(e.hour, e);

  let start = -1;
  for (let h = nowHour; h <= nowHour + within; h++) {
    const e = byHour.get(h);
    if (e && e.pty !== "0") { start = h; break; }
  }
  if (start === -1) return null;

  let end = start;
  let maxRn = byHour.get(start)?.rn1 ?? null;
  for (let h = start + 1; byHour.get(h) && byHour.get(h)!.pty !== "0"; h++) {
    end = h;
    const rn = byHour.get(h)!.rn1;
    if (rn !== null) maxRn = Math.max(maxRn ?? 0, rn);
  }

  const label = PTY_RAIN_LABEL[byHour.get(start)!.pty] || "비";
  return { start, end, label, intensity: intensityWord(maxRn) };
}

export function rainAlertMessage(sigungu: string, rain: RainSpan, nowHour: number): string {
  const from = rain.start <= nowHour ? "곧" : `${rain.start}시`;
  const when = rain.end > rain.start
    ? `${from}~${rain.end + 1}시`
    : (from === "곧" ? "곧" : `${rain.start}시경`);
  const kind = `${rain.intensity} ${rain.label}`.trim(); // "약한 비" / "비" / "강한 비" / "눈"
  return `☔ <b>${sigungu}</b> ${when} ${kind} 예상\n우산 챙기세요! ☂️`;
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
  // 일시 오류는 재시도로 흡수. NODATA(null)면 빈 배열 → 이번 회차 알림 없음(보수적).
  const items = await withRetry(() => fetchKmaItems(url.toString()), `ultra ${nx},${ny}`);
  return parseUltraItems(items ?? [], today);
}

// "YYYYMMDDHH"
function hourKey(day: string, hour: number): string {
  return day + String(hour).padStart(2, "0");
}
function keyToHours(k: string): number {
  return Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), +k.slice(8, 10)) / 3600000;
}

export async function runRainAlerts(env: Env, now: Date): Promise<{ sent: number; checked: number; skipped: number; failed: number }> {
  const kst = toKst(now);
  const hour = kst.getUTCHours();
  if (hour < QUIET_START || hour >= QUIET_END) {
    return { sent: 0, checked: 0, skipped: 0, failed: 0 }; // 침묵 시간대(23~06 KST)
  }

  const day = ymd(kst);
  const optedIn = (await listUsers(env)).filter(({ user }) => user.rainAlert);
  const ultraCache = new Map<string, UltraEntry[] | null>();
  let subreq = 0, sent = 0, checked = 0, skipped = 0, failed = 0;

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
        catch (e) { console.error(`[ultra ${r.sigungu}]`, e instanceof Error ? e.message : e); ultraCache.set(gridKey, null); subreq++; failed++; }
      }
      const entries = ultraCache.get(gridKey);
      checked++;
      if (!entries) continue;

      const rain = detectRain(entries, hour);
      if (!rain) continue;

      // 에피소드 단위 중복 방지: 이미 알린 비의 종료시각(저장값)보다 늦게 시작하는 비만 새로 알린다.
      // (같은 비가 이어지는 동안은 침묵, 마른 시간 뒤 다시 오는 새 비는 재알림)
      const last = seen[gridKey];
      if (last && keyToHours(hourKey(day, rain.start)) <= keyToHours(last)) continue;

      try {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, rainAlertMessage(r.sigungu, rain, hour));
        subreq++; sent++;
        seen[gridKey] = hourKey(day, rain.end); changed = true;
      } catch (e) {
        console.error(`[rain-send ${chatId}]`, e instanceof Error ? e.message : e); subreq++; failed++;
      }
    }

    if (changed) {
      try { await putUser(env, chatId, { ...user, rainSeen: seen }); }
      catch (e) { console.error(`[rain-state ${chatId}]`, e instanceof Error ? e.message : e); }
    }
  }

  return { sent, checked, skipped, failed };
}
