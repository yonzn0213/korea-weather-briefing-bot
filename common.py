"""공용 모듈: 지역 정보, 상태 저장, 텔레그램 API 헬퍼"""

import json
import os
from datetime import timedelta, timezone
from pathlib import Path

import requests

KST = timezone(timedelta(hours=9))
STATE_FILE = Path(__file__).parent / "state.json"

SERVICE_KEY = os.environ["DATA_GO_KR_KEY"]
BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]

REGIONS_FILE = Path(__file__).parent / "regions.json"


def load_regions() -> dict:
    return json.loads(REGIONS_FILE.read_text(encoding="utf-8"))


# 시도 -> {airkorea, sigungu:{name:{nx,ny}}}. 삽입 순서가 콜백 인덱스 기준.
REGIONS = load_regions()
SIDO_LIST = list(REGIONS.keys())


def sigungu_names(sido: str) -> list:
    return list(REGIONS[sido]["sigungu"].keys())


# ---------- 상태(유저 목록 + 텔레그램 offset) ----------

def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"offset": 0, "users": {}}


def save_state(state: dict):
    STATE_FILE.write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


# ---------- 텔레그램 ----------

def tg(method: str, payload: dict) -> dict:
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    r = requests.post(url, json=payload, timeout=30)
    data = r.json()
    if not data.get("ok"):
        raise RuntimeError(f"telegram {method} 실패: {data}")
    return data


def send_message(chat_id, text: str, **kwargs):
    return tg("sendMessage", {"chat_id": chat_id, "text": text,
                              "parse_mode": "HTML", **kwargs})


def _rows(buttons: list, cols: int = 3) -> list:
    return [buttons[i:i + cols] for i in range(0, len(buttons), cols)]


def sido_keyboard() -> dict:
    buttons = [{"text": s, "callback_data": f"s:{i}"}
               for i, s in enumerate(SIDO_LIST)]
    return {"inline_keyboard": _rows(buttons)}


def sigungu_keyboard(sido_idx: int) -> dict:
    sido = SIDO_LIST[sido_idx]
    names = sigungu_names(sido)
    buttons = [{"text": n, "callback_data": f"r:{sido_idx}:{j}"}
               for j, n in enumerate(names)]
    rows = _rows(buttons)
    rows.append([{"text": "⬅ 뒤로", "callback_data": "s:back"}])
    return {"inline_keyboard": rows}


def resolve_region(sido_idx: int, sigungu_idx: int) -> tuple:
    sido = SIDO_LIST[sido_idx]          # 범위 밖이면 IndexError
    names = sigungu_names(sido)
    return sido, names[sigungu_idx]     # 범위 밖이면 IndexError
