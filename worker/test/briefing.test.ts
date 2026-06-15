import { describe, it, expect, vi, afterEach } from "vitest";
import { dustFor, buildMessage, gradePm10, rotateByDate, parseWeatherItems, resolveLowHigh } from "../src/briefing";

afterEach(() => vi.unstubAllGlobals());

const DUST = {
  stations: { "강남구": { pm10: 40, pm25: 20 } },
  avg: { pm10: 55, pm25: 30 },
};

describe("rotateByDate", () => {
  it("빈 배열은 그대로", () => {
    expect(rotateByDate([], new Date("2026-06-12T22:00:00Z"))).toEqual([]);
  });
  it("날짜에 따라 시작 지점이 회전", () => {
    const items = [0, 1, 2, 3, 4];
    const a = rotateByDate(items, new Date("2026-06-12T22:00:00Z"));
    const b = rotateByDate(items, new Date("2026-06-13T22:00:00Z"));
    // 같은 원소 집합이지만 다음 날은 시작점이 1칸 이동
    expect([...a].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(a[0]).not.toBe(b[0]);
  });
});

describe("dustFor", () => {
  it("측정소 매칭되면 그 값", () => {
    expect(dustFor("강남구", DUST as any)).toEqual([{ pm10: 40, pm25: 20 }, false]);
  });
  it("매칭 안되면 시도평균", () => {
    expect(dustFor("가평군", DUST as any)).toEqual([{ pm10: 55, pm25: 30 }, true]);
  });
});

describe("gradePm10", () => {
  it("경계값", () => {
    expect(gradePm10(30)).toContain("좋음");
    expect(gradePm10(80)).toContain("보통");
    expect(gradePm10(150)).toContain("나쁨");
    expect(gradePm10(200)).toContain("매우나쁨");
  });
});

describe("buildMessage", () => {
  const now = new Date("2026-06-12T22:00:00Z"); // KST 06-13 07:00
  const W = { popMax: 80, rainHours: [["1400", "비"], ["1500", "비"]] as [string, string][], tmn: 19, tmx: 26, sky: "흐림 ☁️", hourly: {} };

  it("제목은 시군구, 비/온도/하늘 포함", () => {
    const msg = buildMessage(now, "경기도", "수원시", W, { pm10: 45, pm25: 22 }, false);
    expect(msg).toContain("수원시 아침 브리핑");
    expect(msg).toContain("우산");
    expect(msg).toContain("최저 19°C");
    expect(msg).toContain("최고 26°C");
  });

  it("평균 표기는 시도명", () => {
    const msg = buildMessage(now, "경기도", "가평군", W, { pm10: 45, pm25: 22 }, true);
    expect(msg).toContain("(경기도 평균)");
  });

  it("정보 없으면 경고 문구", () => {
    const msg = buildMessage(now, "경기도", "수원시", null, null, false);
    expect(msg).toContain("날씨 정보를 불러오지 못했어요");
    expect(msg).toContain("미세먼지 정보를 불러오지 못했어요");
  });
});

describe("resolveLowHigh", () => {
  const base = { popMax: 0, rainHours: [] as [string, string][], sky: null };
  it("TMN/TMX 있으면 그대로", () => {
    const w = { ...base, tmn: 18, tmx: 27, hourly: { "0600": 20, "1500": 25 } };
    expect(resolveLowHigh(w as any)).toEqual([18, 27]);
  });
  it("TMN/TMX 없으면 hourly min/max로 fallback", () => {
    const w = { ...base, tmn: null, tmx: null, hourly: { "0600": 19, "0900": 23, "1500": 32 } };
    expect(resolveLowHigh(w as any)).toEqual([19, 32]);
  });
  it("TMN/TMX 없고 hourly도 비면 null", () => {
    const w = { ...base, tmn: null, tmx: null, hourly: {} };
    expect(resolveLowHigh(w as any)).toEqual([null, null]);
  });
});

describe("parseWeatherItems", () => {
  const today = "20260615";
  const items = [
    { fcstDate: today, fcstTime: "0600", category: "TMP", fcstValue: "19" },
    { fcstDate: today, fcstTime: "0900", category: "TMP", fcstValue: "23" },
    { fcstDate: today, fcstTime: "1500", category: "TMP", fcstValue: "32" },
    { fcstDate: today, fcstTime: "1200", category: "POP", fcstValue: "80" },
    { fcstDate: today, fcstTime: "1200", category: "SKY", fcstValue: "4" },
    { fcstDate: "20260616", fcstTime: "0600", category: "TMP", fcstValue: "5" }, // 내일치는 무시
  ];
  it("오늘 TMP만 시간→기온 맵으로 수집", () => {
    const w = parseWeatherItems(items, today);
    expect(w.hourly).toEqual({ "0600": 19, "0900": 23, "1500": 32 });
  });
  it("POP/SKY 등 기존 파싱 유지", () => {
    const w = parseWeatherItems(items, today);
    expect(w.popMax).toBe(80);
    expect(w.sky).toContain("흐림");
  });
});
