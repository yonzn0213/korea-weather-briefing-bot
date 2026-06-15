# 🌅 전국 아침 브리핑 봇

매일 아침 7시, 내가 사는 **전국 시/군/구**의 ☔ 비 소식·🌡 기온(최저/최고·시간대별)·👕 옷차림·😷 미세먼지·🎨 행운의 색을 텔레그램으로 알려주는 봇입니다.
**Cloudflare Workers**(webhook + Cron Trigger) + **KV**로 동작하는 **서버리스** 봇으로, 등록에 즉시 응답하고 서버·DB 비용 없이 운영됩니다.

> 🤖 라이브: **[@korea_weather_briefing_bot](https://t.me/korea_weather_briefing_bot)**

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

---

## 🙋 사용 방법

이미 운영 중인 봇이라 **설치할 게 없습니다.**

1. 텔레그램에서 **[@korea_weather_briefing_bot](https://t.me/korea_weather_briefing_bot)** 검색
2. **/start** 전송 → **즉시** 도착하는 버튼에서 **시/도 → 세부 시/군/구** 선택
3. 다음 날 아침 7시부터 매일 브리핑이 도착합니다.

| 명령어 | 기능 |
|--------|------|
| `/start` | 알림 시작 / 지역 선택 |
| `/region` | 지역 변경 |
| `/stop` | 알림 해지 |

---

## 🧩 기술 스택

| 영역 | 사용 기술 |
|------|-----------|
| 런타임 | Cloudflare Workers (서버리스, 엣지) |
| 언어 | TypeScript (런타임 외부 의존성 0) |
| 상태 저장 | Cloudflare KV |
| 스케줄 | Workers Cron Triggers |
| 메시징 | Telegram Bot API (Webhook) |
| 외부 데이터 | 기상청 단기예보 API · 에어코리아 대기오염 API (공공데이터포털) |
| 테스트 | Vitest (37 tests, TDD) |
| 데이터 생성 | Python (기상청 LCC 좌표 변환 스크립트) |

---

## 🏗 아키텍처

```
                    ┌──────────────────── Cloudflare Worker ────────────────────┐
  Telegram ──POST──▶│ fetch()                                                    │
  (webhook)         │  ├─ secret_token 헤더 검증 (가짜 요청 차단)                  │
                    │  ├─ /start·/region·/stop·콜백 라우팅                         │──▶ Telegram API
                    │  └─ 유저 등록/변경/해지                  ┌────────────┐     │   (즉시 응답)
                    │                                          │ KV (USERS) │     │
  Cron(22:00 UTC)──▶│ scheduled()                              │ chatId→유저 │     │
  = KST 07:00       │  ├─ 전 유저 조회 (KV list)         ◀────▶└────────────┘     │
                    │  ├─ 날씨(격자별)·미세먼지(시도별) 캐싱 조회 ───────────────────│──▶ 기상청 / 에어코리아
                    │  └─ subrequest 예산 내에서 유저별 발송                        │──▶ Telegram API
                    └────────────────────────────────────────────────────────────┘
```

- **단일 Worker**가 두 진입점(`fetch` = webhook, `scheduled` = cron)을 담당.
- 등록 흐름은 webhook으로 **즉시** 처리, 일일 브리핑은 Cron Trigger로 발송.

---

## 💡 기술적 의사결정 (무엇을 고민했고, 왜 이렇게 했나)

### 1. 폴링 → Webhook 전환 (즉시성)
초기 버전은 GitHub Actions cron(10분)으로 `getUpdates`를 **폴링**했다. 그러나 GitHub Actions cron은 최소 간격 5분 + 무료 러너 특성상 수~수십 분 지연돼 `/start` 응답이 느렸다.
→ **Telegram Webhook**으로 전환해 메시지 도착 즉시 처리. 단, webhook은 상시 HTTPS 엔드포인트가 필요한데 이를 **서버리스(Workers)**로 해결해 "서버 없음"과 "즉시성"을 동시에 확보했다.

### 2. 상태 저장: git `state.json` → Cloudflare KV
초기엔 유저 목록을 public 저장소의 `state.json`에 GitHub Actions가 자동 커밋했다. 두 가지 문제가 있었다.
- **개인정보 노출**: public repo에 유저 chat_id가 그대로 공개됨.
- **쓰기 경합**: 동시 업데이트가 같은 파일을 커밋하며 충돌·이력 오염 위험.

→ **Cloudflare KV**로 이전하고, **유저당 키 1개**(`key=chatId`) 스키마를 채택했다. 비공개 저장 + 동시 webhook 간 read-modify-write 경합 제거.

### 3. 무료 한도 안에서 안전하게 (제약 기반 설계)
Cloudflare Workers 무료 플랜은 **요청당 subrequest 50개** 제한이 있다. 일일 브리핑은 유저마다 외부 호출(날씨·미세먼지·발송)을 하므로 유저가 늘면 한도를 넘을 수 있다.
- **캐싱**: 날씨는 격자(nx, ny)별, 미세먼지는 시/도별로 묶어 외부 호출을 최소화.
- **예산 가드**: subrequest 카운터로 한계(45) 도달 전 **graceful하게 중단**하고 남은 유저를 로깅 → 조용한 실패 없이 한도 초과를 원천 차단.
- **날짜 기반 회전**: 한도에 걸릴 때 매일 같은 유저가 누락되지 않도록 처리 순서를 날짜로 회전.
- 확장 경로(Cloudflare Queues / 유료 플랜)도 문서화.

### 4. 보안 (공개 저장소 + 공개 엔드포인트 전제)
- **Webhook 위조 차단**: `setWebhook`의 `secret_token`을 지정하고, Worker가 `X-Telegram-Bot-Api-Secret-Token` 헤더를 검증해 일치할 때만 처리(불일치 403).
- **재시도 폭주 방지**: 처리 중 예외가 나도 텔레그램에는 항상 200을 반환(비-200 시 텔레그램이 무한 재시도).
- **입력 방어**: 비정상 업데이트(채널 포스트 등 `chat` 누락)에 대한 가드.
- **시크릿 분리**: 봇 토큰·API 키는 `wrangler secret`에만 저장하고 코드·저장소에 **절대 커밋하지 않음**(`.dev.vars`는 `.gitignore`).
- **공급망 최소화**: 배포되는 Worker의 **런타임 외부 의존성 0개**(`dependencies: {}`) — 공격 표면 최소화. (`npm audit --omit=dev` = 0 vulnerabilities)

### 5. 전국 격자좌표 데이터 파이프라인
기상청 단기예보는 위경도가 아닌 자체 **격자(nx, ny)** 좌표를 쓴다. 전국 시군구(229곳)의 격자를 확보하기 위해, 시군구 중심 위경도를 기상청 **LCC(Lambert Conformal Conic) 투영 공식**으로 변환하는 스크립트(`tools/build_regions.py`)를 만들고, 빌드 타임에 **검증**(17개 시/도, 좌표 범위, 시군구 수)했다. 행정구역 변경(2023년 군위군 → 대구 편입)도 반영.

### 6. 미세먼지: 정확도 vs 단순성의 타협
에어코리아 측정소명이 항상 시군구명과 일치하지는 않는다(동·지명 기반 측정소 다수). 무리하게 매핑 테이블을 만들기보다, **시군구명 일치 측정소가 있으면 그 실측값, 없으면 해당 시/도 평균**으로 fallback하고 메시지에 `(○○ 평균)`을 명시해 **투명하게** 처리했다.

### 7. 시간·식별자 처리
- **KST/UTC**: Workers는 UTC로 동작하므로 KST(UTC+9) 변환 후 기상청 발표 시각(05시) 기준으로 base_time 계산.
- **중복 시군구명**: "중구"·"남구"처럼 여러 시/도에 같은 이름이 존재 → 지역을 `시도 + 시군구` 조합으로 식별.
- **콜백 데이터 64바이트 제한**: 한글 대신 **인덱스 인코딩**(`s:{i}` / `r:{i}:{j}`)으로 payload 최소화.

---

## ✅ 테스트 & 품질

- **TDD**로 작성, **Vitest 단위 테스트 37개** (`cd worker && npm test`).
- 커버리지: 키보드/콜백 라운드트립, KV 저장소(in-memory mock), 텔레그램 API(fetch mock), 미세먼지 fallback, 메시지 빌드, subrequest 예산·유저 회전, webhook secret 검증·메서드 거부.
- **타입 게이트**: `npx tsc --noEmit`(프로덕션 `src` 대상, strict). 테스트는 vitest 실행으로 검증.
- 모듈은 단일 책임으로 분리(`regions`·`store`·`telegram`·`register`·`briefing`·`index`)하고 의존성을 주입해 테스트 용이성 확보.

---

## 📁 프로젝트 구조

| 파일 | 역할 |
|------|------|
| `worker/src/index.ts` | 진입점 — `fetch`(webhook 검증·라우팅) + `scheduled`(cron) |
| `worker/src/register.ts` | 시도/시군구 2단계 등록·변경·해지 |
| `worker/src/briefing.ts` | 유저별 날씨/미세먼지 브리핑 + subrequest 예산·회전 |
| `worker/src/regions.ts` | `regions.json` 로드 + 인라인 키보드 + 콜백 해석 |
| `worker/src/store.ts` | Cloudflare KV 유저 저장소 (유저당 키 1개) |
| `worker/src/telegram.ts` | 텔레그램 Bot API 헬퍼 |
| `worker/wrangler.toml` | Worker 설정 (KV 바인딩, cron) |
| `regions.json` / `tools/build_regions.py` | 전국 시군구 격자좌표 + 생성·검증 도구 |

---

## 🛠 직접 운영하기 (self-host)

> MIT 라이선스. 나만의 봇을 띄우려면 — 필요한 것: Cloudflare 무료 계정, 텔레그램, 공공데이터포털 계정.

<details>
<summary>배포 가이드 펼치기</summary>

### 1단계. 공공데이터포털 API 키 (기상청 단기예보 + 에어코리아)
1. https://www.data.go.kr 가입 → **`기상청_단기예보 조회서비스`**, **`에어코리아 대기오염정보`** 각각 **활용신청**(자동승인)
2. **일반 인증키 (Decoding)** 복사 — ⚠️ Encoding 아님. 계정당 1개라 두 API 공용.

### 2단계. 텔레그램 봇
1. **@BotFather** → `/newbot` → 봇 토큰 복사
2. (추천) `/setcommands`로 `start`·`region`·`stop` 등록

### 3단계. Cloudflare Workers 배포
```bash
npm i -g wrangler && wrangler login
cd worker && npm install

wrangler kv namespace create USERS    # 출력 id를 wrangler.toml의 REPLACE_WITH_KV_ID에 기입
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put DATA_GO_KR_KEY
wrangler secret put WEBHOOK_SECRET    # 임의 난수 (예: openssl rand -hex 16)
wrangler deploy                       # 출력된 https://....workers.dev URL 확보
```

### 4단계. Webhook 등록
```bash
curl "https://api.telegram.org/bot<토큰>/setWebhook" \
  -d "url=<WorkerURL>" -d "secret_token=<WEBHOOK_SECRET와 동일>"
```
텔레그램에서 `/start` → 즉시 응답 확인. 로그는 `wrangler tail`.

</details>

---

## 📝 운영 참고사항 (자체 호스팅 시)

- **즉시성**: webhook이라 `/start`·지역 선택이 바로 처리됩니다.
- **개인정보**: 유저 목록은 Cloudflare KV에 비공개 저장(저장소 노출 없음).
- **보안**: 봇 토큰·인증키는 `wrangler secret`에만 저장하고 코드·저장소에 커밋하지 않습니다(`.dev.vars`는 `.gitignore`). webhook은 `secret_token` 헤더로 검증합니다.
- **무료 한도**: Workers 무료 플랜은 요청당 subrequest 50개라 일일 브리핑은 캐싱 후 약 **40~45명**까지 안전(초과 시 회차 건너뜀 + 로그). 확장은 유료($5/월) 또는 Cloudflare Queues.
- **발송 시간 변경**: `worker/wrangler.toml`의 `crons`는 **UTC** 기준 (KST−9시간). KST 6:30 → `30 21 * * *`.
- **지역 데이터 갱신**: `python tools/build_regions.py`로 `regions.json` 재생성 후 `worker/regions.json`에 복사.

## License

MIT
