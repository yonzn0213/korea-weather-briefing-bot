import type { Env } from "./types";
import { REGIONS } from "./regions";
import { listUsers } from "./store";
import { sendMessage } from "./telegram";

const PTY_LABEL: Record<string, string> = {
  "1": "비", "2": "비/눈", "3": "눈", "4": "소나기", "5": "빗방울", "6": "빗방울눈날림", "7": "눈날림",
};
const SKY_LABEL: Record<string, string> = { "1": "맑음 ☀️", "3": "구름많음 ⛅", "4": "흐림 ☁️" };

const MAX_SUBREQUESTS = 45; // 무료 50 한도 안전 마진

export interface Weather {
  popMax: number;
  rainHours: [string, string][];
  tmn: number | null;
  tmx: number | null;
  sky: string | null;
  hourly: Record<string, number>;
}
export interface DustVal { pm10: number | null; pm25: number | null; }
export interface Dust { stations: Record<string, DustVal>; avg: DustVal; }

// now(UTC) -> KST Date (UTC 필드가 KST 값을 갖도록 +9h 시프트)
function toKst(now: Date): Date {
  return new Date(now.getTime() + 9 * 3600 * 1000);
}
function ymd(kst: Date): string {
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function baseDateTime(kst: Date): [string, string] {
  const h = kst.getUTCHours();
  const min = kst.getUTCMinutes();
  if (h > 5 || (h === 5 && min >= 15)) return [ymd(kst), "0500"];
  const prev = new Date(kst.getTime() - 24 * 3600 * 1000);
  return [ymd(prev), "2300"];
}

export function parseWeatherItems(items: any[], today: string): Weather {
  const data: Weather = { popMax: 0, rainHours: [], tmn: null, tmx: null, sky: null, hourly: {} };
  for (const it of items) {
    if (it.fcstDate !== today) continue;
    const { category: cat, fcstValue: val, fcstTime: t } = it;
    if (cat === "POP") data.popMax = Math.max(data.popMax, parseInt(val, 10));
    else if (cat === "PTY" && val !== "0") data.rainHours.push([t, PTY_LABEL[val] || "강수"]);
    else if (cat === "TMN") data.tmn = parseFloat(val);
    else if (cat === "TMX") data.tmx = parseFloat(val);
    else if (cat === "TMP") data.hourly[t] = parseFloat(val);
    else if (cat === "SKY" && t === "1200") data.sky = SKY_LABEL[val] || "";
  }
  return data;
}

export async function fetchWeather(key: string, nx: number, ny: number, now: Date): Promise<Weather> {
  const kst = toKst(now);
  const [baseDate, baseTime] = baseDateTime(kst);
  const today = ymd(kst);
  const url = new URL("https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst");
  url.search = new URLSearchParams({
    serviceKey: key, numOfRows: "1000", pageNo: "1", dataType: "JSON",
    base_date: baseDate, base_time: baseTime, nx: String(nx), ny: String(ny),
  }).toString();
  const r = await fetch(url.toString());
  const j = (await r.json()) as any;
  const items = (j.response.body.items.item as any[]) ?? [];
  return parseWeatherItems(items, today);
}

export async function fetchDust(key: string, sidoName: string): Promise<Dust> {
  const url = new URL("https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty");
  url.search = new URLSearchParams({
    serviceKey: key, returnType: "json", numOfRows: "1000", pageNo: "1", sidoName, ver: "1.0",
  }).toString();
  const r = await fetch(url.toString());
  const j = (await r.json()) as any;
  const items = j.response.body.items as any[];
  const stations: Record<string, DustVal> = {};
  const pm10s: number[] = [], pm25s: number[] = [];
  for (const it of items) {
    const entry: DustVal = { pm10: null, pm25: null };
    const v10 = parseFloat(it.pm10Value), v25 = parseFloat(it.pm25Value);
    if (!Number.isNaN(v10)) { entry.pm10 = v10; pm10s.push(v10); }
    if (!Number.isNaN(v25)) { entry.pm25 = v25; pm25s.push(v25); }
    if (entry.pm10 !== null || entry.pm25 !== null) stations[it.stationName] = entry;
  }
  const avg: DustVal = {
    pm10: pm10s.length ? Math.round(pm10s.reduce((a, b) => a + b, 0) / pm10s.length) : null,
    pm25: pm25s.length ? Math.round(pm25s.reduce((a, b) => a + b, 0) / pm25s.length) : null,
  };
  return { stations, avg };
}

export function dustFor(sigungu: string, dust: Dust): [DustVal, boolean] {
  const st = dust.stations[sigungu];
  if (st && (st.pm10 !== null || st.pm25 !== null)) return [{ pm10: st.pm10, pm25: st.pm25 }, false];
  return [dust.avg, true];
}

export function gradePm10(v: number): string {
  if (v <= 30) return "좋음 🟢";
  if (v <= 80) return "보통 🔵";
  if (v <= 150) return "나쁨 🟠";
  return "매우나쁨 🔴";
}
export function gradePm25(v: number): string {
  if (v <= 15) return "좋음 🟢";
  if (v <= 35) return "보통 🔵";
  if (v <= 75) return "나쁨 🟠";
  return "매우나쁨 🔴";
}

// 0500 발표분엔 TMN/TMX가 없으므로, 없을 때 시간별 기온(TMP) min/max로 대체
export function resolveLowHigh(w: Weather): [number | null, number | null] {
  const temps = Object.values(w.hourly);
  const low = w.tmn ?? (temps.length ? Math.min(...temps) : null);
  const high = w.tmx ?? (temps.length ? Math.max(...temps) : null);
  return [low, high];
}

function summarizeRain(rainHours: [string, string][], popMax: number): string {
  if (rainHours.length === 0) {
    if (popMax >= 60) return `☔ 비 예보는 없지만 강수확률이 최대 ${popMax}%예요. 우산 챙기는 게 안전!`;
    return `🌂 오늘 비 소식 없음 (강수확률 최대 ${popMax}%)`;
  }
  const hours = rainHours.map(([t]) => parseInt(t.slice(0, 2), 10)).sort((a, b) => a - b);
  const counts = new Map<string, number>();
  for (const [, label] of rainHours) counts.set(label, (counts.get(label) || 0) + 1);
  const kind = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const ranges: [number, number][] = [];
  let start = hours[0], prev = hours[0];
  for (const h of hours.slice(1)) {
    if (h === prev + 1) prev = h;
    else { ranges.push([start, prev]); start = prev = h; }
  }
  ranges.push([start, prev]);
  const span = ranges.map(([s, e]) => (s !== e ? `${s}시~${e + 1}시` : `${s}시경`)).join(", ");
  return `☔ 오늘 ${kind} 소식 있어요! (${span}, 강수확률 최대 ${popMax}%) 우산 꼭 챙기세요!`;
}

export function buildMessage(now: Date, sido: string, sigungu: string, w: Weather | null, d: DustVal | null, isAvg: boolean): string {
  const kst = toKst(now);
  const lines: string[] = [`🌅 <b>${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${sigungu} 아침 브리핑</b>`, ""];

  if (w) {
    lines.push(summarizeRain(w.rainHours, w.popMax));
    const temp: string[] = [];
    if (w.tmn !== null) temp.push(`최저 ${Math.round(w.tmn)}°C`);
    if (w.tmx !== null) temp.push(`최고 ${Math.round(w.tmx)}°C`);
    if (temp.length) lines.push("🌡 " + temp.join(" / "));
    if (w.sky) lines.push(`하늘: ${w.sky}`);
  } else {
    lines.push("⚠️ 날씨 정보를 불러오지 못했어요.");
  }

  lines.push("");
  if (d && (d.pm10 !== null || d.pm25 !== null)) {
    const suffix = isAvg ? ` (${sido} 평균)` : "";
    if (d.pm10 !== null) lines.push(`미세먼지(PM10): ${Math.round(d.pm10)}㎍/㎥ · ${gradePm10(d.pm10)}${suffix}`);
    if (d.pm25 !== null) lines.push(`초미세먼지(PM2.5): ${Math.round(d.pm25)}㎍/㎥ · ${gradePm25(d.pm25)}${suffix}`);
    if ((d.pm10 !== null && d.pm10 > 80) || (d.pm25 !== null && d.pm25 > 35)) lines.push("😷 마스크 챙기시는 걸 추천해요!");
  } else {
    lines.push("⚠️ 미세먼지 정보를 불러오지 못했어요.");
  }

  lines.push("\n좋은 하루 보내세요! 💪");
  return lines.join("\n");
}

// 한도 도달 시 매일 같은 유저가 밀리지 않도록, 날짜 기반으로 처리 순서를 회전한다
export function rotateByDate<T>(items: T[], now: Date): T[] {
  if (items.length === 0) return items;
  const kst = toKst(now);
  const start = Date.UTC(kst.getUTCFullYear(), 0, 1);
  const today = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  const dayOfYear = Math.floor((today - start) / 86400000);
  const offset = dayOfYear % items.length;
  return items.slice(offset).concat(items.slice(0, offset));
}

export async function runBriefing(env: Env, now: Date): Promise<{ sent: number; failed: number; skipped: number }> {
  const ordered = rotateByDate(await listUsers(env), now);
  const weatherCache = new Map<string, Weather | null>();
  const dustCache = new Map<string, Dust | null>();
  let subreq = 0;
  let sent = 0, failed = 0, skipped = 0;

  for (let i = 0; i < ordered.length; i++) {
    const { chatId, user } = ordered[i];
    const { sido, sigungu } = user;
    if (!REGIONS[sido] || !REGIONS[sido].sigungu[sigungu]) continue;

    const g = REGIONS[sido].sigungu[sigungu];
    const gridKey = `${g.nx},${g.ny}`;
    const airkorea = REGIONS[sido].airkorea;

    const need = (weatherCache.has(gridKey) ? 0 : 1) + (dustCache.has(airkorea) ? 0 : 1) + 1;
    if (subreq + need > MAX_SUBREQUESTS) {
      skipped = ordered.length - i;
      console.warn(`subrequest 예산 도달: ${skipped}명 이번 회차 건너뜀`);
      break;
    }

    if (!weatherCache.has(gridKey)) {
      try { weatherCache.set(gridKey, await fetchWeather(env.DATA_GO_KR_KEY, g.nx, g.ny, now)); subreq++; }
      catch (e) { console.error(`[weather ${sigungu}]`, e instanceof Error ? e.message : e); weatherCache.set(gridKey, null); subreq++; }
    }
    if (!dustCache.has(airkorea)) {
      try { dustCache.set(airkorea, await fetchDust(env.DATA_GO_KR_KEY, airkorea)); subreq++; }
      catch (e) { console.error(`[dust ${airkorea}]`, e instanceof Error ? e.message : e); dustCache.set(airkorea, null); subreq++; }
    }

    const dust = dustCache.get(airkorea) ?? null;
    const [d, isAvg] = dust ? dustFor(sigungu, dust) : [null, false] as [DustVal | null, boolean];
    const msg = buildMessage(now, sido, sigungu, weatherCache.get(gridKey) ?? null, d, isAvg);
    try { await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg); subreq++; sent++; }
    catch (e) { console.error(`[send ${chatId}]`, e instanceof Error ? e.message : e); subreq++; failed++; }
  }

  return { sent, failed, skipped };
}
