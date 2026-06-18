import type { Env, User } from "./types";

// 레거시 단일 지역 스키마({sido,sigungu,name})를 regions[] 스키마로 변환.
// 기존 KV에 저장된 유저를 일괄 마이그레이션 없이 그대로 읽기 위함.
export function normalizeUser(raw: any): User {
  if (raw && Array.isArray(raw.regions)) {
    return { rainAlert: false, ...raw } as User;
  }
  const regions = raw?.sido ? [{ sido: raw.sido, sigungu: raw.sigungu }] : [];
  return { regions, name: raw?.name ?? "", rainAlert: raw?.rainAlert ?? false };
}

export async function getUser(env: Env, chatId: string): Promise<User | null> {
  const v = await env.USERS.get(chatId);
  return v ? normalizeUser(JSON.parse(v)) : null;
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
      if (v) out.push({ chatId: k.name, user: normalizeUser(JSON.parse(v)) });
    }
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return out;
}
