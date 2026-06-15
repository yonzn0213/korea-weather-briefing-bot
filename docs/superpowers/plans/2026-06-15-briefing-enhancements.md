# 브리핑 기능 추가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아침 브리핑에 시간대별 온도·기온별 옷차림·행운의 색을 추가하고, 0500 발표분에 없는 최저/최고기온을 시간별 기온(TMP) min/max로 fallback 처리한다.

**Architecture:** 모든 변경은 `worker/src/briefing.ts`에 집중. 기상청 응답 파싱 루프를 순수 함수 `parseWeatherItems`로 추출해 테스트 가능하게 만들고, `TMP`(시간별 기온)를 새로 파싱한다. 옷차림/행운색/시간대포맷/최저·최고해석은 모두 순수 함수로 분리하고, `buildMessage`가 이들을 조합한다. 행운색 랜덤은 `buildMessage`에 주입(기본값 `Math.random`)해 메시지 결정성을 유지한다. 추가 외부 호출 없음(subrequest 한도 무관).

**Tech Stack:** TypeScript (Cloudflare Workers), Vitest (TDD), 의존성 0.

---

## File Structure

- `worker/src/briefing.ts` (수정)
  - `Weather` 인터페이스에 `hourly: Record<string, number>` 추가
  - `parseWeatherItems(items, today)` 신규 추출(순수) — TMP 파싱 포함
  - `fetchWeather`는 `parseWeatherItems`를 호출하도록 리팩터
  - 신규 순수 함수: `resolveLowHigh`, `formatHourly`, `clothingFor`, `clothingRange`, `pickLuckyColor`
  - `LUCKY_COLORS`, `HOURLY_SLOTS` 상수
  - `buildMessage` 시그니처에 `rand: () => number = Math.random` 추가, 새 줄 조합
- `worker/test/briefing.test.ts` (수정) — 위 순수 함수 단위 테스트 추가

작업 디렉터리: `worker/`. 테스트 실행: `cd worker && npx vitest run <패턴>`.

---

### Task 1: TMP 파싱 + hourly 필드 (parseWeatherItems 추출)

**Files:**
- Modify: `worker/src/briefing.ts` (`Weather` 인터페이스, `fetchWeather`)
- Test: `worker/test/briefing.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`worker/test/briefing.test.ts` 상단 import에 `parseWeatherItems` 추가:

```ts
import { dustFor, buildMessage, gradePm10, rotateByDate, parseWeatherItems } from "../src/briefing";
```

파일 끝에 추가:

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd worker && npx vitest run test/briefing.test.ts -t parseWeatherItems`
Expected: FAIL — `parseWeatherItems is not a function` (export 없음)

- [ ] **Step 3: 구현 — Weather 인터페이스에 hourly 추가**

`worker/src/briefing.ts`의 `Weather` 인터페이스를 교체:

```ts
export interface Weather {
  popMax: number;
  rainHours: [string, string][];
  tmn: number | null;
  tmx: number | null;
  sky: string | null;
  hourly: Record<string, number>;
}
```

- [ ] **Step 4: 구현 — parseWeatherItems 추출 + TMP 파싱**

`fetchWeather` 함수 바로 위에 추가:

```ts
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
```

`fetchWeather` 내부의 파싱 루프(현재 `const data: Weather = ...`부터 `for (const it of items) {...}`까지)를 아래로 교체:

```ts
  const items = (j.response.body.items.item as any[]) ?? [];
  return parseWeatherItems(items, today);
```

(즉 `fetchWeather`는 fetch/JSON 파싱 후 `parseWeatherItems(items, today)`를 반환. 기존 `const data...` 블록과 그 아래 `return data;`는 제거.)

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd worker && npx vitest run test/briefing.test.ts -t parseWeatherItems`
Expected: PASS (2 tests)

- [ ] **Step 6: 커밋**

```bash
git add worker/src/briefing.ts worker/test/briefing.test.ts
git commit -m "feat: 시간별 기온(TMP) 파싱 + parseWeatherItems 추출"
```

---

### Task 2: 최저/최고기온 fallback (resolveLowHigh)

**Files:**
- Modify: `worker/src/briefing.ts`
- Test: `worker/test/briefing.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

import에 `resolveLowHigh` 추가하고, 파일 끝에:

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd worker && npx vitest run test/briefing.test.ts -t resolveLowHigh`
Expected: FAIL — `resolveLowHigh is not a function`

- [ ] **Step 3: 구현**

`worker/src/briefing.ts`의 `gradePm25` 함수 아래에 추가:

```ts
// 0500 발표분엔 TMN/TMX가 없으므로, 없을 때 시간별 기온(TMP) min/max로 대체
export function resolveLowHigh(w: Weather): [number | null, number | null] {
  const temps = Object.values(w.hourly);
  const low = w.tmn ?? (temps.length ? Math.min(...temps) : null);
  const high = w.tmx ?? (temps.length ? Math.max(...temps) : null);
  return [low, high];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd worker && npx vitest run test/briefing.test.ts -t resolveLowHigh`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add worker/src/briefing.ts worker/test/briefing.test.ts
git commit -m "feat: 최저/최고기온 TMP fallback(resolveLowHigh)"
```

---

### Task 3: 시간대별 온도 포맷 (formatHourly)

**Files:**
- Modify: `worker/src/briefing.ts`
- Test: `worker/test/briefing.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

import에 `formatHourly` 추가하고, 파일 끝에:

```ts
describe("formatHourly", () => {
  it("6·9·12·15·18·21시만, 소수 반올림", () => {
    const s = formatHourly({ "0600": 18.4, "0900": 21, "1200": 25, "1500": 26, "1800": 23, "2100": 20, "0700": 19 });
    expect(s).toBe("⏰ 6시 18° · 9시 21° · 12시 25° · 15시 26° · 18시 23° · 21시 20°");
  });
  it("일부 시간만 있으면 있는 것만", () => {
    expect(formatHourly({ "0900": 21, "1500": 26 })).toBe("⏰ 9시 21° · 15시 26°");
  });
  it("해당 시간 없으면 빈 문자열", () => {
    expect(formatHourly({ "0700": 19 })).toBe("");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd worker && npx vitest run test/briefing.test.ts -t formatHourly`
Expected: FAIL — `formatHourly is not a function`

- [ ] **Step 3: 구현**

`worker/src/briefing.ts`의 상수 영역(`MAX_SUBREQUESTS` 근처) 아래에 추가:

```ts
const HOURLY_SLOTS = ["0600", "0900", "1200", "1500", "1800", "2100"];
```

`resolveLowHigh` 함수 아래에 추가:

```ts
export function formatHourly(hourly: Record<string, number>): string {
  const parts = HOURLY_SLOTS
    .filter((t) => hourly[t] !== undefined)
    .map((t) => `${parseInt(t.slice(0, 2), 10)}시 ${Math.round(hourly[t])}°`);
  return parts.length ? "⏰ " + parts.join(" · ") : "";
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd worker && npx vitest run test/briefing.test.ts -t formatHourly`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add worker/src/briefing.ts worker/test/briefing.test.ts
git commit -m "feat: 시간대별 온도 포맷(formatHourly)"
```

---

### Task 4: 기온별 옷차림 (clothingFor + clothingRange)

**Files:**
- Modify: `worker/src/briefing.ts`
- Test: `worker/test/briefing.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

import에 `clothingFor, clothingRange` 추가하고, 파일 끝에:

```ts
describe("clothingFor", () => {
  it("구간 경계", () => {
    expect(clothingFor(30)).toBe("민소매·반팔·반바지");
    expect(clothingFor(27)).toBe("반팔·얇은 셔츠·면바지");
    expect(clothingFor(22)).toBe("긴팔·얇은 가디건·면바지");
    expect(clothingFor(18)).toBe("맨투맨·얇은 니트·가디건");
    expect(clothingFor(15)).toBe("자켓·가디건·야상·청바지");
    expect(clothingFor(10)).toBe("트렌치코트·점퍼·니트");
    expect(clothingFor(6)).toBe("코트·히트텍·가죽자켓");
    expect(clothingFor(-2)).toBe("패딩·두꺼운 코트·목도리");
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
  });
  it("둘 다 없으면 빈 문자열", () => {
    expect(clothingRange(null, null)).toBe("");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd worker && npx vitest run test/briefing.test.ts -t clothing`
Expected: FAIL — `clothingFor is not a function`

- [ ] **Step 3: 구현**

`worker/src/briefing.ts`의 `formatHourly` 아래에 추가:

```ts
// 표준 기온별 옷차림 표 (낮은 기온일수록 두꺼운 옷)
export function clothingFor(t: number): string {
  if (t >= 28) return "민소매·반팔·반바지";
  if (t >= 23) return "반팔·얇은 셔츠·면바지";
  if (t >= 20) return "긴팔·얇은 가디건·면바지";
  if (t >= 17) return "맨투맨·얇은 니트·가디건";
  if (t >= 12) return "자켓·가디건·야상·청바지";
  if (t >= 9) return "트렌치코트·점퍼·니트";
  if (t >= 5) return "코트·히트텍·가죽자켓";
  return "패딩·두꺼운 코트·목도리";
}

// 최저기온 옷차림 ~ 최고기온 옷차림 (두꺼운 쪽 ~ 얇은 쪽)
export function clothingRange(low: number | null, high: number | null): string {
  if (low === null && high === null) return "";
  const warm = clothingFor(Math.round(low ?? (high as number)));
  const light = clothingFor(Math.round(high ?? (low as number)));
  return warm === light ? warm : `${warm} ~ ${light}`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd worker && npx vitest run test/briefing.test.ts -t clothing`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add worker/src/briefing.ts worker/test/briefing.test.ts
git commit -m "feat: 기온별 옷차림(clothingFor/clothingRange)"
```

---

### Task 5: 행운의 색 (LUCKY_COLORS + pickLuckyColor)

**Files:**
- Modify: `worker/src/briefing.ts`
- Test: `worker/test/briefing.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

import에 `pickLuckyColor, LUCKY_COLORS` 추가하고, 파일 끝에:

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd worker && npx vitest run test/briefing.test.ts -t pickLuckyColor`
Expected: FAIL — `pickLuckyColor is not a function`

- [ ] **Step 3: 구현**

`worker/src/briefing.ts`의 상수 영역(`HOURLY_SLOTS` 아래)에 추가:

```ts
export const LUCKY_COLORS = [
  "빨강 ❤️", "주황 🧡", "노랑 💛", "초록 💚", "파랑 💙", "남색 🔷", "보라 💜",
  "분홍 🩷", "청록 🩵", "하늘색 ☁️", "금색 ✨", "연두 🍏", "은색 ⚪", "자주 🟣",
];
```

`clothingRange` 함수 아래에 추가:

```ts
export function pickLuckyColor(rand: () => number = Math.random): string {
  return LUCKY_COLORS[Math.floor(rand() * LUCKY_COLORS.length)];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd worker && npx vitest run test/briefing.test.ts -t pickLuckyColor`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add worker/src/briefing.ts worker/test/briefing.test.ts
git commit -m "feat: 행운의 색(pickLuckyColor)"
```

---

### Task 6: buildMessage 통합 (시간대별·옷차림·행운색 + rand 주입)

**Files:**
- Modify: `worker/src/briefing.ts` (`buildMessage`)
- Test: `worker/test/briefing.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

기존 `describe("buildMessage", ...)` 블록의 `W` 상수를 hourly 포함하도록 교체:

```ts
  const W = { popMax: 80, rainHours: [["1400", "비"], ["1500", "비"]] as [string, string][], tmn: null, tmx: null, sky: "흐림 ☁️", hourly: { "0600": 19, "0900": 23, "1200": 28, "1500": 32, "1800": 27, "2100": 22 } };
```

같은 `describe("buildMessage", ...)` 블록 안에 테스트 추가:

```ts
  it("시간대별·옷차림·행운색 포함, TMN 없으면 fallback 최저/최고", () => {
    const msg = buildMessage(now, "경기도", "수원시", W, { pm10: 45, pm25: 22 }, false, () => 0);
    expect(msg).toContain("최저 19°C");   // hourly min
    expect(msg).toContain("최고 32°C");   // hourly max
    expect(msg).toContain("⏰ 6시 19°");
    expect(msg).toContain("👕 옷차림:");
    expect(msg).toContain("🎨 오늘의 행운 색: " + LUCKY_COLORS[0]);
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd worker && npx vitest run test/briefing.test.ts -t buildMessage`
Expected: FAIL — `최저 19°C` 등 미포함 (아직 통합 전; 기존 `buildMessage`는 w.tmn 직접 사용 → null이라 온도줄 없음)

- [ ] **Step 3: 구현 — buildMessage 교체**

`worker/src/briefing.ts`의 `buildMessage` 전체를 아래로 교체:

```ts
export function buildMessage(
  now: Date, sido: string, sigungu: string,
  w: Weather | null, d: DustVal | null, isAvg: boolean,
  rand: () => number = Math.random,
): string {
  const kst = toKst(now);
  const lines: string[] = [`🌅 <b>${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${sigungu} 아침 브리핑</b>`, ""];

  if (w) {
    lines.push(summarizeRain(w.rainHours, w.popMax));
    const [low, high] = resolveLowHigh(w);
    const temp: string[] = [];
    if (low !== null) temp.push(`최저 ${Math.round(low)}°C`);
    if (high !== null) temp.push(`최고 ${Math.round(high)}°C`);
    if (temp.length) lines.push("🌡 " + temp.join(" / "));
    const hourly = formatHourly(w.hourly);
    if (hourly) lines.push(hourly);
    const clothing = clothingRange(low, high);
    if (clothing) lines.push("👕 옷차림: " + clothing);
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

  lines.push(`\n🎨 오늘의 행운 색: ${pickLuckyColor(rand)}`);
  lines.push("\n좋은 하루 보내세요! 💪");
  return lines.join("\n");
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd worker && npx vitest run test/briefing.test.ts -t buildMessage`
Expected: PASS (기존 buildMessage 테스트 + 신규 1개 모두 통과)

- [ ] **Step 5: 커밋**

```bash
git add worker/src/briefing.ts worker/test/briefing.test.ts
git commit -m "feat: 브리핑 메시지에 시간대별·옷차림·행운색 통합"
```

---

### Task 7: 전체 회귀 + 타입 게이트 + README 예시 갱신

**Files:**
- Modify: `README.md` (브리핑 예시 블록)
- 전체 테스트/타입 검증

- [ ] **Step 1: 전체 테스트 실행**

Run: `cd worker && npm test`
Expected: 전체 PASS (기존 37개 + 신규 추가분). 실패 시 해당 Task로 돌아가 수정.

- [ ] **Step 2: 타입 게이트**

Run: `cd worker && npx tsc --noEmit`
Expected: 에러 0건. (특히 `Weather`에 `hourly` 추가로 인한 누락 없는지)

- [ ] **Step 3: README 예시 갱신**

`README.md`의 브리핑 예시 코드블록(상단 ``` 블록)을 아래로 교체:

```
🌅 6월 15일 강남구 아침 브리핑

☔ 오늘 비 소식 있어요! (14시~18시, 강수확률 최대 80%) 우산 꼭 챙기세요!
🌡 최저 19°C / 최고 32°C
⏰ 6시 19° · 9시 23° · 12시 28° · 15시 32° · 18시 27° · 21시 22°
👕 옷차림: 맨투맨·얇은 니트·가디건 ~ 민소매·반팔·반바지
하늘: 흐림 ☁️

미세먼지(PM10): 45㎍/㎥ · 보통 🔵
초미세먼지(PM2.5): 22㎍/㎥ · 보통 🔵

🎨 오늘의 행운 색: 청록 🩵

좋은 하루 보내세요! 💪
```

- [ ] **Step 4: 커밋**

```bash
git add README.md
git commit -m "docs: README 브리핑 예시에 신규 항목 반영"
```

---

## 비고 (코드 외 작업, 사용자 수동)

- **GitHub 저장소명 변경**: `seoul-morning-bot` → `korea-weather-briefing-bot` (Settings → Repository name). 변경 후 로컬 remote URL도 `git remote set-url origin <새 URL>` 갱신 필요. — 코드 변경 아님, 본 계획 범위 밖.

## Self-Review 결과

- **스펙 커버리지**: 시간대별(Task 1,3,6) / 옷차림(Task 4,6) / 행운색(Task 5,6) / 최저·최고 fallback(Task 1,2,6) / README·이름(Task 7, 비고) — 모두 매핑됨.
- **플레이스홀더**: 없음(모든 코드 블록 실제 내용).
- **타입 일관성**: `Weather.hourly: Record<string,number>`를 Task1에서 정의 후 2·3·6에서 동일 사용. `resolveLowHigh`/`formatHourly`/`clothingFor`/`clothingRange`/`pickLuckyColor` 시그니처 Task 정의와 buildMessage 사용 일치. `buildMessage` 신규 7번째 인자 `rand`는 선택(기본값)이라 `runBriefing` 기존 호출 무변경.
