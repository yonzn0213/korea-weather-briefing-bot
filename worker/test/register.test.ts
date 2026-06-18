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
function bodies(fn) {
  return fn.mock.calls.map((c) => ({
    url: c[0],
    body: JSON.parse(c[1].body),
  }));
}

describe("handleMessage", () => {
  it("/start는 신규 유저에게 시도 키보드 전송", async () => {
    const fn = captureFetch();
    await handleMessage(env(), { chat: { id: 100 }, message_id: 1, text: "/start" });
    const b = bodies(fn);
    expect(b[0].url).toContain("sendMessage");
    expect(b[0].body.reply_markup.inline_keyboard.flat()[0].callback_data).toBe("s:0:0");
  });

  it("/region은 기존 유저에게 설정 메뉴 전송", async () => {
    const e = env();
    await e.USERS.put("100", JSON.stringify({ regions: [{ sido: "서울특별시", sigungu: "강남구" }], name: "철수", rainAlert: false } as User));
    const fn = captureFetch();
    await handleMessage(e, { chat: { id: 100 }, message_id: 1, text: "/region" });
    const cbs = bodies(fn)[0].body.reply_markup.inline_keyboard.flat().map((x: any) => x.callback_data);
    expect(cbs).toContain("pick:1"); // 지역 추가
    expect(cbs).toContain("ra");     // 비 알람 토글
  });

  it("/stop은 미등록시 안내", async () => {
    const fn = captureFetch();
    await handleMessage(env(), { chat: { id: 100 }, message_id: 1, text: "/stop" });
    expect(bodies(fn)[0].body.text).toContain("등록된 알림이 없");
  });

  it("/rainalert는 미등록시 start 유도", async () => {
    const fn = captureFetch();
    await handleMessage(env(), { chat: { id: 100 }, message_id: 1, text: "/rainalert" });
    expect(bodies(fn)[0].body.text).toContain("/start");
  });

  it("/rainalert는 등록 유저의 알람을 토글", async () => {
    const e = env();
    await e.USERS.put("100", JSON.stringify({ regions: [{ sido: "서울특별시", sigungu: "강남구" }], name: "철수", rainAlert: false } as User));
    const fn = captureFetch();
    await handleMessage(e, { chat: { id: 100 }, message_id: 1, text: "/rainalert" });
    expect((await getUser(e, "100"))!.rainAlert).toBe(true);
    expect(bodies(fn)[0].body.text).toContain("켰어요");
  });

  it("레거시 유저 일반 메시지는 현황 안내", async () => {
    const e = env();
    await e.USERS.put("100", JSON.stringify({ sido: "서울특별시", sigungu: "강남구", name: "철수" }));
    const fn = captureFetch();
    await handleMessage(e, { chat: { id: 100 }, message_id: 1, text: "안녕" });
    expect(bodies(fn)[0].body.text).toContain("서울특별시 강남구");
  });
});

describe("handleCallback", () => {
  it("s:0:0 -> 시군구 키보드로 편집(b:0 뒤로 포함)", async () => {
    const fn = captureFetch();
    await handleCallback(env(), { id: "c1", data: "s:0:0", message: { chat: { id: 100 }, message_id: 7 } });
    const editCall = bodies(fn).find((x) => x.url.includes("editMessageText"));
    expect(editCall.body.reply_markup.inline_keyboard.flat().some((x) => x.callback_data === "b:0")).toBe(true);
  });

  it("r:0:0:0 -> 신규 유저 저장 + 등록 완료 안내", async () => {
    const e = env();
    const fn = captureFetch();
    await handleCallback(e, { id: "c2", data: "r:0:0:0", message: { chat: { id: 100 }, message_id: 7 }, from: { first_name: "철수" } });
    const saved = await getUser(e, "100");
    expect(saved).not.toBeNull();
    expect(saved!.regions[0].sido).toBe("서울특별시");
    expect(bodies(fn).some((x) => x.url.includes("sendMessage") && x.body.text.includes("등록 완료"))).toBe(true);
  });

  it("pick:1 + r:1:.. -> 두 번째 지역 추가", async () => {
    const e = env();
    await e.USERS.put("100", JSON.stringify({ regions: [{ sido: "서울특별시", sigungu: "강남구" }], name: "철수", rainAlert: false } as User));
    const fn = captureFetch();
    await handleCallback(e, { id: "c3", data: "r:1:1:0", message: { chat: { id: 100 }, message_id: 7 } });
    const saved = await getUser(e, "100");
    expect(saved!.regions.length).toBe(2);
    expect(saved!.regions[0].sigungu).toBe("강남구"); // 기존 유지
  });

  it("del:1 -> 두 번째 지역 삭제", async () => {
    const e = env();
    await e.USERS.put("100", JSON.stringify({ regions: [{ sido: "서울특별시", sigungu: "강남구" }, { sido: "부산광역시", sigungu: "해운대구" }], name: "철수", rainAlert: false } as User));
    const fn = captureFetch();
    await handleCallback(e, { id: "c4", data: "del:1", message: { chat: { id: 100 }, message_id: 7 } });
    const saved = await getUser(e, "100");
    expect(saved!.regions.length).toBe(1);
    expect(saved!.regions[0].sigungu).toBe("강남구");
  });

  it("마지막 1개 지역은 삭제 불가", async () => {
    const e = env();
    await e.USERS.put("100", JSON.stringify({ regions: [{ sido: "서울특별시", sigungu: "강남구" }], name: "철수", rainAlert: false } as User));
    const fn = captureFetch();
    await handleCallback(e, { id: "c5", data: "del:0", message: { chat: { id: 100 }, message_id: 7 } });
    expect((await getUser(e, "100"))!.regions.length).toBe(1);
    const ans = bodies(fn).find((x) => x.url.includes("answerCallbackQuery"));
    expect(ans.body.text).toContain("삭제할 수 없");
  });

  it("ra -> 비 알람 토글", async () => {
    const e = env();
    await e.USERS.put("100", JSON.stringify({ regions: [{ sido: "서울특별시", sigungu: "강남구" }], name: "철수", rainAlert: false } as User));
    const fn = captureFetch();
    await handleCallback(e, { id: "c6", data: "ra", message: { chat: { id: 100 }, message_id: 7 } });
    expect((await getUser(e, "100"))!.rainAlert).toBe(true);
  });

  it("b:0 -> 시도 키보드 복귀", async () => {
    const fn = captureFetch();
    await handleCallback(env(), { id: "c7", data: "b:0", message: { chat: { id: 100 }, message_id: 7 } });
    const editCall = bodies(fn).find((x) => x.url.includes("editMessageText"));
    expect(editCall.body.reply_markup.inline_keyboard.flat()[0].callback_data).toBe("s:0:0");
  });

  it("잘못된 콜백은 안내", async () => {
    const fn = captureFetch();
    await handleCallback(env(), { id: "c8", data: "r:0:999:0", message: { chat: { id: 100 }, message_id: 7 } });
    const ans = bodies(fn).find((x) => x.url.includes("answerCallbackQuery"));
    expect(ans.body.text).toContain("알 수 없는");
  });
});
