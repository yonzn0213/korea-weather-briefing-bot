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
    const editCall = bodies(fn).find((x) => x.url.includes("editMessageText"));
    expect(editCall.body.reply_markup.inline_keyboard.flat().some((x) => x.callback_data === "s:back")).toBe(true);
  });

  it("r:0:0 -> 유저 저장 + 확정", async () => {
    const e = env();
    const fn = captureFetch();
    await handleCallback(e, { id: "c2", data: "r:0:0", message: { chat: { id: 100 }, message_id: 7 }, from: { first_name: "철수" } });
    const saved = await getUser(e, "100");
    expect(saved).not.toBeNull();
    expect(saved.sido).toBe("서울특별시");
    expect(bodies(fn).some((x) => x.url.includes("sendMessage") && x.body.text.includes("등록 완료"))).toBe(true);
  });

  it("s:back -> 시도 키보드 복귀", async () => {
    const fn = captureFetch();
    await handleCallback(env(), { id: "c3", data: "s:back", message: { chat: { id: 100 }, message_id: 7 } });
    const editCall = bodies(fn).find((x) => x.url.includes("editMessageText"));
    expect(editCall.body.reply_markup.inline_keyboard.flat()[0].callback_data).toBe("s:0");
  });

  it("잘못된 콜백은 안내", async () => {
    const fn = captureFetch();
    await handleCallback(env(), { id: "c4", data: "r:999:0", message: { chat: { id: 100 }, message_id: 7 } });
    const ans = bodies(fn).find((x) => x.url.includes("answerCallbackQuery"));
    expect(ans.body.text).toContain("알 수 없는");
  });
});
