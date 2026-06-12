import os

os.environ.setdefault("DATA_GO_KR_KEY", "test")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test")

import pytest
from common import (SIDO_LIST, sido_keyboard, sigungu_keyboard,
                    resolve_region, sigungu_names)


def test_시도_키보드_전체_포함():
    kb = sido_keyboard()
    buttons = [b for row in kb["inline_keyboard"] for b in row]
    assert len(buttons) == len(SIDO_LIST)
    assert buttons[0]["callback_data"] == "s:0"


def test_시군구_키보드_뒤로버튼_포함():
    kb = sigungu_keyboard(0)
    flat = [b for row in kb["inline_keyboard"] for b in row]
    assert any(b["callback_data"] == "s:back" for b in flat)
    first_sg = [b for b in flat if b["callback_data"].startswith("r:")][0]
    assert first_sg["callback_data"] == "r:0:0"


def test_콜백_라운드트립():
    sido = SIDO_LIST[1]
    sg = sigungu_names(sido)[0]
    assert resolve_region(1, 0) == (sido, sg)


def test_범위밖_인덱스는_에러():
    with pytest.raises(IndexError):
        resolve_region(999, 0)


def test_시도_키보드_3열():
    kb = sido_keyboard()
    assert all(len(row) <= 3 for row in kb["inline_keyboard"])
