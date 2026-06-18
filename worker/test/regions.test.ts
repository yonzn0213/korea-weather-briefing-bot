import { describe, it, expect } from "vitest";
import {
  REGIONS, SIDO_LIST, sigunguNames,
  sidoKeyboard, sigunguKeyboard, resolveRegion,
} from "../src/regions";

describe("regions", () => {
  it("시도 17개", () => {
    expect(SIDO_LIST.length).toBe(17);
  });

  it("서울 종로구 좌표", () => {
    expect(REGIONS["서울특별시"].sigungu["종로구"]).toEqual({ nx: 60, ny: 127 });
  });

  it("세종 존재 + airkorea", () => {
    expect(REGIONS["세종특별자치시"].airkorea).toBe("세종");
  });

  it("좌표 범위 정상", () => {
    for (const sido of SIDO_LIST) {
      expect(REGIONS[sido].airkorea).toBeTruthy();
      for (const g of Object.values(REGIONS[sido].sigungu)) {
        expect(g.nx).toBeGreaterThanOrEqual(1);
        expect(g.nx).toBeLessThanOrEqual(150);
        expect(g.ny).toBeGreaterThanOrEqual(1);
        expect(g.ny).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("keyboard", () => {
  it("시도 키보드 전체 포함 + s:{slot}:{i}", () => {
    const kb = sidoKeyboard(0);
    const buttons = kb.inline_keyboard.flat();
    expect(buttons.length).toBe(SIDO_LIST.length);
    expect(buttons[0].callback_data).toBe("s:0:0");
  });

  it("slot이 콜백에 반영됨", () => {
    const kb = sidoKeyboard(1);
    expect(kb.inline_keyboard.flat()[0].callback_data).toBe("s:1:0");
  });

  it("시도 키보드 3열 이하", () => {
    const kb = sidoKeyboard(0);
    expect(kb.inline_keyboard.every((row) => row.length <= 3)).toBe(true);
  });

  it("시군구 키보드 뒤로버튼(b:slot) + r:{slot}:{i}:{j}", () => {
    const kb = sigunguKeyboard(0, 0);
    const flat = kb.inline_keyboard.flat();
    expect(flat.some((b) => b.callback_data === "b:0")).toBe(true);
    const first = flat.find((b) => b.callback_data.startsWith("r:"))!;
    expect(first.callback_data).toBe("r:0:0:0");
  });

  it("콜백 라운드트립", () => {
    const sido = SIDO_LIST[1];
    const sg = sigunguNames(sido)[0];
    expect(resolveRegion(1, 0)).toEqual([sido, sg]);
  });

  it("범위 밖은 RangeError", () => {
    expect(() => resolveRegion(999, 0)).toThrow(RangeError);
  });
});
