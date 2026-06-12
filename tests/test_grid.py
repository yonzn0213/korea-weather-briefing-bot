"""기상청 LCC 위경도→격자 변환 검증"""
from tools.build_regions import latlon_to_grid


def test_서울시청_격자():
    assert latlon_to_grid(37.5665, 126.9780) == (60, 127)


def test_강남구청_격자():
    assert latlon_to_grid(37.5172, 127.0473) == (61, 126)


def test_종로구_중심_격자():
    # 서울 종로구 중심
    assert latlon_to_grid(37.5735, 126.9790) == (60, 127)
