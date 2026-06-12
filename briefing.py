"""매일 아침 브리핑: 등록된 유저별로 자기 지역의 날씨/미세먼지 전송"""

import sys
import time
from collections import Counter
from datetime import datetime, timedelta

import requests

from common import KST, REGIONS, SERVICE_KEY, load_state, send_message

PTY_LABEL = {
    "1": "비", "2": "비/눈", "3": "눈", "4": "소나기",
    "5": "빗방울", "6": "빗방울눈날림", "7": "눈날림",
}
SKY_LABEL = {"1": "맑음 ☀️", "3": "구름많음 ⛅", "4": "흐림 ☁️"}


# ---------- 기상청 단기예보 ----------

def get_base_datetime(now: datetime):
    if now.hour > 5 or (now.hour == 5 and now.minute >= 15):
        return now.strftime("%Y%m%d"), "0500"
    return (now - timedelta(days=1)).strftime("%Y%m%d"), "2300"


def fetch_weather(now: datetime, nx: int, ny: int) -> dict:
    base_date, base_time = get_base_datetime(now)
    url = "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst"
    params = {
        "serviceKey": SERVICE_KEY, "numOfRows": 1000, "pageNo": 1,
        "dataType": "JSON", "base_date": base_date, "base_time": base_time,
        "nx": nx, "ny": ny,
    }
    r = requests.get(url, params=params, timeout=20)
    r.raise_for_status()
    items = r.json()["response"]["body"]["items"]["item"]

    today = now.strftime("%Y%m%d")
    data = {"pop_max": 0, "rain_hours": [], "tmn": None, "tmx": None, "sky": None}
    for it in items:
        if it["fcstDate"] != today:
            continue
        cat, val, t = it["category"], it["fcstValue"], it["fcstTime"]
        if cat == "POP":
            data["pop_max"] = max(data["pop_max"], int(val))
        elif cat == "PTY" and val != "0":
            data["rain_hours"].append((t, PTY_LABEL.get(val, "강수")))
        elif cat == "TMN":
            data["tmn"] = float(val)
        elif cat == "TMX":
            data["tmx"] = float(val)
        elif cat == "SKY" and t == "1200":
            data["sky"] = SKY_LABEL.get(val, "")
    return data


# ---------- 에어코리아 미세먼지 ----------

def fetch_dust(sido_name: str) -> dict:
    """해당 시/도 전 측정소를 한 번에 가져와 측정소명 -> 측정값 매핑"""
    url = "http://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty"
    params = {
        "serviceKey": SERVICE_KEY, "returnType": "json",
        "numOfRows": 1000, "pageNo": 1, "sidoName": sido_name, "ver": "1.0",
    }
    r = requests.get(url, params=params, timeout=20)
    r.raise_for_status()
    items = r.json()["response"]["body"]["items"]

    by_station, pm10s, pm25s = {}, [], []
    for it in items:
        entry = {}
        for key, bucket in (("pm10Value", pm10s), ("pm25Value", pm25s)):
            try:
                v = float(it[key])
                entry["pm10" if key.startswith("pm10") else "pm25"] = v
                bucket.append(v)
            except (ValueError, TypeError):
                pass
        if entry:
            by_station[it["stationName"]] = entry

    avg = {
        "pm10": round(sum(pm10s) / len(pm10s)) if pm10s else None,
        "pm25": round(sum(pm25s) / len(pm25s)) if pm25s else None,
    }
    return {"stations": by_station, "avg": avg}


def dust_for(sigungu: str, dust: dict) -> tuple:
    """시군구명과 일치하는 측정소 값, 없으면 시/도 평균 (값, 평균여부)"""
    st = dust["stations"].get(sigungu)
    if st and ("pm10" in st or "pm25" in st):
        return {"pm10": st.get("pm10"), "pm25": st.get("pm25")}, False
    return dust["avg"], True


def grade_pm10(v) -> str:
    if v <= 30: return "좋음 🟢"
    if v <= 80: return "보통 🔵"
    if v <= 150: return "나쁨 🟠"
    return "매우나쁨 🔴"


def grade_pm25(v) -> str:
    if v <= 15: return "좋음 🟢"
    if v <= 35: return "보통 🔵"
    if v <= 75: return "나쁨 🟠"
    return "매우나쁨 🔴"


# ---------- 메시지 ----------

def summarize_rain(rain_hours: list, pop_max: int) -> str:
    if not rain_hours:
        if pop_max >= 60:
            return f"☔ 비 예보는 없지만 강수확률이 최대 {pop_max}%예요. 우산 챙기는 게 안전!"
        return f"🌂 오늘 비 소식 없음 (강수확률 최대 {pop_max}%)"

    hours = sorted(int(t[:2]) for t, _ in rain_hours)
    kind = Counter(label for _, label in rain_hours).most_common(1)[0][0]
    ranges, start, prev = [], hours[0], hours[0]
    for h in hours[1:]:
        if h == prev + 1:
            prev = h
        else:
            ranges.append((start, prev))
            start = prev = h
    ranges.append((start, prev))
    span = ", ".join(f"{s}시~{e + 1}시" if s != e else f"{s}시경" for s, e in ranges)
    return f"☔ 오늘 {kind} 소식 있어요! ({span}, 강수확률 최대 {pop_max}%) 우산 꼭 챙기세요!"


def build_message(now: datetime, sido: str, sigungu: str, w: dict,
                  d: dict, is_avg: bool) -> str:
    lines = [f"🌅 <b>{now.strftime('%-m월 %-d일')} {sigungu} 아침 브리핑</b>", ""]

    if w:
        lines.append(summarize_rain(w["rain_hours"], w["pop_max"]))
        temp = []
        if w["tmn"] is not None:
            temp.append(f"최저 {w['tmn']:.0f}°C")
        if w["tmx"] is not None:
            temp.append(f"최고 {w['tmx']:.0f}°C")
        if temp:
            lines.append("🌡 " + " / ".join(temp))
        if w["sky"]:
            lines.append(f"하늘: {w['sky']}")
    else:
        lines.append("⚠️ 날씨 정보를 불러오지 못했어요.")

    lines.append("")
    if d and (d.get("pm10") is not None or d.get("pm25") is not None):
        suffix = f" ({sido} 평균)" if is_avg else ""
        if d.get("pm10") is not None:
            lines.append(f"미세먼지(PM10): {d['pm10']:.0f}㎍/㎥ · {grade_pm10(d['pm10'])}{suffix}")
        if d.get("pm25") is not None:
            lines.append(f"초미세먼지(PM2.5): {d['pm25']:.0f}㎍/㎥ · {grade_pm25(d['pm25'])}{suffix}")
        if (d.get("pm10") and d["pm10"] > 80) or (d.get("pm25") and d["pm25"] > 35):
            lines.append("😷 마스크 챙기시는 걸 추천해요!")
    else:
        lines.append("⚠️ 미세먼지 정보를 불러오지 못했어요.")

    lines.append("\n좋은 하루 보내세요! 💪")
    return "\n".join(lines)


def main():
    now = datetime.now(KST)
    users = load_state()["users"]
    if not users:
        print("등록된 유저가 없어요. 종료.")
        return

    weather_cache: dict = {}   # (nx, ny) -> weather
    dust_cache: dict = {}      # airkorea sidoName -> dust
    sent = failed = 0

    for chat_id, info in users.items():
        sido, sigungu = info.get("sido"), info.get("sigungu")
        if sido not in REGIONS or sigungu not in REGIONS[sido]["sigungu"]:
            continue
        g = REGIONS[sido]["sigungu"][sigungu]
        grid = (g["nx"], g["ny"])
        if grid not in weather_cache:
            try:
                weather_cache[grid] = fetch_weather(now, *grid)
            except Exception as e:
                print(f"[weather {sigungu}] 실패: {e}", file=sys.stderr)
                weather_cache[grid] = None

        airkorea = REGIONS[sido]["airkorea"]
        if airkorea not in dust_cache:
            try:
                dust_cache[airkorea] = fetch_dust(airkorea)
            except Exception as e:
                print(f"[dust {airkorea}] 실패: {e}", file=sys.stderr)
                dust_cache[airkorea] = None
        dust = dust_cache[airkorea]
        d, is_avg = dust_for(sigungu, dust) if dust else (None, False)

        msg = build_message(now, sido, sigungu, weather_cache[grid], d, is_avg)
        try:
            send_message(chat_id, msg)
            sent += 1
        except Exception as e:
            print(f"[send {chat_id}] 실패: {e}", file=sys.stderr)
            failed += 1
        time.sleep(0.1)

    print(f"전송 {sent}건 완료, 실패 {failed}건")


if __name__ == "__main__":
    main()
