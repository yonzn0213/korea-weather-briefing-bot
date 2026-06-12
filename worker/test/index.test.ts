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
