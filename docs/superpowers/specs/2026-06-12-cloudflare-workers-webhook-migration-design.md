# Cloudflare Workers Webhook 전면 이전 설계

- 날짜: 2026-06-12
- 상태: 승인됨 (구현 plan 대기)

## 배경

현재 봇은 `register.py`가 GitHub Actions cron(10분)으로 `getUpdates`를 폴링하고, `briefing.py`가 매일 cron으로 발송하며, 유저 목록을 public 저장소의 `state.json`에 커밋한다. 이 구조는 (1) `/start` 응답이 최대 10분+ 지연되고, (2) cron 자체가 수~수십 분 지연되며, (3) 유저 chat_id가 public으로 노출된다.

이를 **Cloudflare Workers + KV**로 전면 이전한다. 텔레그램 webhook으로 등록을 **즉시 처리**하고, 일일 브리핑은 Workers Cron Trigger로 발송한다. 코드는 TypeScript.

## 목표 / 비목표

**목표**
- `/start`·`/region`·`/stop`·버튼 콜백을 webhook으로 즉시 처리
- 일일 브리핑을 Workers Cron Trigger(KST 07:00)로 발송
- 유저 상태를 Cloudflare KV에 비공개 저장 (chat_id 노출 제거)
- 무료 플랜 subrequest 한도(요청당 50)를 절대 초과하지 않도록 예산 기반 처리
- webhook 보안(secret token 검증) 적용

**비목표 (YAGNI)**
- Cloudflare Queues 기반 대규모 배치 (확장 시 별도 작업으로 명시만)
- 기존 Python 런타임 유지 (GitHub Actions 워크플로·`register.py`·`briefing.py`·`common.py`·`state.json`은 제거)
- 유저 마이그레이션 (현재 등록 유저 없음)

## 핵심 결정

| 항목 | 결정 | 근거 |
|------|------|------|
| 런타임 | Cloudflare Workers (단일 Worker) | fetch(webhook) + scheduled(cron)를 한 Worker가 처리 |
| 언어 | TypeScript | Workers의 성숙한 기본 경로, wrangler 지원 |
| 상태 저장 | Cloudflare KV, **유저당 키 1개** | 동시 webhook의 read-modify-write 경합 제거 |
| 데이터 갱신 | webhook (`setWebhook`) | getUpdates 폴링 폐기 — 즉시성 |
| regions.json | Worker에 번들 import | 정적 데이터. 생성은 기존 `tools/build_regions.py` 유지 |
| 한도 안전 | subrequest 예산 추적 후 graceful 중단 | 무료 50개 한도 초과 방지 |

## 아키텍처

```
텔레그램 ──webhook POST──> Worker.fetch ──> 등록/콜백 처리 ──> KV read/write ──> 텔레그램 API 응답  (즉시)
Cron Trigger(22:00 UTC) ─> Worker.scheduled ─> KV list 유저 ─> 날씨/미세먼지(캐싱) ─> sendMessage  (일 1회)
```

- 단일 Worker, 두 핸들러(`fetch`, `scheduled`).
- KV 네임스페이스 `USERS`: `key = chat_id(string)`, `value = JSON {sido, sigungu, name}`.

## 파일 구조 (같은 repo, `worker/` 신설)

| 파일 | 책임 | 의존 |
|------|------|------|
| `worker/src/index.ts` | 진입점. fetch: webhook 검증·라우팅. scheduled: 브리핑 트리거 | register, briefing, telegram |
| `worker/src/telegram.ts` | `sendMessage`, `answerCallbackQuery`, `editMessageText`, `tgCall` | env.TELEGRAM_BOT_TOKEN |
| `worker/src/regions.ts` | regions.json import, `SIDO_LIST`, `sigunguNames`, `sidoKeyboard`, `sigunguKeyboard`, `resolveRegion` | regions.json |
| `worker/src/register.ts` | `handleMessage`, `handleCallback` (등록/변경/해지/콜백) | regions, telegram, store |
| `worker/src/briefing.ts` | `fetchWeather`, `fetchDust`, `dustFor`, `buildMessage`, `runBriefing` | regions, telegram, store |
| `worker/src/store.ts` | `getUser`, `putUser`, `deleteUser`, `listUsers` (KV 래퍼) | env.USERS (KV) |
| `worker/src/types.ts` | `Env`, `User`, 텔레그램 Update 타입 | — |
| `worker/regions.json` | 루트 regions.json 복사(번들) | — |
| `worker/wrangler.toml` | name, main, compatibility_date, KV 바인딩, `[triggers] crons` | — |
| `worker/package.json`, `worker/tsconfig.json` | 빌드/타입 | — |
| `worker/test/*.test.ts` | vitest 단위 테스트 | — |

각 모듈은 단일 책임을 갖고, env(시크릿·KV)는 핸들러에서 주입받아 하위 함수에 전달한다(전역 의존 제거 → 테스트 용이).

## 데이터 흐름

### 등록 (즉시)
1. 텔레그램이 webhook URL로 Update POST.
2. `fetch`: 메서드(POST)·secret token 헤더 검증 → 실패 시 즉시 응답(no-op).
3. Update 파싱 → `message`면 `handleMessage`, `callback_query`면 `handleCallback`.
4. KV에서 유저 조회/저장, 텔레그램 API로 응답(키보드/확정 메시지).
5. **항상 200 반환** (예외도 try/catch 후 200 — 텔레그램 재시도 폭주 방지).

### 일일 브리핑 (Cron)
1. `scheduled`(22:00 UTC) 실행.
2. `listUsers`로 전 유저 조회.
3. 유저 순회: 날씨는 `(nx,ny)` 캐시, 미세먼지는 `airkorea(시도)` 캐시로 외부 호출 최소화.
4. 유저별 `sendMessage`. 유저별 try/catch — 한 명 실패가 전체를 막지 않음.

## 무료 한도 안전 (subrequest 예산)

Workers 무료 플랜은 **요청당 subrequest 50개**. `scheduled`에서 외부 fetch(날씨·미세먼지·sendMessage) 각각이 subrequest다.

- 캐싱으로 외부 fetch를 최소화: 날씨는 고유 격자 수, 미세먼지는 고유 시도 수만큼만.
- **예산 카운터**를 두고 `MAX_SUBREQUESTS = 45`(안전 마진)로, 카운트가 한계에 닿으면 **남은 유저를 처리하지 않고 로깅 후 종료** → 절대 한도 초과/크래시 없음.
- 현실 용량: 유저 ~40명까지 안전. 초과 시 로그로 즉시 인지 가능.
- 확장 경로(비목표, 명시만): Cloudflare Queues로 유저를 enqueue→배치 소비, 또는 유료 플랜(1000 subrequest).

## 보안

- **webhook secret token**: `setWebhook` 시 `secret_token` 지정. Worker는 `X-Telegram-Bot-Api-Secret-Token` 헤더가 저장된 시크릿과 일치할 때만 처리(불일치 시 무시). 무작위/악성 POST 차단.
- **시크릿 관리**: `TELEGRAM_BOT_TOKEN`, `DATA_GO_KR_KEY`, `WEBHOOK_SECRET`는 `wrangler secret put`으로 저장. 코드·`wrangler.toml`·git에 평문 금지. `.gitignore`에 `.dev.vars` 추가.
- **로그 위생**: 토큰·시크릿을 로그에 출력하지 않음. 에러 로그는 메시지/식별자만.
- **입력 검증**: Update 구조(필수 필드) 검증 후 처리. 알 수 없는 콜백 데이터는 graceful 무시.
- **메서드/경로 제한**: POST 외 거부, 지정 경로 외 404.
- **개인정보 개선**: KV는 비공개 → 기존 public `state.json`의 chat_id 노출 문제 해소.

## 에러 처리

- webhook: 모든 핸들러 try/catch, 예외 시에도 200. 처리 실패는 `console.error`로 로깅.
- briefing: 유저별·외부호출별 try/catch. 날씨/미세먼지 실패 시 메시지에 "정보를 불러오지 못했어요" 표기(기존 동작 유지).
- KV 실패: 등록 시 유저에게 "잠시 후 다시 시도" 안내.

## 테스트 (vitest)

**단위 테스트**
- `regions`: 콜백 인덱스 라운드트립(`resolveRegion`), `sidoKeyboard`/`sigunguKeyboard`(뒤로 버튼·callback_data·3열), 좌표/시도 수.
- `briefing`: `dustFor` 측정소 매칭/시도평균 fallback, `buildMessage`(비/온도/미세먼지 라인, 평균 표기, 정보 누락 시 경고 문구).
- `store`: KV를 mock(in-memory)으로 `putUser`/`getUser`/`deleteUser`/`listUsers` 동작.
- `register`: mock된 telegram/store로 `/start`→시도 키보드, 콜백 `s:`/`r:`/`s:back` 흐름, `/stop` 해지.
- 보안: secret token 불일치 시 무시, 잘못된 메서드 거부.

**수동 테스트**
- `wrangler deploy` → `setWebhook` → 텔레그램 `/start` 즉시 시도 키보드 도착 → 시도→시군구 선택 즉시 확정.
- `wrangler tail`로 로그 확인. cron은 `wrangler dev`의 scheduled 테스트 또는 임시 cron으로 1회 검증.

## 배포 / 마이그레이션 (계정·도구 없음 → 단계별 안내)

1. Cloudflare 무료 계정 생성.
2. Node.js + `npm i -g wrangler`, `wrangler login`.
3. KV 네임스페이스 생성(`wrangler kv namespace create USERS`) → `wrangler.toml`에 id 바인딩.
4. 시크릿 3개 `wrangler secret put`.
5. `wrangler deploy` → Worker URL 확보.
6. `setWebhook`(secret_token 포함) 호출 → getUpdates 폴링 자동 비활성.
7. 기존 GitHub Actions 워크플로 2개 + `register.py`/`briefing.py`/`common.py`/`state.json` 제거. `tools/build_regions.py`·`regions.json`은 유지(데이터 생성기).
8. README를 Workers 운영 기준으로 갱신.

## 리스크

- **subrequest 한도**: 위 예산 가드로 초과는 막지만, 유저가 ~40명을 넘으면 일부가 그날 브리핑을 못 받을 수 있음(로그로 인지). 확장 시 Queues/유료.
- **KV 일관성**: KV는 결과적 일관성(eventually consistent)이나, 유저당 키 분리·하루 1회 읽기 패턴이라 실질 영향 없음.
- **단일 webhook 제약**: 텔레그램은 봇당 webhook 1개 → 폴링과 병행 불가. 전환 시 기존 폴링 워크플로 반드시 제거.
