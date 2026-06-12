"""유저 등록/지역 선택 처리 (주기적으로 실행되어 새 메시지를 폴링)

- /start : 환영 + 지역 선택 키보드
- 지역 버튼 탭 : 지역 저장 (최초 1회면 등록 완료)
- /region : 지역 변경
- /stop : 알림 해지
"""

from common import (load_state, save_state, send_message,
                    sido_keyboard, sigungu_keyboard, resolve_region, tg)

WELCOME = (
    "👋 안녕하세요! <b>전국 아침 브리핑 봇</b>이에요.\n"
    "매일 아침 7시, 선택하신 지역의 비 소식과 미세먼지를 알려드립니다.\n\n"
    "먼저 시/도를 선택해주세요 👇"
)

HELP = (
    "✅ 매일 아침 7시에 <b>{region}</b> 브리핑을 보내드리고 있어요.\n\n"
    "/region — 지역 변경\n"
    "/stop — 알림 해지"
)


def handle_message(state: dict, msg: dict):
    chat_id = str(msg["chat"]["id"])
    text = (msg.get("text") or "").strip()
    users = state["users"]

    if text == "/stop":
        if users.pop(chat_id, None):
            send_message(chat_id, "알림을 해지했어요. 다시 받고 싶으면 /start 를 보내주세요. 👋")
        else:
            send_message(chat_id, "등록된 알림이 없어요. /start 로 시작할 수 있어요.")
        return

    if text in ("/start", "/region") or chat_id not in users:
        send_message(chat_id, WELCOME if chat_id not in users else "변경할 시/도를 선택해주세요 👇",
                     reply_markup=sido_keyboard())
        return

    u = users[chat_id]
    send_message(chat_id, HELP.format(region=f"{u['sido']} {u['sigungu']}"))


def handle_callback(state: dict, cq: dict):
    data = cq.get("data", "")
    chat_id = str(cq["message"]["chat"]["id"])
    message_id = cq["message"]["message_id"]
    cq_id = cq["id"]

    # 뒤로: 시도 선택으로 복귀
    if data == "s:back":
        tg("answerCallbackQuery", {"callback_query_id": cq_id})
        tg("editMessageText", {
            "chat_id": chat_id, "message_id": message_id,
            "text": "시/도를 선택해주세요 👇", "parse_mode": "HTML",
            "reply_markup": sido_keyboard(),
        })
        return

    # 시도 선택 -> 시군구 키보드
    if data.startswith("s:"):
        try:
            sido_idx = int(data[2:])
            kb = sigungu_keyboard(sido_idx)
        except (ValueError, IndexError):
            tg("answerCallbackQuery", {"callback_query_id": cq_id, "text": "다시 시도해주세요."})
            return
        tg("answerCallbackQuery", {"callback_query_id": cq_id})
        tg("editMessageText", {
            "chat_id": chat_id, "message_id": message_id,
            "text": "세부 지역(시/군/구)을 선택해주세요 👇", "parse_mode": "HTML",
            "reply_markup": kb,
        })
        return

    # 시군구 선택 -> 저장
    if data.startswith("r:"):
        try:
            _, si, gi = data.split(":")
            sido, sigungu = resolve_region(int(si), int(gi))
        except (ValueError, IndexError):
            tg("answerCallbackQuery", {"callback_query_id": cq_id, "text": "알 수 없는 지역이에요."})
            return

        is_new = chat_id not in state["users"]
        state["users"][chat_id] = {
            "sido": sido, "sigungu": sigungu,
            "name": cq["from"].get("first_name", ""),
        }
        tg("answerCallbackQuery", {"callback_query_id": cq_id, "text": f"{sigungu} 설정 완료!"})
        tg("editMessageText", {
            "chat_id": chat_id, "message_id": message_id,
            "text": f"📍 <b>{sido} {sigungu}</b>로 설정했어요!", "parse_mode": "HTML",
        })
        if is_new:
            send_message(chat_id,
                         f"등록 완료! 내일 아침 7시부터 <b>{sigungu}</b> 브리핑을 보내드릴게요. 🌅\n"
                         "지역 변경은 /region, 해지는 /stop")
        else:
            send_message(chat_id, f"이제부터 <b>{sigungu}</b> 기준으로 알려드릴게요!")
        return

    tg("answerCallbackQuery", {"callback_query_id": cq_id})


def main():
    state = load_state()
    before = (state["offset"], repr(state["users"]))

    res = tg("getUpdates", {"offset": state["offset"] + 1, "timeout": 0})
    updates = res["result"]
    print(f"새 업데이트 {len(updates)}건")

    for u in updates:
        state["offset"] = max(state["offset"], u["update_id"])
        try:
            if "message" in u:
                handle_message(state, u["message"])
            elif "callback_query" in u:
                handle_callback(state, u["callback_query"])
        except Exception as e:
            print(f"업데이트 {u['update_id']} 처리 실패: {e}")

    if (state["offset"], repr(state["users"])) != before:
        save_state(state)
        print("state.json 갱신됨")


if __name__ == "__main__":
    main()
