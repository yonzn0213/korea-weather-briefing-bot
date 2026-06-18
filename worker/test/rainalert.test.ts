import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ultraBase, parseUltraItems, nextRain, rainAlertMessage, runRainAlerts,
} from "../src/rainalert";
import { getUser } from "../src/store";
import type { Env, User } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

describe("ultraBase", () => {
  it("45분 이후면 현재 시각 30분 발표분", () => {
    expect(ultraBase(new Date("2026-06-18T14:50:00Z"))).toEqual(["20260618", "1430"]);
  });
  it("45분 이전이면 직전 시각 발표분", () => {
    expect(ultraBase(new Date("2026-06-18T14:20:00Z"))).toEqual(["20260618", "1330"]);
  });
  it("자정 직후면 전날 23시30분", () => {
    expect(ultraBase(new Date("2026-06-18T00:20:00Z"))).toEqual(["20260617", "2330"]);
  });
});

describe("parseUltraItems", () => {
  const items = [
    { category: "PTY", fcstDate: "20260618", fcstTime: "1000", fcstValue: "0" },
    { category: "PTY", fcstDate: "20260618", fcstTime: "1100", fcstValue: "1" },
    { category: "T1H", fcstDate: "20260618", fcstTime: "1100", fcstValue: "20" }, // PTY 아님 → 제외
    { category: "PTY", fcstDate: "20260619", fcstTime: "0100", fcstValue: "1" },  // 내일 → 제외
  ];
  it("오늘 PTY만 시간순으로 수집", () => {
    expect(parseUltraItems(items, "20260618")).toEqual([
      { hour: 10, pty: "0" }, { hour: 11, pty: "1" },
    ]);
  });
});

describe("nextRain", () => {
  const e = [{ hour: 10, pty: "0" }, { hour: 11, pty: "1" }, { hour: 13, pty: "1" }];
  it("향후 2시간 내 가장 이른 강수", () => {
    expect(nextRain(e, 10, 2)).toEqual({ hour: 11, label: "비" });
  });
  it("창 밖의 강수는 무시", () => {
    expect(nextRain(e, 10, 0)).toBeNull(); // 10시만 보고 → 강수 없음
  });
  it("강수 없으면 null", () => {
    expect(nextRain([{ hour: 11, pty: "0" }], 10, 2)).toBeNull();
  });
});

describe("rainAlertMessage", () => {
  it("미래 시각은 'HH시경'", () => {
    expect(rainAlertMessage("강남구", { hour: 13, label: "비" }, 11)).toContain("13시경");
  });
  it("현재/지난 시각은 '곧'", () => {
    expect(rainAlertMessage("강남구", { hour: 11, label: "비" }, 11)).toContain("곧");
  });
});

function fakeKV() {
  const m = new Map<string, string>();
  return {
    async get(k: string) { return m.has(k) ? m.get(k)! : null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
    async list() { return { keys: [...m.keys()].map((name) => ({ name })), list_complete: true, cursor: "" }; },
  } as unknown as KVNamespace;
}
function env(): Env {
  return { USERS: fakeKV(), TELEGRAM_BOT_TOKEN: "TOK", DATA_GO_KR_KEY: "k", WEBHOOK_SECRET: "s" };
}
function stubFetch(items: any[]) {
  const fn = vi.fn(async (url: string) => {
    if (String(url).includes("getUltraSrtFcst")) {
      return new Response(JSON.stringify({ response: { body: { items: { item: items } } } }));
    }
    return new Response(JSON.stringify({ ok: true, result: {} }));
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
function sends(fn: any) {
  return fn.mock.calls.filter((c: any[]) => String(c[0]).includes("api.telegram.org"));
}

const RAIN_ITEMS = [
  { category: "PTY", fcstDate: "20260618", fcstTime: "1000", fcstValue: "0" },
  { category: "PTY", fcstDate: "20260618", fcstTime: "1100", fcstValue: "1" }, // +1h 비
];
const NOW_ACTIVE = new Date("2026-06-18T01:00:00Z"); // KST 10:00 (비-침묵 시간)
const SEOUL: User = { regions: [{ sido: "서울특별시", sigungu: "강남구" }], name: "철수", rainAlert: true };

describe("runRainAlerts", () => {
  it("새벽(침묵 시간)엔 아무것도 하지 않음", async () => {
    const e = env();
    await e.USERS.put("100", JSON.stringify(SEOUL));
    const fn = stubFetch(RAIN_ITEMS);
    const res = await runRainAlerts(e, new Date("2026-06-17T20:00:00Z")); // KST 05:00
    expect(res).toEqual({ sent: 0, checked: 0, skipped: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it("옵트인하지 않은 유저는 점검하지 않음", async () => {
    const e = env();
    await e.USERS.put("100", JSON.stringify({ ...SEOUL, rainAlert: false }));
    const fn = stubFetch(RAIN_ITEMS);
    const res = await runRainAlerts(e, NOW_ACTIVE);
    expect(res.checked).toBe(0);
    expect(sends(fn).length).toBe(0);
  });

  it("곧 비가 오면 알림 발송 + rainSeen 기록", async () => {
    const e = env();
    await e.USERS.put("100", JSON.stringify(SEOUL));
    const fn = stubFetch(RAIN_ITEMS);
    const res = await runRainAlerts(e, NOW_ACTIVE);
    expect(res.sent).toBe(1);
    expect(sends(fn)[0][1].body).toContain("강남구");
    const saved = await getUser(e, "100");
    expect(Object.keys(saved!.rainSeen ?? {}).length).toBe(1);
  });

  it("쿨다운 내 재실행은 중복 발송 안 함", async () => {
    const e = env();
    await e.USERS.put("100", JSON.stringify(SEOUL));
    stubFetch(RAIN_ITEMS);
    await runRainAlerts(e, NOW_ACTIVE);
    const fn2 = stubFetch(RAIN_ITEMS);
    const res = await runRainAlerts(e, NOW_ACTIVE); // 같은 시각 → 쿨다운
    expect(res.sent).toBe(0);
    expect(sends(fn2).length).toBe(0);
  });

  it("강수 예보가 없으면 발송 안 함", async () => {
    const e = env();
    await e.USERS.put("100", JSON.stringify(SEOUL));
    const fn = stubFetch([{ category: "PTY", fcstDate: "20260618", fcstTime: "1100", fcstValue: "0" }]);
    const res = await runRainAlerts(e, NOW_ACTIVE);
    expect(res.sent).toBe(0);
    expect(res.checked).toBe(1);
  });
});
