"""시군구 중심 위경도(tools/sigungu_src.json) -> regions.json 생성 + 검증.

격자 변환은 기상청 단기예보 LCC 투영 공식 사용.
입력 데이터에 없는 세종특별자치시는 코드에서 보강한다.
"""
import json
import math
import sys
from pathlib import Path

# 기상청 LCC 투영 상수 (단기예보 활용가이드)
RE = 6371.00877   # 지구 반경(km)
GRID = 5.0        # 격자 간격(km)
SLAT1 = 30.0      # 투영 위도1
SLAT2 = 60.0      # 투영 위도2
OLON = 126.0      # 기준점 경도
OLAT = 38.0       # 기준점 위도
XO = 43           # 기준점 X좌표
YO = 136          # 기준점 Y좌표

# 시도 표시명 -> 에어코리아 sidoName 파라미터
AIRKOREA_SIDO = {
    "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구",
    "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
    "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기",
    "강원도": "강원", "충청북도": "충북", "충청남도": "충남",
    "전라북도": "전북", "전라남도": "전남", "경상북도": "경북",
    "경상남도": "경남", "제주특별자치도": "제주",
}

ROOT = Path(__file__).resolve().parent.parent
SRC_PATH = Path(__file__).resolve().parent / "sigungu_src.json"
OUT_PATH = ROOT / "regions.json"

# 입력 데이터에 누락된 시/도 보강: (시도, 시군구, 위도, 경도)
EXTRA = [("세종특별자치시", "세종특별자치시", 36.4800, 127.2890)]


def latlon_to_grid(lat: float, lon: float) -> tuple:
    DEGRAD = math.pi / 180.0
    re = RE / GRID
    slat1 = SLAT1 * DEGRAD
    slat2 = SLAT2 * DEGRAD
    olon = OLON * DEGRAD
    olat = OLAT * DEGRAD

    sn = math.log(math.cos(slat1) / math.cos(slat2)) / math.log(
        math.tan(math.pi * 0.25 + slat2 * 0.5) / math.tan(math.pi * 0.25 + slat1 * 0.5))
    sf = math.tan(math.pi * 0.25 + slat1 * 0.5) ** sn * math.cos(slat1) / sn
    ro = re * sf / math.tan(math.pi * 0.25 + olat * 0.5) ** sn

    ra = re * sf / math.tan(math.pi * 0.25 + lat * DEGRAD * 0.5) ** sn
    theta = lon * DEGRAD - olon
    if theta > math.pi:
        theta -= 2.0 * math.pi
    if theta < -math.pi:
        theta += 2.0 * math.pi
    theta *= sn

    nx = int(math.floor(ra * math.sin(theta) + XO + 0.5))
    ny = int(math.floor(ro - ra * math.cos(theta) + YO + 0.5))
    return nx, ny


def _add(regions: dict, sido: str, sigungu: str, lat: float, lon: float):
    if sido not in AIRKOREA_SIDO:
        raise ValueError(f"알 수 없는 시도: {sido}")
    nx, ny = latlon_to_grid(lat, lon)
    regions.setdefault(sido, {"airkorea": AIRKOREA_SIDO[sido], "sigungu": {}})
    regions[sido]["sigungu"][sigungu] = {"nx": nx, "ny": ny}


def build() -> dict:
    src = json.loads(SRC_PATH.read_text(encoding="utf-8"))
    regions: dict = {}
    for key, v in src.items():
        sido, sigungu = key.split("/")
        _add(regions, sido, sigungu, float(v["lat"]), float(v["long"]))
    for sido, sigungu, lat, lon in EXTRA:
        _add(regions, sido, sigungu, lat, lon)
    return regions


def validate(regions: dict):
    assert len(regions) == 17, f"시도 17개여야 함, 실제 {len(regions)}"
    total = 0
    for sido, blk in regions.items():
        assert blk["airkorea"] in AIRKOREA_SIDO.values(), f"{sido} airkorea 이상"
        assert blk["sigungu"], f"{sido} 시군구 비어있음"
        for sg, g in blk["sigungu"].items():
            total += 1
            assert 1 <= g["nx"] <= 150, f"{sido} {sg} nx 범위 밖: {g['nx']}"
            assert 1 <= g["ny"] <= 255, f"{sido} {sg} ny 범위 밖: {g['ny']}"
    assert total == 229, f"시군구 229개여야 함, 실제 {total}"


def main():
    regions = build()
    validate(regions)
    OUT_PATH.write_text(
        json.dumps(regions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    total = sum(len(b["sigungu"]) for b in regions.values())
    print(f"regions.json 생성: 시도 {len(regions)}개, 시군구 {total}개")


if __name__ == "__main__":
    sys.exit(main())
