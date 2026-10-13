/**
 * Mentee chuyển tiếp — phần thuần (lib/continuing-mentee-core.ts).
 *
 * Phần đọc bảng và cổng ghi được thử ở s12-matching-pool-safety.test.ts; ở đây chỉ khoá luật
 * nhận diện: tư cách mentee đang hoạt động của mùa MÀ KHÔNG có đơn mentee nào của mùa đó.
 */
import { describe, expect, it } from "vitest";

import {
  CONTINUING_MENTEE_LABEL,
  CONTINUING_MENTEE_QUICK_VIEW_MESSAGE,
  continuingMenteePersonIds
} from "../lib/continuing-mentee-core";

describe("continuingMenteePersonIds", () => {
  it("lấy người đang là mentee của mùa nhưng không có đơn nào", () => {
    expect(continuingMenteePersonIds({ activeMenteeMembers: ["a", "b", "c"], menteeApplicants: ["b"] })).toEqual(["a", "c"]);
  });

  it("có đơn (bất kể trạng thái đã được gom sẵn) thì KHÔNG phải chuyển tiếp: đơn là nguồn quyết định", () => {
    expect(continuingMenteePersonIds({ activeMenteeMembers: ["a"], menteeApplicants: ["a"] })).toEqual([]);
  });

  it("không có tư cách đang hoạt động thì không ai là chuyển tiếp, dù không có đơn", () => {
    expect(continuingMenteePersonIds({ activeMenteeMembers: [], menteeApplicants: [] })).toEqual([]);
    expect(continuingMenteePersonIds({ activeMenteeMembers: [], menteeApplicants: ["a"] })).toEqual([]);
  });

  it("bỏ trống / null / khoảng trắng, và một người có nhiều dòng tư cách chỉ tính một lần", () => {
    expect(
      continuingMenteePersonIds({ activeMenteeMembers: ["a", "a", " a ", null, undefined, "", "  "], menteeApplicants: [null, " "] })
    ).toEqual(["a"]);
  });

  it("đơn có khoảng trắng thừa vẫn khớp người có tư cách (không để trượt vì dấu cách)", () => {
    expect(continuingMenteePersonIds({ activeMenteeMembers: ["a"], menteeApplicants: [" a "] })).toEqual([]);
  });

  it("thứ tự tăng dần và không đổi theo thứ tự vào, để mỗi lần tải trang ra cùng một danh sách", () => {
    const one = continuingMenteePersonIds({ activeMenteeMembers: ["c", "a", "b"], menteeApplicants: [] });
    const two = continuingMenteePersonIds({ activeMenteeMembers: ["b", "c", "a"], menteeApplicants: [] });
    expect(one).toEqual(["a", "b", "c"]);
    expect(two).toEqual(one);
  });
});

describe("lời hiển thị", () => {
  it("nhãn và lời khung xem nhanh nói đúng sự thật: không điền form mùa này, không phải 'chưa được duyệt'", () => {
    expect(CONTINUING_MENTEE_LABEL).toBe("Chuyển tiếp từ mùa trước");
    expect(CONTINUING_MENTEE_QUICK_VIEW_MESSAGE).toContain("không điền form mùa này");
    expect(CONTINUING_MENTEE_QUICK_VIEW_MESSAGE).not.toContain("chưa được duyệt");
  });
});
