# 🌅 전국 아침 브리핑 봇

매일 아침 7시, 내가 사는 **전국 시/군/구**의 ☔ 비 소식과 😷 미세먼지를 텔레그램으로 알려주는 봇입니다.
**Cloudflare Workers**로 동작해 `/start` 등록에 **즉시 응답**하고, 서버·DB 없이 무료 운영됩니다.

```
🌅 6월 12일 강남구 아침 브리핑

☔ 오늘 비 소식 있어요! (14시~18시, 강수확률 최대 80%) 우산 꼭 챙기세요!
🌡 최저 19°C / 최고 26°C
하늘: 흐림 ☁️

미세먼지(PM10): 45㎍/㎥ · 보통 🔵
초미세먼지(PM2.5): 22㎍/㎥ · 보통 🔵

좋은 하루 보내세요! 💪
```

---

## 🙋 사용 방법

이미 운영 중인 봇이라 **설치할 게 없습니다.** 텔레그램에서 아래 3단계면 끝!

1. 텔레그램에서 봇 검색: **[@korea_weather_briefing_bot](https://t.me/korea_weather_briefing_bot)**
2. **/start** 전송
3. 바로 도착하는 버튼에서 **시/도 선택 → 세부 시/군/구 선택** — 끝!
4. 다음 날 아침 7시부터 매일 브리핑이 도착합니다.

| 명령어 | 기능 |
|--------|------|
| `/start` | 알림 시작 / 지역 선택 |
| `/region` | 지역 변경 (한 번 고르면 계속 유지) |
| `/stop` | 알림 해지 |

---

## ✨ 특징

- **전국 지원**: 17개 시/도 → 각 시/군/구(약 230곳) 2단계 선택
- **즉시 응답**: Cloudflare Workers webhook으로 `/start`·지역 선택을 바로 처리
- **서버리스**: 별도 서버·DB 없이 Workers(webhook) + KV + Cron Trigger로 무료 운영
- **날씨**: 기상청 단기예보 API — 시군구별 격자좌표, 새벽 5시 발표분 사용
- **미세먼지**: 에어코리아 API — 시군구 측정소 실측값, 측정소가 없으면 해당 시/도 평균으로 자동 대체

---

## 🛠 직접 운영하기 (선택)

> 위 봇을 쓰면 되지만, MIT 라이선스 오픈소스라 **나만의 봇**을 띄울 수도 있습니다.
> 필요한 것: GitHub 계정, 텔레그램, 공공데이터포털 계정 (전부 무료, 15~20분)

<details>
<summary>배포 가이드 펼치기</summary>

### 1단계. 공공데이터포털 API 키 발급

1. **https://www.data.go.kr** 접속 → **회원가입**(네이버/카카오 간편가입) → 로그인
2. 검색창에 **`기상청_단기예보`** 검색 → **「기상청_단기예보 ((구)_동네예보) 조회서비스」** → **[활용신청]**
   - 활용목적: **웹 사이트 개발** 또는 **앱개발**, 상세기능정보 **전체 체크**, 라이선스 동의 → 신청 (자동승인, 즉시 사용)
3. 같은 방법으로 **`에어코리아_대기오염정보`** 검색 → **「한국환경공단_에어코리아_대기오염정보」** → **[활용신청]**
4. **마이페이지 → 데이터 활용 → Open API → 활용신청 현황** → API 클릭 → **일반 인증키 (Decoding)** 복사
   - ⚠️ **Encoding 키가 아니라 Decoding 키**입니다! (코드가 알아서 인코딩함)
   - 인증키는 **계정당 1개**라 두 API에 같은 키를 씁니다
   - 💡 발급 직후 30분~1시간은 키 동기화 지연으로 `SERVICE_KEY_IS_NOT_REGISTERED` 오류가 날 수 있어요. 잠시 후 재시도.

### 2단계. 텔레그램 봇 만들기

1. 텔레그램에서 **@BotFather** → `/newbot` → 봇 이름·아이디 입력 (아이디는 `bot`으로 끝나야 함)
2. 발급되는 **봇 토큰** 복사 (예: `1234567890:AAH...`)
3. (추천) `/setcommands` → 봇 선택 → 붙여넣기:
   ```
   start - 알림 시작 / 지역 선택
   region - 지역 변경
   stop - 알림 해지
   ```

### 3단계. Cloudflare Workers 배포

필요한 것: Cloudflare 무료 계정, Node.js(설치돼 있으면 OK)

```bash
npm i -g wrangler
wrangler login                       # 브라우저 인증

cd worker
npm install

# KV 네임스페이스 생성 → 출력된 id를 worker/wrangler.toml의 REPLACE_WITH_KV_ID에 기입
wrangler kv namespace create USERS

# 시크릿 3개 등록
wrangler secret put TELEGRAM_BOT_TOKEN   # 2단계의 봇 토큰
wrangler secret put DATA_GO_KR_KEY       # 1단계의 Decoding 인증키
wrangler secret put WEBHOOK_SECRET       # 임의 난수 (예: openssl rand -hex 16)

wrangler deploy                          # 출력된 https://....workers.dev URL 확보
```

### 4단계. webhook 등록 + 테스트

```bash
# <토큰>=봇 토큰, <WorkerURL>=배포 URL, <시크릿>=위 WEBHOOK_SECRET와 동일
curl "https://api.telegram.org/bot<토큰>/setWebhook" \
  -d "url=<WorkerURL>" -d "secret_token=<시크릿>"
```

1. 텔레그램에서 내 봇에 **/start** → **즉시** 시/도 키보드 도착 → 시군구 선택 → 즉시 확정
2. 일일 브리핑은 매일 **22:00 UTC(KST 07:00)** Cron Trigger로 자동 발송
3. 로그 확인: `wrangler tail`
4. README 상단의 봇 링크를 본인 봇으로 수정해서 공유하세요.

</details>

---

## ⚙️ 구조

| 파일 | 역할 |
|------|------|
| `worker/src/index.ts` | 진입점 — webhook(즉시 등록) + Cron Trigger(일일 브리핑) |
| `worker/src/register.ts` | 시도/시군구 2단계 등록·변경·해지 처리 |
| `worker/src/briefing.ts` | 유저별 날씨/미세먼지 브리핑 (subrequest 예산 가드) |
| `worker/src/regions.ts` | `regions.json` 로드 + 시도/시군구 키보드 |
| `worker/src/store.ts` | Cloudflare KV 유저 저장소 (유저당 키 1개) |
| `worker/src/telegram.ts` | 텔레그램 API 헬퍼 |
| `worker/wrangler.toml` | Worker 설정 (KV 바인딩, cron) |
| `regions.json` / `tools/build_regions.py` | 전국 시군구 격자좌표 + 생성·검증 도구 |

테스트: `cd worker && npm test` (vitest)

## 📝 운영 참고사항 (자체 호스팅 시)

- **즉시성**: 텔레그램 webhook이라 `/start`·지역 선택이 바로 처리됩니다. (폴링 지연 없음)
- **개인정보**: 유저 목록은 Cloudflare KV에 비공개 저장됩니다 (저장소에 노출 안 됨).
- **무료 한도**: Workers 무료 플랜은 요청당 subrequest 50개라, 일일 브리핑은 캐싱 후 약 **40~45명**까지 안전합니다.
  초과 시 남은 유저는 그 회차에 건너뛰고 로그(`wrangler tail`)로 표시됩니다. 더 필요하면 유료($5/월) 또는 Cloudflare Queues로 확장.
- **발송 시간 변경**: `worker/wrangler.toml`의 `crons`는 **UTC** 기준 (KST−9시간). KST 6:30 → `30 21 * * *`
- **API 한도**: 공공데이터포털 개발계정은 일 1,000건 안팎(API별 상이) — 이 봇 사용량으론 충분합니다.
- **지역 데이터 갱신**: 시군구 좌표는 `python tools/build_regions.py`로 `regions.json` 재생성 후 `worker/regions.json`에 복사합니다.
  미세먼지 측정소 매칭은 시군구명과 일치하는 측정소가 있을 때만 적용되고, 없으면 해당 시/도 평균을 씁니다.

## License

MIT
