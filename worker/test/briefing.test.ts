import { describe, it, expect, vi, afterEach } from "vitest";
import { dustFor, buildMessage, gradePm10, rotateByDate, parseWeatherItems, resolveLowHigh, formatHourly, hourEmoji, clothingFor, clothingRange, pickLuckyColor, LUCKY_COLORS } from "../src/briefing";

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
  const W = { popMax: 80, rainHours: [["1400", "비"], ["1500", "비"]] as [string, string][], tmn: 19, tmx: 26, sky: "흐림 ☁️", hourly: { "0600": 19, "0900": 22, "1200": 25, "1500": 26, "1800": 24, "2100": 21 }, hourlySky: { "0600": "1", "1200": "4" }, hourlyPty: { "1500": "1" } };

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
  it("시간대별·옷차림·행운색 줄 포함", () => {
    const msg = buildMessage(now, "경기도", "수원시", W, { pm10: 45, pm25: 22 }, false, () => 0);
    expect(msg).toContain("⏰");
    expect(msg).toContain("시간대별");
    expect(msg).toContain("6시");
    expect(msg).toContain("👕 옷차림:");
    expect(msg).toContain("🎨 오늘의 행운 색: " + LUCKY_COLORS[0]);
  });
  it("TMN/TMX 없으면 hourly로 최저/최고 fallback", () => {
    const wf = { popMax: 0, rainHours: [] as [string, string][], tmn: null, tmx: null, sky: null, hourly: { "0600": 19, "1500": 32 }, hourlySky: {}, hourlyPty: {} };
    const msg = buildMessage(now, "경기도", "수원시", wf, { pm10: 45, pm25: 22 }, false, () => 0);
    expect(msg).toContain("최저 19°C");
    expect(msg).toContain("최고 32°C");
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
  it("TMN=0(0°C)이면 hourly로 fallback하지 않음", () => {
    const w = { ...base, tmn: 0, tmx: 5, hourly: { "0600": 3, "1500": 8 } };
    expect(resolveLowHigh(w as any)).toEqual([0, 5]);
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
  it("TMP가 숫자가 아니면 hourly에 넣지 않음", () => {
    const bad = [{ fcstDate: today, fcstTime: "0900", category: "TMP", fcstValue: "" }];
    expect(parseWeatherItems(bad, today).hourly).toEqual({});
  });
});

describe("hourEmoji", () => {
  it("강수(PTY)가 있으면 강수 우선", () => {
    expect(hourEmoji("4", "1")).toContain("비"); // SKY 흐림이어도 비 우선
  });
  it("강수 없으면 하늘(SKY) 상태", () => {
    expect(hourEmoji("1", "0")).toContain("맑음");
    expect(hourEmoji("4", undefined)).toContain("흐림");
  });
  it("매핑 정보 없으면 빈 문자열", () => {
    expect(hourEmoji(undefined, undefined)).toBe("");
    expect(hourEmoji("9", "0")).toBe("");
  });
});

describe("formatHourly", () => {
  const W = (hourly: Record<string, number>, sky: Record<string, string> = {}, pty: Record<string, string> = {}) =>
    ({ hourly, hourlySky: sky, hourlyPty: pty } as any);

  it("시간별로 행을 나누고 기온을 반올림해 표시", () => {
    const s = formatHourly(W({ "0600": 18.4, "0900": 21, "1200": 25, "1500": 26, "1800": 23, "2100": 20, "0700": 19 }));
    expect(s).toContain("⏰");
    expect(s).toContain("6시");
    expect(s).toContain("18°"); // 18.4 반올림
    expect(s).toContain("21°");
    expect(s).not.toContain("19°"); // 0700은 슬롯 외 → 제외
    expect(s.split("\n").length).toBeGreaterThanOrEqual(6); // 헤더 + 6개 행
  });
  it("시간별 이모지 표시 (강수 우선)", () => {
    const s = formatHourly(W({ "0600": 19, "1500": 26 }, { "0600": "1", "1500": "4" }, { "1500": "1" }));
    expect(s).toContain("☀️"); // 0600 맑음
    expect(s).toContain("🌧"); // 1500 비(PTY 우선)
  });
  it("기온 슬롯이 하나도 없으면 빈 문자열", () => {
    expect(formatHourly(W({ "0700": 19 }))).toBe("");
  });
});

describe("clothingFor", () => {
  it("구간 중간값", () => {
    expect(clothingFor(30)).toBe("민소매·반팔·반바지");
    expect(clothingFor(27)).toBe("반팔·얇은 셔츠·면바지");
    expect(clothingFor(22)).toBe("긴팔·얇은 가디건·면바지");
    expect(clothingFor(18)).toBe("맨투맨·얇은 니트·가디건");
    expect(clothingFor(15)).toBe("자켓·가디건·야상·청바지");
    expect(clothingFor(10)).toBe("트렌치코트·점퍼·니트");
    expect(clothingFor(6)).toBe("코트·히트텍·가죽자켓");
    expect(clothingFor(-2)).toBe("패딩·두꺼운 코트·목도리");
  });
  it("구간 하한 경계(inclusive)", () => {
    expect(clothingFor(28)).toBe("민소매·반팔·반바지");
    expect(clothingFor(23)).toBe("반팔·얇은 셔츠·면바지");
    expect(clothingFor(20)).toBe("긴팔·얇은 가디건·면바지");
    expect(clothingFor(17)).toBe("맨투맨·얇은 니트·가디건");
    expect(clothingFor(12)).toBe("자켓·가디건·야상·청바지");
    expect(clothingFor(9)).toBe("트렌치코트·점퍼·니트");
    expect(clothingFor(5)).toBe("코트·히트텍·가죽자켓");
    expect(clothingFor(4)).toBe("패딩·두꺼운 코트·목도리");
  });
});

describe("clothingRange", () => {
  it("최저·최고가 다른 구간이면 범위", () => {
    expect(clothingRange(19, 32)).toBe("맨투맨·얇은 니트·가디건 ~ 민소매·반팔·반바지");
  });
  it("같은 구간이면 하나만", () => {
    expect(clothingRange(23, 27)).toBe("반팔·얇은 셔츠·면바지");
  });
  it("한쪽만 있으면 그 값 기준", () => {
    expect(clothingRange(null, 27)).toBe("반팔·얇은 셔츠·면바지");
    expect(clothingRange(27, null)).toBe("반팔·얇은 셔츠·면바지");
  });
  it("둘 다 없으면 빈 문자열", () => {
    expect(clothingRange(null, null)).toBe("");
  });
  it("인자 순서가 뒤바뀌어도 두꺼운 쪽 ~ 얇은 쪽", () => {
    expect(clothingRange(32, 19)).toBe("맨투맨·얇은 니트·가디건 ~ 민소매·반팔·반바지");
  });
});

describe("pickLuckyColor", () => {
  it("rand=0이면 첫 색", () => {
    expect(pickLuckyColor(() => 0)).toBe(LUCKY_COLORS[0]);
  });
  it("rand≈1이면 마지막 색", () => {
    expect(pickLuckyColor(() => 0.999)).toBe(LUCKY_COLORS[LUCKY_COLORS.length - 1]);
  });
  it("항상 목록 안의 값", () => {
    for (const r of [0.1, 0.37, 0.5, 0.83]) {
      expect(LUCKY_COLORS).toContain(pickLuckyColor(() => r));
    }
  });
});
