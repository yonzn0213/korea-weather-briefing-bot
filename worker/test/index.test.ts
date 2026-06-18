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
    expect(fn).toHaveBeenCalled();
  });

  it("핸들러 예외에도 200 반환", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }))));
    const res = await worker.fetch(
      post({ message: { chat: { id: 1 }, message_id: 1, text: "/start" } }, "SEKRET"),
      env(), ctx);
    expect(res.status).toBe(200);
  });
});

describe("scheduled cron 분기", () => {
  function stubApis() {
    const fn = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("getVilageFcst")) return new Response(JSON.stringify({ response: { body: { items: { item: [] } } } }));
      if (u.includes("getUltraSrtFcst")) return new Response(JSON.stringify({ response: { body: { items: { item: [] } } } }));
      if (u.includes("ArpltnInforInqireSvc")) return new Response(JSON.stringify({ response: { body: { items: [] } } }));
      return new Response(JSON.stringify({ ok: true, result: {} }));
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }
  const calledWith = (fn: any, needle: string) => fn.mock.calls.some((c: any[]) => String(c[0]).includes(needle));

  // KST 7시 = UTC 22:00, KST 10시 = UTC 01:00
  const KST7 = Date.parse("2026-06-12T22:00:00Z");
  const KST10 = Date.parse("2026-06-18T01:00:00Z");

  it("그 시각(briefHour) 유저에게 브리핑 발송(getVilageFcst)", async () => {
    const e = env();
    await e.USERS.put("1", JSON.stringify({ regions: [{ sido: "서울특별시", sigungu: "강남구" }], name: "철수", rainAlert: false, briefHour: 7 }));
    const fn = stubApis();
    await worker.scheduled({ cron: "0 * * * *", scheduledTime: KST7 } as any, e, ctx);
    expect(calledWith(fn, "getVilageFcst")).toBe(true);   // 7시 유저 브리핑
    expect(calledWith(fn, "getUltraSrtFcst")).toBe(false); // 비 알람 옵트인 아님
  });

  it("브리핑 시각이 아니면 비 알람만(브리핑 스킵)", async () => {
    const e = env();
    await e.USERS.put("1", JSON.stringify({ regions: [{ sido: "서울특별시", sigungu: "강남구" }], name: "철수", rainAlert: true, briefHour: 7 }));
    const fn = stubApis();
    await worker.scheduled({ cron: "0 * * * *", scheduledTime: KST10 } as any, e, ctx); // KST10 ≠ briefHour 7
    expect(calledWith(fn, "getVilageFcst")).toBe(false);  // 10시엔 7시 유저 대상 아님
    expect(calledWith(fn, "getUltraSrtFcst")).toBe(true);  // 비 알람은 동작
  });

  it("발송 실패 시 ADMIN_CHAT_ID로 운영 경보(dead-man switch)", async () => {
    const e: Env = { ...env(), ADMIN_CHAT_ID: "999" };
    await e.USERS.put("1", JSON.stringify({ regions: [{ sido: "서울특별시", sigungu: "강남구" }], name: "철수", briefHour: 7 }));
    // 텔레그램 발송이 실패(ok:false)하도록 → 브리핑 sent 0 / failed 발생
    const fn = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("getVilageFcst")) return new Response(JSON.stringify({ response: { body: { items: { item: [] } } } }));
      if (u.includes("ArpltnInforInqireSvc")) return new Response(JSON.stringify({ response: { body: { items: [] } } }));
      return new Response(JSON.stringify({ ok: false }));
    });
    vi.stubGlobal("fetch", fn);
    await worker.scheduled({ cron: "0 * * * *", scheduledTime: KST7 } as any, e, ctx);
    const adminCall = fn.mock.calls
      .map((c: any[]) => { try { return JSON.parse(c[1].body); } catch { return {}; } })
      .find((b: any) => b.chat_id === "999" && typeof b.text === "string" && b.text.includes("⚠️"));
    expect(adminCall).toBeTruthy();
  });

  it("ADMIN_CHAT_ID 없으면 경보 안 보냄", async () => {
    const e = env(); // ADMIN_CHAT_ID 미설정
    await e.USERS.put("1", JSON.stringify({ regions: [{ sido: "서울특별시", sigungu: "강남구" }], name: "철수", briefHour: 7 }));
    const fn = vi.fn(async () => new Response(JSON.stringify({ ok: false })));
    vi.stubGlobal("fetch", fn);
    await worker.scheduled({ cron: "0 * * * *", scheduledTime: KST7 } as any, e, ctx);
    const adminCall = fn.mock.calls
      .map((c: any[]) => { try { return JSON.parse(c[1].body); } catch { return {}; } })
      .find((b: any) => b.chat_id === "999");
    expect(adminCall).toBeFalsy();
  });
});
