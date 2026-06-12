"""regions.json 스키마/좌표 검증 (런타임 무관)"""
import os

os.environ.setdefault("DATA_GO_KR_KEY", "test")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test")

from common import REGIONS, SIDO_LIST, sigungu_names


def test_시도_17개():
    assert len(REGIONS) == 17
    assert len(SIDO_LIST) == 17


def test_서울_종로구_좌표():
    assert REGIONS["서울특별시"]["sigungu"]["종로구"] == {"nx": 60, "ny": 127}


def test_세종_존재():
    assert "세종특별자치시" in REGIONS
    assert REGIONS["세종특별자치시"]["airkorea"] == "세종"


def test_모든_좌표_범위_정상():
    for sido, blk in REGIONS.items():
        assert blk["airkorea"]
        for sg, g in blk["sigungu"].items():
            assert 1 <= g["nx"] <= 150
            assert 1 <= g["ny"] <= 255


def test_sigungu_names_순서일치():
    names = sigungu_names("서울특별시")
    assert "종로구" in names
    assert names == list(REGIONS["서울특별시"]["sigungu"].keys())
