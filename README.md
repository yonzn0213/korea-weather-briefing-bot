# 🌅 전국 아침 브리핑 봇

매일 아침 **원하는 시각**에, 내가 사는 **전국 시/군/구**의 ☔ 비 소식·🌡 기온(최저/최고·체감온도·시간대별 날씨 이모지)·👕 옷차림·😷 미세먼지·🎨 행운의 색을 텔레그램으로 알려주는 봇입니다.
**최대 2개 지역**을 등록할 수 있고, 켜두면 **곧 비가 올 때 실시간으로 미리 알려주는** 옵트인 알람도 있습니다.
**Cloudflare Workers**(webhook + Cron Trigger) + **KV**로 동작하는 **서버리스** 봇으로, 등록에 즉시 응답하고 서버·DB 비용 없이 운영됩니다.

> 🤖 라이브: **[@korea_weather_briefing_bot](https://t.me/korea_weather_briefing_bot)**

```
🌅 6월 15일 강남구 아침 브리핑

☔ 오늘 비 소식 있어요! (14시~18시, 강수확률 최대 80%) 우산 꼭 챙기세요!
🌡 최저 19°C / 최고 32°C (체감 18~35°C)
⏰ 시간대별
06시  19°  ☀️ 맑음
09시  23°  ⛅ 구름많음
12시  28°  ☁️ 흐림
15시  32°  🌧 비
18시  27°  🌦 소나기
21시  22°  ☀️ 맑음
👕 옷차림: 맨투맨·얇은 니트·가디건 ~ 민소매·반팔·반바지

미세먼지(PM10): 45㎍/㎥ · 보통 🔵
초미세먼지(PM2.5): 22㎍/㎥ · 보통 🔵

🎨 오늘의 행운 색: 청록 🩵

좋은 하루 보내세요! 💪
```

켜두면 비가 다가올 때 이런 실시간 알람도 받습니다(초단기예보 기반):

```
☔ 강남구 13시~15시 강한 비 예상
우산 챙기세요! ☂️
```

---

## 🙋 사용 방법

이미 운영 중인 봇이라 **설치할 게 없습니다.**

1. 텔레그램에서 **[@korea_weather_briefing_bot](https://t.me/korea_weather_briefing_bot)** 검색
2. **/start** 전송 → 버튼에서 **시/도 → 세부 시/군/구 → 받는 시각(05~10시)** 선택
3. 다음 날 선택한 시각부터 매일 브리핑이 도착합니다. (시각을 안 고르면 기본 7시)
4. (선택) **/region** 설정 메뉴에서 **지역 추가**(최대 2개)·**받는 시각 변경**·**실시간 비 알람**을 켤 수 있습니다.

| 명령어 | 기능 |
|--------|------|
| `/start` | 알림 시작 / 지역 선택 |
| `/region` | 설정 메뉴 — 지역 추가·변경·삭제, **받는 시각**, 비 알람 토글 |
| `/rainalert` | 실시간 비 알람 켜기·끄기 |
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
| 외부 데이터 | 기상청 단기예보·초단기예보 API · 에어코리아 대기오염 API (공공데이터포털) |
| 테스트 | Vitest (109 tests, TDD) |
| 데이터 생성 | Python (기상청 LCC 좌표 변환 스크립트) |

---

## 🏗 아키텍처

```
  Telegram  --(webhook)-->  Worker.fetch()        (등록/변경/해지 즉시 처리)
      - secret_token 헤더 검증 (불일치 시 403)
      - /start  /region  /rainalert  /stop  콜백 라우팅
      - 유저 등록 / 변경 / 해지 (지역 최대 2개)   <-->  KV (USERS)

  Cron (hourly) ---------->  Worker.scheduled()   (매 정시 KST 실행)
      - (1) briefHour == 현재 시각 유저    -->  아침 브리핑
      - (2) rainAlert 옵트인 유저          -->  실시간 비 알람 (06~22시)
      - 외부 조회: 날씨 / 미세먼지 / 초단기   -->  기상청 / 에어코리아
      - subrequest 예산 가드(45) + 날짜 기반 회전
      - 발송  -->  Telegram API     (이상 시 ADMIN_CHAT_ID 경보)
```

- **단일 Worker, 두 진입점** — `fetch`(webhook)는 등록/변경/해지를 **즉시** 처리, `scheduled`(매시간 cron)는 브리핑과 비 알람을 처리.
- 매시간 cron **하나**가 "현재 KST 시각 == 유저 `briefHour`"인 사람에게 브리핑하고 옵트인 유저에게 비 알람을 보낸다 — 시각 분산으로 cron 추가 없이 수용 인원을 늘린다.
- 상태는 모두 **KV(USERS)** 한 곳에, **유저당 키 1개**(`chatId → 유저`)로 저장한다.

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
- **콜백 데이터 64바이트 제한**: 한글 대신 **인덱스 인코딩**(`s:{slot}:{i}` / `r:{slot}:{i}:{j}`)으로 payload 최소화. slot(0/1)을 실어 지역 칸을 구분.

### 8. 실시간 비 알람: 무료 한도·알림 피로·사용자 의견을 함께 반영
"곧 비가 올 때"를 알리려면 자주 점검해야 하지만, 무료 한도(요청당 subrequest 50개)와 알림 피로를 함께 고려해야 했다. 5종 사용자 페르소나(통근 직장인·워킹맘·배달 라이더·대학생·은퇴자)의 의견을 모아 파라미터를 잡았다.
- **초단기예보**(`getUltraSrtFcst`, 매시간 30분 발표, +6h)로 **향후 1시간 내 강수(PTY)**를 점검 — 2시간은 오보(양치기 소년)가 많다는 피드백을 반영해 좁혔고, 종일 계획은 아침 브리핑이 담당.
- **옵트인 전용**(`rainAlert` 플래그)으로 점검 대상과 호출량을 최소화하고, 격자별 예보 캐싱·subrequest 예산 가드를 동일하게 적용.
- **침묵 시간(23~06시 KST)**: 라이더의 야간 근무와 아침형 사용자(6시 기상)의 교집합. cron이 돌아도 침묵 시간엔 즉시 종료.
- **에피소드 단위 중복 방지**: 고정 쿨다운 대신, gridKey별 마지막 비의 **종료 시각**(`rainSeen`)을 KV에 기록 → 같은 비가 이어지는 동안은 침묵하고, **마른 시간 뒤 다시 오는 새 비는 재알림**.
- **행동 중심 문구**: 사용자 전원이 강수확률 %를 "안 본다"고 해서 제거하고, **시작~종료 시각 + 강도(약/강, `RN1` 기반) + 행동 한 줄**로 구성. 예: `☔ 강남구 13시~15시 강한 비 예상`.

### 9. 운영 관측가능성: cron 자가감시(dead-man switch)
서버리스 cron은 조용히 실패하기 쉽다(키 만료·기상청 장애 시 `console.log`만 남고 운영자는 사용자 항의로 뒤늦게 인지). 그래서 `runBriefing`/`runRainAlerts`가 `total`·`failed`를 반환하고, 아침 브리핑이 **대상이 있는데 전송 0건**이거나 **발송 실패/예산 초과**가 생기면 `ADMIN_CHAT_ID`로 텔레그램 경보 1건을 보낸다(무료 한도 내, 미설정 시 비활성). 비 알람은 "비 0건"이 정상이라 **조회/발송 실패**만 경보한다.

### 10. 데이터 모델 진화: 단일 지역 → 지역 배열(무중단 마이그레이션)
지역 2개 지원을 위해 `User`를 `{sido, sigungu}`에서 `regions[]`로 바꾸되, **일괄 마이그레이션 없이** 읽기 시점에 레거시 스키마를 자동 변환(`normalizeUser`)해 기존 등록 유저가 끊기지 않도록 했다. 아침 브리핑은 (유저, 지역) 단위로 펼쳐 **지역마다 메시지 1개**를 보낸다.

### 11. 시각 분산으로 무료 한도 우회 (받는 시각 선택)
무료 플랜 한도는 "하루 총량"이 아니라 **한 번의 실행당 subrequest 50개**다. 모든 유저를 아침 7시 cron 한 번에 몰면 캐싱 후에도 ~40명이 천장이었다. 그래서 유저가 **받는 시각(`briefHour`, 05~10시)을 직접 고르게** 하고, **매시간 cron 하나**가 "지금 KST 시각 == briefHour"인 유저만 처리하도록 라우팅했다. 시각마다 별개 실행이라 각자 50 예산을 새로 받아 **cron 추가 없이** 수용 인원이 시각 수만큼 늘어난다(동시에 페르소나가 가장 많이 요청한 "발송 시각 선택"도 해결). 정원 표시·제한은 KV의 최종일관성을 감안해 **락 없는 느슨한 방식**(메뉴 열 때 1회 스캔해 근사 표시, `BRIEF_SLOT_CAP` 초과 시 거부)으로 두되, 경합으로 1~2명 초과해도 발송 시 subrequest 가드가 흡수하므로 정확한 카운터(Durable Objects 등)는 쓰지 않았다.

---

## ✅ 테스트 & 품질

- **TDD**로 작성, **Vitest 단위 테스트 109개** (`cd worker && npm test`).
- 커버리지: 키보드/콜백 라운드트립(지역 slot·받는 시각·비 알람 토글), KV 저장소(in-memory mock)와 레거시 스키마 변환, 텔레그램 API(fetch mock), 미세먼지 fallback, 메시지 빌드(체감온도·시간대별 이모지), 비 알람(초단기 파싱·강수 구간·에피소드 중복방지), 받는 시각 정원(soft cap), subrequest 예산·날짜 회전, cron 라우팅·운영 경보, webhook secret 검증·메서드 거부.
- **타입 게이트**: `npx tsc --noEmit`(프로덕션 `src` 대상, strict). 테스트는 vitest 실행으로 검증.
- 모듈은 단일 책임으로 분리(`regions`·`store`·`telegram`·`register`·`briefing`·`rainalert`·`index`)하고 의존성을 주입해 테스트 용이성 확보.

---

## 📁 프로젝트 구조

| 파일 | 역할 |
|------|------|
| `worker/src/index.ts` | 진입점 — `fetch`(webhook 검증·라우팅) + `scheduled`(매시간: 해당 시각 브리핑 + 비 알람) + 운영 자가감시 경보 |
| `worker/src/register.ts` | 시도/시군구 등록·변경·해지(지역 최대 2개) + 설정 메뉴 + 받는 시각(정원·soft cap) + 비 알람 토글 |
| `worker/src/briefing.ts` | 지역별 날씨/미세먼지 브리핑(시간대별 이모지 포함) + subrequest 예산·회전 |
| `worker/src/rainalert.ts` | 초단기예보 기반 실시간 비 알람(옵트인, 1h 룩어헤드·침묵 시간·에피소드 중복방지) |
| `worker/src/regions.ts` | `regions.json` 로드 + 인라인 키보드(slot) + 콜백 해석 |
| `worker/src/store.ts` | Cloudflare KV 유저 저장소 (유저당 키 1개, 레거시 스키마 자동 변환) |
| `worker/src/telegram.ts` | 텔레그램 Bot API 헬퍼 |
| `worker/wrangler.toml` | Worker 설정 (KV 바인딩, 매시간 cron 1개) |
| `regions.json` / `tools/build_regions.py` | 전국 시군구 격자좌표 + 생성·검증 도구 |

---

## 🛠 직접 운영하기 (self-host)

> MIT 라이선스. 나만의 봇을 띄우려면 — 필요한 것: Cloudflare 무료 계정, 텔레그램, 공공데이터포털 계정.

<details>
<summary>배포 가이드 펼치기</summary>

### 1단계. 공공데이터포털 API 키 (기상청 단기예보 + 에어코리아)
1. https://www.data.go.kr 가입 → **`기상청_단기예보 조회서비스`**, **`에어코리아 대기오염정보`** 각각 **활용신청**(자동승인)
2. **일반 인증키 (Decoding)** 복사 — ⚠️ Encoding 아님. 계정당 1개라 두 API 공용. (단기예보·초단기예보는 같은 서비스라 추가 신청 불필요)

### 2단계. 텔레그램 봇
1. **@BotFather** → `/newbot` → 봇 토큰 복사
2. (추천) `/setcommands`로 `start`·`region`·`rainalert`·`stop` 등록

### 3단계. Cloudflare Workers 배포
```bash
npm i -g wrangler && wrangler login
cd worker && npm install

wrangler kv namespace create USERS    # 출력 id를 wrangler.toml의 REPLACE_WITH_KV_ID에 기입
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put DATA_GO_KR_KEY
wrangler secret put WEBHOOK_SECRET    # 임의 난수 (예: openssl rand -hex 16)
wrangler secret put ADMIN_CHAT_ID     # (선택) 본인 chatId — cron 이상 시 경보 받을 곳
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
- **무료 한도 & 시각 분산**: Workers 무료 플랜은 **한 번의 실행당** subrequest 50개라, 한 시각에 몰리면 캐싱 후 약 40명대가 한계. 그래서 유저가 **받는 시각(05~10시)을 고르면** 시각별로 cron 실행이 나뉘어 각자 새 50 예산을 받아 수용 인원이 늘어난다(시각당 정원 `BRIEF_SLOT_CAP`). 초과 시엔 여전히 회차 건너뜀 + 로그로 안전. 그래도 부족하면 유료($5/월) 또는 Cloudflare Queues.
- **운영 경보(선택)**: `ADMIN_CHAT_ID` 시크릿을 설정하면 cron이 이상(전송 0건·발송 실패·예산 초과·예보 조회 실패)일 때 그 chatId로 경보가 옵니다. 미설정 시 조용히 비활성.
- **실시간 비 알람**: 옵트인(`/rainalert`) 유저만 매시간 점검하고 침묵 시간(23~06 KST)엔 즉시 종료하므로 호출량이 작습니다. 룩어헤드(`WITHIN_HOURS`)·침묵 시간(`QUIET_START`/`QUIET_END`)·강도 임계값은 `worker/src/rainalert.ts` 상단 상수로 조정합니다.
- **발송 시각**: 유저가 `/region`에서 받는 시각(05~10시)을 직접 고릅니다. cron은 `0 * * * *`(매시간) 하나뿐이고, 코드가 "지금 KST 시각 == 유저 briefHour"인 사람에게 브리핑합니다. 선택 시각 폭·정원은 `worker/src/register.ts`의 `BRIEF_HOURS`/`BRIEF_SLOT_CAP` 상수로 조정합니다.
- **지역 데이터 갱신**: `python tools/build_regions.py`로 `regions.json` 재생성 후 `worker/regions.json`에 복사.

## License

MIT
