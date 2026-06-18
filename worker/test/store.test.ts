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

const U: User = { regions: [{ sido: "서울특별시", sigungu: "강남구" }], name: "철수", rainAlert: false };

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
    await putUser(e, "2", { ...U, regions: [{ sido: "서울특별시", sigungu: "서초구" }] });
    const all = await listUsers(e);
    expect(all.length).toBe(2);
    expect(all.map((x) => x.chatId).sort()).toEqual(["1", "2"]);
  });

  it("레거시 단일 지역 스키마를 regions[]로 변환해 읽는다", async () => {
    const e = env();
    // 예전 버전이 저장한 형태
    await e.USERS.put("9", JSON.stringify({ sido: "부산광역시", sigungu: "해운대구", name: "영희" }));
    const u = await getUser(e, "9");
    expect(u).toEqual({ regions: [{ sido: "부산광역시", sigungu: "해운대구" }], name: "영희", rainAlert: false });
  });

  it("두 지역 유저도 그대로 읽는다", async () => {
    const e = env();
    const two: User = { regions: [{ sido: "서울특별시", sigungu: "강남구" }, { sido: "부산광역시", sigungu: "해운대구" }], name: "철수", rainAlert: true };
    await putUser(e, "5", two);
    expect(await getUser(e, "5")).toEqual(two);
  });
});
