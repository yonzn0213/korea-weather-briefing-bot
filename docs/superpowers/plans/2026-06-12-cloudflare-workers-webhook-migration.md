# Cloudflare Workers Webhook 이전 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Python+GitHub Actions 폴링 봇을 Cloudflare Workers(webhook + Cron Trigger) + KV로 전면 이전해 `/start`를 즉시 처리한다.

**Architecture:** 단일 Worker가 `fetch`(텔레그램 webhook 즉시 처리)와 `scheduled`(매일 KST 07:00 브리핑)를 담당. 유저 상태는 Cloudflare KV에 유저당 키 1개로 비공개 저장. 무료 subrequest 한도(50)를 예산 카운터로 보호하고, webhook은 secret token으로 검증한다.

**Tech Stack:** TypeScript, Cloudflare Workers, Workers KV, wrangler, vitest. (로컬: Node v20, npm 설치됨)

---

## File Structure

| 파일 | 책임 | 신규/수정 |
|------|------|-----------|
| `worker/package.json`, `worker/tsconfig.json` | 빌드·타입·테스트 설정 | 신규 |
| `worker/wrangler.toml` | Worker 설정(KV 바인딩, cron) | 신규 |
| `worker/regions.json` | 루트 regions.json 복사(번들) | 신규(복사) |
| `worker/src/types.ts` | `Env`, `User`, 텔레그램 Update 최소 타입 | 신규 |
| `worker/src/regions.ts` | regions 로드 + 키보드 + resolveRegion | 신규 |
| `worker/src/store.ts` | KV 래퍼(getUser/putUser/deleteUser/listUsers) | 신규 |
| `worker/src/telegram.ts` | 텔레그램 API 헬퍼 | 신규 |
| `worker/src/register.ts` | handleMessage/handleCallback | 신규 |
| `worker/src/briefing.ts` | 날씨/미세먼지/메시지/runBriefing(예산) | 신규 |
| `worker/src/index.ts` | 진입점(fetch webhook + scheduled) | 신규 |
| `worker/test/*.test.ts` | vitest 단위 테스트 | 신규 |
| `register.py`,`briefing.py`,`common.py`,`state.json`,`tests/`,`.github/workflows/` | Workers로 대체 → 제거 | 삭제 |
| `README.md` | Workers 운영 기준 갱신 | 수정 |

**인터페이스 계약 (모든 태스크 공유)**
- `Env`: `{ USERS: KVNamespace; TELEGRAM_BOT_TOKEN: string; DATA_GO_KR_KEY: string; WEBHOOK_SECRET: string }`
- `User`: `{ sido: string; sigungu: string; name: string }`
- `regions.ts`: `REGIONS`, `SIDO_LIST: string[]`, `sigunguNames(sido): string[]`, `sidoKeyboard()`, `sigunguKeyboard(sidoIdx)`, `resolveRegion(sidoIdx, sigunguIdx): [string,string]`(범위 밖 RangeError)
- `store.ts`: `getUser(env,chatId): Promise<User|null>`, `putUser(env,chatId,user): Promise<void>`, `deleteUser(env,chatId): Promise<boolean>`, `listUsers(env): Promise<{chatId:string,user:User}[]>`
- `telegram.ts`: `sendMessage(token,chatId,text,extra?)`, `answerCallback(token,id,text?)`, `editMessageText(token,chatId,messageId,text,extra?)`
- `register.ts`: `handleMessage(env,msg)`, `handleCallback(env,cq)`
- `briefing.ts`: `fetchWeather(key,nx,ny,now)`, `fetchDust(key,sidoName)`, `dustFor(sigungu,dust)`, `buildMessage(now,sido,sigungu,w,d,isAvg)`, `runBriefing(env,now)`
- KV 값은 JSON 문자열. callback_data 인코딩은 기존과 동일(`s:{i}` / `r:{i}:{j}` / `s:back`).

---

## Task 1: Worker 스캐폴딩 + 도구 설치

**Files:**
- Create: `worker/package.json`, `worker/tsconfig.json`, `worker/wrangler.toml`, `worker/regions.json`, `worker/test/smoke.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: .gitignore에 Worker 산출물 추가**

`.gitignore`에 아래 줄을 추가:
```
node_modules/
worker/node_modules/
worker/.wrangler/
worker/.dev.vars
```

- [ ] **Step 2: package.json 작성**

`worker/package.json`:
```json
{
  "name": "korea-weather-bot",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250906.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.80.0"
  }
}
```

- [ ] **Step 3: tsconfig.json 작성**

`worker/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "es2022",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "types": ["@cloudflare/workers-types"],
    "resolveJsonModule": true,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: wrangler.toml 작성**

`worker/wrangler.toml` (`id`는 배포 태스크에서 채움 — 지금은 자리표시):
```toml
name = "korea-weather-bot"
main = "src/index.ts"
compatibility_date = "2025-09-01"

kv_namespaces = [
  { binding = "USERS", id = "REPLACE_WITH_KV_ID" }
]

[triggers]
crons = ["0 22 * * *"]
```

- [ ] **Step 5: regions.json 복사**

루트 `regions.json`을 `worker/regions.json`으로 복사한다.
Run (bash): `cp regions.json worker/regions.json`
확인: `worker/regions.json`의 최상위 키가 17개인지.

- [ ] **Step 6: 의존성 설치 + 스모크 테스트 작성**

`worker/test/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("toolchain", () => {
  it("vitest 동작", () => {
    expect(1 + 1).toBe(2);
  });
});
```
Run (worker 디렉터리에서): `npm install`
Expected: 설치 완료(경고는 무방).

- [ ] **Step 7: 테스트 실행**

Run (worker 디렉터리에서): `npm test`
Expected: `1 passed`.

- [ ] **Step 8: 커밋**

```bash
git add .gitignore worker/package.json worker/tsconfig.json worker/wrangler.toml worker/regions.json worker/test/smoke.test.ts worker/package-lock.json
git commit -m "chore: Cloudflare Worker 스캐폴딩"
```

---

## Task 2: types + regions 모듈

**Files:**
- Create: `worker/src/types.ts`, `worker/src/regions.ts`, `worker/test/regions.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`worker/test/regions.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  REGIONS, SIDO_LIST, sigunguNames,
  sidoKeyboard, sigunguKeyboard, resolveRegion,
} from "../src/regions";

describe("regions", () => {
  it("시도 17개", () => {
    expect(SIDO_LIST.length).toBe(17);
  });

  it("서울 종로구 좌표", () => {
    expect(REGIONS["서울특별시"].sigungu["종로구"]).toEqual({ nx: 60, ny: 127 });
  });

  it("세종 존재 + airkorea", () => {
    expect(REGIONS["세종특별자치시"].airkorea).toBe("세종");
  });

  it("좌표 범위 정상", () => {
    for (const sido of SIDO_LIST) {
      expect(REGIONS[sido].airkorea).toBeTruthy();
      for (const g of Object.values(REGIONS[sido].sigungu)) {
        expect(g.nx).toBeGreaterThanOrEqual(1);
        expect(g.nx).toBeLessThanOrEqual(150);
        expect(g.ny).toBeGreaterThanOrEqual(1);
        expect(g.ny).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("keyboard", () => {
  it("시도 키보드 전체 포함 + s:0", () => {
    const kb = sidoKeyboard();
    const buttons = kb.inline_keyboard.flat();
    expect(buttons.length).toBe(SIDO_LIST.length);
    expect(buttons[0].callback_data).toBe("s:0");
  });

  it("시도 키보드 3열 이하", () => {
    const kb = sidoKeyboard();
    expect(kb.inline_keyboard.every((row) => row.length <= 3)).toBe(true);
  });

  it("시군구 키보드 뒤로버튼 + r:0:0", () => {
    const kb = sigunguKeyboard(0);
    const flat = kb.inline_keyboard.flat();
    expect(flat.some((b) => b.callback_data === "s:back")).toBe(true);
    const first = flat.find((b) => b.callback_data.startsWith("r:"))!;
    expect(first.callback_data).toBe("r:0:0");
  });

  it("콜백 라운드트립", () => {
    const sido = SIDO_LIST[1];
    const sg = sigunguNames(sido)[0];
    expect(resolveRegion(1, 0)).toEqual([sido, sg]);
  });

  it("범위 밖은 RangeError", () => {
    expect(() => resolveRegion(999, 0)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run (worker): `npm test -- regions`
Expected: FAIL — `Cannot find module '../src/regions'`.

- [ ] **Step 3: types.ts 구현**

`worker/src/types.ts`:
```ts
export interface Env {
  USERS: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  DATA_GO_KR_KEY: string;
  WEBHOOK_SECRET: string;
}

export interface User {
  sido: string;
  sigungu: string;
  name: string;
}

export interface TgChat { id: number | string; }
export interface TgUser { first_name?: string; }
export interface TgMessage { chat: TgChat; message_id: number; text?: string; }
export interface TgCallback {
  id: string;
  data?: string;
  message: TgMessage;
  from?: TgUser;
}
export interface TgUpdate {
  message?: TgMessage;
  callback_query?: TgCallback;
}

export interface InlineButton { text: string; callback_data: string; }
export interface InlineKeyboard { inline_keyboard: InlineButton[][]; }
```

- [ ] **Step 4: regions.ts 구현**

`worker/src/regions.ts`:
```ts
import regionsData from "../regions.json";
import type { InlineButton, InlineKeyboard } from "./types";

interface Grid { nx: number; ny: number; }
interface Sido { airkorea: string; sigungu: Record<string, Grid>; }

export const REGIONS = regionsData as unknown as Record<string, Sido>;
export const SIDO_LIST: string[] = Object.keys(REGIONS);

export function sigunguNames(sido: string): string[] {
  return Object.keys(REGIONS[sido].sigungu);
}

function rows(buttons: InlineButton[], cols = 3): InlineButton[][] {
  const out: InlineButton[][] = [];
  for (let i = 0; i < buttons.length; i += cols) {
    out.push(buttons.slice(i, i + cols));
  }
  return out;
}

export function sidoKeyboard(): InlineKeyboard {
  const buttons = SIDO_LIST.map((s, i) => ({ text: s, callback_data: `s:${i}` }));
  return { inline_keyboard: rows(buttons) };
}

export function sigunguKeyboard(sidoIdx: number): InlineKeyboard {
  const sido = SIDO_LIST[sidoIdx];
  if (sido === undefined) throw new RangeError(`잘못된 시도 인덱스: ${sidoIdx}`);
  const buttons = sigunguNames(sido).map((n, j) => ({
    text: n,
    callback_data: `r:${sidoIdx}:${j}`,
  }));
  const kb = rows(buttons);
  kb.push([{ text: "⬅ 뒤로", callback_data: "s:back" }]);
  return { inline_keyboard: kb };
}

export function resolveRegion(sidoIdx: number, sigunguIdx: number): [string, string] {
  const sido = SIDO_LIST[sidoIdx];
  if (sido === undefined) throw new RangeError(`잘못된 시도 인덱스: ${sidoIdx}`);
  const sigungu = sigunguNames(sido)[sigunguIdx];
  if (sigungu === undefined) throw new RangeError(`잘못된 시군구 인덱스: ${sigunguIdx}`);
  return [sido, sigungu];
}
```

- [ ] **Step 5: 통과 확인**

Run (worker): `npm test -- regions`
Expected: 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add worker/src/types.ts worker/src/regions.ts worker/test/regions.test.ts
git commit -m "feat: Worker regions 모듈 + 키보드"
```

---

## Task 3: store 모듈 (KV 래퍼)

**Files:**
- Create: `worker/src/store.ts`, `worker/test/store.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (in-memory KV mock)**

`worker/test/store.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getUser, putUser, deleteUser, listUsers } from "../src/store";
import type { Env, User } from "../src/types";

function fakeKV() {
  const m = new Map<string, string>();
  return {
    async get(k: string) { return m.has(k) ? m.get(k)! : null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
    async list(opts?: { cursor?: string }) {
      return { keys: [...m.keys()].map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
}

function env(): Env {
  return { USERS: fakeKV(), TELEGRAM_BOT_TOKEN: "t", DATA_GO_KR_KEY: "k", WEBHOOK_SECRET: "s" };
}

const U: User = { sido: "서울특별시", sigungu: "강남구", name: "철수" };

describe("store", () => {
  it("put -> get 라운드트립", async () => {
    const e = env();
    await putUser(e, "100", U);
    expect(await getUser(e, "100")).toEqual(U);
  });

  it("없는 유저는 null", async () => {
    expect(await getUser(env(), "999")).toBeNull();
  });

  it("delete는 존재 여부 반환", async () => {
    const e = env();
    await putUser(e, "100", U);
    expect(await deleteUser(e, "100")).toBe(true);
    expect(await deleteUser(e, "100")).toBe(false);
    expect(await getUser(e, "100")).toBeNull();
  });

  it("listUsers 전체 반환", async () => {
    const e = env();
    await putUser(e, "1", U);
    await putUser(e, "2", { ...U, sigungu: "서초구" });
    const all = await listUsers(e);
    expect(all.length).toBe(2);
    expect(all.map((x) => x.chatId).sort()).toEqual(["1", "2"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run (worker): `npm test -- store`
Expected: FAIL — `Cannot find module '../src/store'`.

- [ ] **Step 3: store.ts 구현**

`worker/src/store.ts`:
```ts
import type { Env, User } from "./types";

export async function getUser(env: Env, chatId: string): Promise<User | null> {
  const v = await env.USERS.get(chatId);
  return v ? (JSON.parse(v) as User) : null;
}

export async function putUser(env: Env, chatId: string, user: User): Promise<void> {
  await env.USERS.put(chatId, JSON.stringify(user));
}

export async function deleteUser(env: Env, chatId: string): Promise<boolean> {
  const existed = (await env.USERS.get(chatId)) !== null;
  await env.USERS.delete(chatId);
  return existed;
}

export async function listUsers(env: Env): Promise<{ chatId: string; user: User }[]> {
  const out: { chatId: string; user: User }[] = [];
  let cursor: string | undefined;
  do {
    const res = await env.USERS.list({ cursor });
    for (const k of res.keys) {
      const v = await env.USERS.get(k.name);
      if (v) out.push({ chatId: k.name, user: JSON.parse(v) as User });
    }
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run (worker): `npm test -- store`
Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add worker/src/store.ts worker/test/store.test.ts
git commit -m "feat: KV 유저 저장소 래퍼"
```

---

## Task 4: telegram 모듈

**Files:**
- Create: `worker/src/telegram.ts`, `worker/test/telegram.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (fetch mock)**

`worker/test/telegram.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { sendMessage, answerCallback, editMessageText } from "../src/telegram";

afterEach(() => vi.unstubAllGlobals());

function mockFetchOk() {
  const fn = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} })));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("telegram", () => {
  it("sendMessage가 올바른 URL/바디로 호출", async () => {
    const fn = mockFetchOk();
    await sendMessage("TOK", "100", "안녕", { reply_markup: { inline_keyboard: [] } });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/botTOK/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ chat_id: "100", text: "안녕", parse_mode: "HTML" });
    expect(body.reply_markup).toBeDefined();
  });

  it("answerCallback text 옵션", async () => {
    const fn = mockFetchOk();
    await answerCallback("TOK", "cb1", "완료!");
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ callback_query_id: "cb1", text: "완료!" });
  });

  it("editMessageText 호출", async () => {
    const fn = mockFetchOk();
    await editMessageText("TOK", "100", 5, "수정됨");
    const [url, init] = fn.mock.calls[0];
    expect(url).toContain("editMessageText");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ chat_id: "100", message_id: 5, text: "수정됨" });
  });

  it("ok:false면 예외", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, description: "bad" }))));
    await expect(sendMessage("TOK", "100", "x")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run (worker): `npm test -- telegram`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: telegram.ts 구현**

`worker/src/telegram.ts`:
```ts
async function tgCall(token: string, method: string, payload: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean };
  if (!data.ok) throw new Error(`telegram ${method} 실패: ${JSON.stringify(data)}`);
  return data;
}

export function sendMessage(token: string, chatId: string, text: string, extra: Record<string, unknown> = {}) {
  return tgCall(token, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

export function answerCallback(token: string, callbackId: string, text?: string) {
  return tgCall(token, "answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) });
}

export function editMessageText(token: string, chatId: string, messageId: number, text: string, extra: Record<string, unknown> = {}) {
  return tgCall(token, "editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", ...extra });
}
```

- [ ] **Step 4: 통과 확인**

Run (worker): `npm test -- telegram`
Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add worker/src/telegram.ts worker/test/telegram.test.ts
git commit -m "feat: 텔레그램 API 헬퍼"
```

---

## Task 5: register 모듈 (등록/콜백)

**Files:**
- Create: `worker/src/register.ts`, `worker/test/register.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`worker/test/register.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { handleMessage, handleCallback } from "../src/register";
import { getUser } from "../src/store";
import type { Env, User } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

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
function captureFetch() {
  const fn = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} })));
  vi.stubGlobal("fetch", fn);
  return fn;
}
function bodies(fn: ReturnType<typeof captureFetch>) {
  return fn.mock.calls.map((c) => ({
    method: (c[0] as string).split("/bot TOK/").pop() ?? (c[0] as string),
    url: c[0] as string,
    body: JSON.parse((c[1] as RequestInit).body as string),
  }));
}

describe("handleMessage", () => {
  it("/start는 시도 키보드 전송", async () => {
    const fn = captureFetch();
    await handleMessage(env(), { chat: { id: 100 }, message_id: 1, text: "/start" });
    const b = bodies(fn);
    expect(b[0].url).toContain("sendMessage");
    expect(b[0].body.reply_markup.inline_keyboard.flat()[0].callback_data).toBe("s:0");
  });

  it("/stop은 미등록시 안내", async () => {
    const fn = captureFetch();
    await handleMessage(env(), { chat: { id: 100 }, message_id: 1, text: "/stop" });
    expect(bodies(fn)[0].body.text).toContain("등록된 알림이 없");
  });

  it("등록 유저 일반 메시지는 HELP", async () => {
    const e = env();
    await e.USERS.put("100", JSON.stringify({ sido: "서울특별시", sigungu: "강남구", name: "철수" } as User));
    const fn = captureFetch();
    await handleMessage(e, { chat: { id: 100 }, message_id: 1, text: "안녕" });
    expect(bodies(fn)[0].body.text).toContain("서울특별시 강남구");
  });
});

describe("handleCallback", () => {
  it("s:0 -> 시군구 키보드로 편집", async () => {
    const fn = captureFetch();
    await handleCallback(env(), { id: "c1", data: "s:0", message: { chat: { id: 100 }, message_id: 7 } });
    const editCall = bodies(fn).find((x) => x.url.includes("editMessageText"))!;
    expect(editCall.body.reply_markup.inline_keyboard.flat().some((x: any) => x.callback_data === "s:back")).toBe(true);
  });

  it("r:0:0 -> 유저 저장 + 확정", async () => {
    const e = env();
    const fn = captureFetch();
    await handleCallback(e, { id: "c2", data: "r:0:0", message: { chat: { id: 100 }, message_id: 7 }, from: { first_name: "철수" } });
    const saved = await getUser(e, "100");
    expect(saved).not.toBeNull();
    expect(saved!.sido).toBe("서울특별시");
    expect(bodies(fn).some((x) => x.url.includes("sendMessage") && x.body.text.includes("등록 완료"))).toBe(true);
  });

  it("s:back -> 시도 키보드 복귀", async () => {
    const fn = captureFetch();
    await handleCallback(env(), { id: "c3", data: "s:back", message: { chat: { id: 100 }, message_id: 7 } });
    const editCall = bodies(fn).find((x) => x.url.includes("editMessageText"))!;
    expect(editCall.body.reply_markup.inline_keyboard.flat()[0].callback_data).toBe("s:0");
  });

  it("잘못된 콜백은 안내", async () => {
    const fn = captureFetch();
    await handleCallback(env(), { id: "c4", data: "r:999:0", message: { chat: { id: 100 }, message_id: 7 } });
    const ans = bodies(fn).find((x) => x.url.includes("answerCallbackQuery"))!;
    expect(ans.body.text).toContain("알 수 없는");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run (worker): `npm test -- register`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: register.ts 구현**

`worker/src/register.ts`:
```ts
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
```

- [ ] **Step 4: 통과 확인**

Run (worker): `npm test -- register`
Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add worker/src/register.ts worker/test/register.test.ts
git commit -m "feat: webhook 등록/콜백 처리"
```

---

## Task 6: briefing 모듈 (날씨/미세먼지 + 예산)

**Files:**
- Create: `worker/src/briefing.ts`, `worker/test/briefing.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`worker/test/briefing.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { dustFor, buildMessage, gradePm10 } from "../src/briefing";

afterEach(() => vi.unstubAllGlobals());

const DUST = {
  stations: { "강남구": { pm10: 40, pm25: 20 } },
  avg: { pm10: 55, pm25: 30 },
};

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
  const W = { popMax: 80, rainHours: [["1400", "비"], ["1500", "비"]] as [string, string][], tmn: 19, tmx: 26, sky: "흐림 ☁️" };

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
```

- [ ] **Step 2: 실패 확인**

Run (worker): `npm test -- briefing`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: briefing.ts 구현**

`worker/src/briefing.ts`:
```ts
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
  const items = j.response.body.items.item as any[];
  const data: Weather = { popMax: 0, rainHours: [], tmn: null, tmx: null, sky: null };
  for (const it of items) {
    if (it.fcstDate !== today) continue;
    const { category: cat, fcstValue: val, fcstTime: t } = it;
    if (cat === "POP") data.popMax = Math.max(data.popMax, parseInt(val, 10));
    else if (cat === "PTY" && val !== "0") data.rainHours.push([t, PTY_LABEL[val] || "강수"]);
    else if (cat === "TMN") data.tmn = parseFloat(val);
    else if (cat === "TMX") data.tmx = parseFloat(val);
    else if (cat === "SKY" && t === "1200") data.sky = SKY_LABEL[val] || "";
  }
  return data;
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

export async function runBriefing(env: Env, now: Date): Promise<{ sent: number; failed: number; skipped: number }> {
  const users = await listUsers(env);
  const weatherCache = new Map<string, Weather | null>();
  const dustCache = new Map<string, Dust | null>();
  let subreq = 0;
  let sent = 0, failed = 0, skipped = 0;

  for (let i = 0; i < users.length; i++) {
    const { chatId, user } = users[i];
    const { sido, sigungu } = user;
    if (!REGIONS[sido] || !REGIONS[sido].sigungu[sigungu]) continue;

    const g = REGIONS[sido].sigungu[sigungu];
    const gridKey = `${g.nx},${g.ny}`;
    const airkorea = REGIONS[sido].airkorea;

    // 이번 유저가 새로 호출할 외부요청 수 추정 (날씨 + 미세먼지 + 발송)
    const need = (weatherCache.has(gridKey) ? 0 : 1) + (dustCache.has(airkorea) ? 0 : 1) + 1;
    if (subreq + need > MAX_SUBREQUESTS) {
      skipped = users.length - i;
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
```

- [ ] **Step 4: 통과 확인**

Run (worker): `npm test -- briefing`
Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add worker/src/briefing.ts worker/test/briefing.test.ts
git commit -m "feat: 브리핑 로직 + subrequest 예산 가드"
```

---

## Task 7: index.ts 진입점 (webhook 검증 + scheduled)

**Files:**
- Create: `worker/src/index.ts`, `worker/test/index.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (fetch 핸들러)**

`worker/test/index.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

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
  return { USERS: fakeKV(), TELEGRAM_BOT_TOKEN: "TOK", DATA_GO_KR_KEY: "k", WEBHOOK_SECRET: "SEKRET" };
}
const ctx = {} as ExecutionContext;

function post(body: unknown, secret?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== undefined) headers["X-Telegram-Bot-Api-Secret-Token"] = secret;
  return new Request("https://w/", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("fetch webhook", () => {
  it("secret token 불일치는 403, 핸들러 미실행", async () => {
    const fn = vi.fn();
    vi.stubGlobal("fetch", fn);
    const res = await worker.fetch(post({ message: {} }, "WRONG"), env(), ctx);
    expect(res.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });

  it("GET은 200 no-op", async () => {
    const res = await worker.fetch(new Request("https://w/", { method: "GET" }), env(), ctx);
    expect(res.status).toBe(200);
  });

  it("올바른 secret + message는 처리 후 200", async () => {
    const fn = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} })));
    vi.stubGlobal("fetch", fn);
    const res = await worker.fetch(
      post({ message: { chat: { id: 1 }, message_id: 1, text: "/start" } }, "SEKRET"),
      env(), ctx);
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalled(); // sendMessage 호출됨
  });

  it("핸들러 예외에도 200 반환", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }))));
    const res = await worker.fetch(
      post({ message: { chat: { id: 1 }, message_id: 1, text: "/start" } }, "SEKRET"),
      env(), ctx);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run (worker): `npm test -- index`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: index.ts 구현**

`worker/src/index.ts`:
```ts
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
```

- [ ] **Step 4: 통과 확인 + 전체 + 타입체크**

Run (worker): `npm test`
Expected: 전체 PASS.
Run (worker): `npx tsc --noEmit`
Expected: 타입 에러 없음(출력 없음).

- [ ] **Step 5: 커밋**

```bash
git add worker/src/index.ts worker/test/index.test.ts
git commit -m "feat: Worker 진입점(webhook 검증 + cron)"
```

---

## Task 8: 구 Python/Actions 제거 + README 갱신

**Files:**
- Delete: `register.py`, `briefing.py`, `common.py`, `state.json`, `tests/__init__.py`, `tests/test_grid.py`, `tests/test_regions.py`, `tests/test_keyboard.py`, `tests/test_dust.py`, `.github/workflows/register.yml`, `.github/workflows/daily-briefing.yml`
- Keep: `regions.json`, `tools/build_regions.py`, `tools/sigungu_src.json`
- Modify: `README.md`

- [ ] **Step 1: 구 런타임 파일 제거**

```bash
git rm register.py briefing.py common.py state.json
git rm tests/__init__.py tests/test_grid.py tests/test_regions.py tests/test_keyboard.py tests/test_dust.py
git rm .github/workflows/register.yml .github/workflows/daily-briefing.yml
```
(`requirements.txt`는 `tools/build_regions.py`가 표준 라이브러리만 쓰므로 함께 제거: `git rm requirements.txt`)

- [ ] **Step 2: README 갱신**

`README.md`를 아래 핵심으로 수정한다(사용법 섹션은 그대로 유지, 운영/구조만 교체):
- 소개에 "Cloudflare Workers webhook으로 즉시 응답" 추가
- "구조" 표를 worker/ 기준으로 교체:
  ```markdown
  | 파일 | 역할 |
  |------|------|
  | `worker/src/index.ts` | webhook(즉시 등록) + cron(일일 브리핑) 진입점 |
  | `worker/src/register.ts` | 시도/시군구 2단계 등록·변경·해지 |
  | `worker/src/briefing.ts` | 유저별 날씨/미세먼지 브리핑 (subrequest 예산 가드) |
  | `worker/src/regions.ts` | regions.json 로드 + 키보드 |
  | `worker/src/store.ts` | Cloudflare KV 유저 저장소 |
  | `regions.json` / `tools/build_regions.py` | 전국 시군구 격자좌표 + 생성 도구 |
  ```
- "직접 운영하기" 섹션을 Cloudflare Workers 배포로 교체:
  ```markdown
  ### 자체 호스팅 (Cloudflare Workers)
  1. Cloudflare 무료 계정 + `npm i -g wrangler` → `wrangler login`
  2. `cd worker && npm install`
  3. `wrangler kv namespace create USERS` → 출력된 id를 `worker/wrangler.toml`의 `REPLACE_WITH_KV_ID`에 기입
  4. 시크릿 등록: `wrangler secret put TELEGRAM_BOT_TOKEN`, `DATA_GO_KR_KEY`, `WEBHOOK_SECRET`(임의 난수 문자열)
  5. `wrangler deploy` → 출력된 Worker URL 확인
  6. webhook 등록:
     `curl "https://api.telegram.org/bot<토큰>/setWebhook" -d "url=<WorkerURL>" -d "secret_token=<WEBHOOK_SECRET와 동일>"`
  7. 텔레그램에서 /start → 즉시 응답 확인. 일일 브리핑은 매일 22:00 UTC(KST 07:00) 자동 실행.
  ```
- 운영 참고: GitHub Actions/state.json 관련 설명 제거. "무료 한도: Workers 무료 플랜은 요청당 subrequest 50개라 일일 브리핑은 약 40~45명까지 안전(초과 시 로그로 표시·유료 전환 가능)" 추가.

- [ ] **Step 3: 잔존 참조 점검**

Run (bash, 루트): `grep -rEi "state.json|getUpdates|region_keyboard" --include=*.md --include=*.py . || echo "clean"`
Expected: README/Python에 구 폴링 참조 없음(설계/플랜 문서의 설명 언급은 무방).

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "refactor: Python/Actions 제거, README를 Workers 기준으로"
```

---

## Task 9: 배포 (대화형 — 사용자 안내 필요)

> 이 태스크는 Cloudflare 계정·wrangler 로그인이 필요해 자동화 불가. 오케스트레이터가 사용자와 함께 단계별로 진행한다. 코드(Task 1~8)가 끝나고 테스트가 모두 통과한 뒤에만 시작.

- [ ] **Step 1: 계정 + wrangler**

사용자: Cloudflare 무료 계정 생성. 터미널에서 `npm i -g wrangler` 후 `wrangler login`(브라우저 인증).

- [ ] **Step 2: KV 네임스페이스 생성**

`cd worker && wrangler kv namespace create USERS` → 출력 `id`를 `worker/wrangler.toml`의 `REPLACE_WITH_KV_ID`에 기입 후 커밋(`chore: KV namespace id 설정`).

- [ ] **Step 3: 시크릿 등록**

```bash
wrangler secret put TELEGRAM_BOT_TOKEN   # 기존 봇 토큰
wrangler secret put DATA_GO_KR_KEY       # 공공데이터포털 Decoding 키
wrangler secret put WEBHOOK_SECRET       # 임의 난수(예: openssl rand -hex 16)
```

- [ ] **Step 4: 배포**

`wrangler deploy` → 출력된 `https://korea-weather-bot.<subdomain>.workers.dev` URL 확보.

- [ ] **Step 5: webhook 등록 (폴링 폐기)**

```bash
curl "https://api.telegram.org/bot<토큰>/setWebhook" \
  -d "url=<WorkerURL>" -d "secret_token=<WEBHOOK_SECRET>"
```
응답 `{"ok":true,"result":true,...}` 확인. (이 시점에 기존 getUpdates 폴링은 자동 무효화)

- [ ] **Step 6: 종단 확인**

- 텔레그램 `/start` → **즉시** 시도 키보드 → 시도→시군구 선택 → 즉시 확정.
- `wrangler tail`로 로그 확인.
- 브리핑 즉시 테스트: 임시로 `crons`를 가까운 시각으로 바꿔 1회 확인하거나, `wrangler dev` 후 scheduled 트리거. 확인 후 `0 22 * * *`로 복귀.
- `getWebhookInfo`로 `pending_update_count`/`last_error_message` 점검:
  `curl "https://api.telegram.org/bot<토큰>/getWebhookInfo"`

---

## Self-Review 결과

- **Spec 커버리지**: 단일 Worker fetch/scheduled(Task7), KV 유저당 키(Task3), 즉시 등록(Task5), 브리핑(Task6), subrequest 예산 가드(Task6 `MAX_SUBREQUESTS`), webhook secret 검증(Task7), 시크릿/로그 위생·입력검증(Task7/5), 테스트(Task2~7), 구 런타임 제거·README(Task8), 배포/마이그레이션(Task9) — 전부 태스크 존재.
- **Placeholder 스캔**: `wrangler.toml`의 `REPLACE_WITH_KV_ID`는 배포 태스크(Task9 Step2)에서 채우는 의도된 자리표시이며 코드 단계엔 영향 없음. 그 외 코드/명령은 모두 구체값.
- **타입/시그니처 일관성**: `Env`/`User`/`Weather`/`Dust`/`DustVal`, `resolveRegion`(RangeError), `dustFor`/`buildMessage`/`runBriefing`, store 4함수, telegram 3함수가 인터페이스 계약과 Task 간 일치 확인.
- **한계 명시**: subrequest 예산 초과 시 남은 유저를 `skipped`로 로깅(무음 누락 아님). 무료 ~45명 한도 README·spec 명시.
