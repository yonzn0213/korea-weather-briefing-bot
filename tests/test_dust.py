import os

os.environ.setdefault("DATA_GO_KR_KEY", "test")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test")

from briefing import dust_for

DUST = {
    "stations": {"강남구": {"pm10": 40.0, "pm25": 20.0}},
    "avg": {"pm10": 55, "pm25": 30},
}


def test_측정소_매칭되면_그_값():
    val, is_avg = dust_for("강남구", DUST)
    assert val == {"pm10": 40.0, "pm25": 20.0}
    assert is_avg is False


def test_매칭_안되면_시도평균():
    val, is_avg = dust_for("가평군", DUST)
    assert val == {"pm10": 55, "pm25": 30}
    assert is_avg is True
