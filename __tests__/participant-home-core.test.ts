/**
 * Người này tham gia những gì, và mùa nào hiện ra.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO `completed` PHẢI NẰM TRONG DANH SÁCH
 * ---------------------------------------------------------------------------
 * Số đo production ngày 10/09/2026:
 *
 *   UEHM-S12  mentor  active     193
 *   UEHM-S12  mentee  active      19
 *   UEHM-S11  mentee  completed  652
 *   UEHM-S11  mentor  completed  438
 *
 * Lọc mỗi `active` nghĩa là 1.090 người đăng nhập thành công rồi mở ra thấy
 * trang trắng — gấp năm lần số người thấy được nội dung. Đăng nhập được mà
 * chẳng thấy gì còn tệ hơn là chưa cho đăng nhập.
 *
 * Nhưng `withdrawn` và `opted_out` thì KHÔNG: người đã rút khỏi chương trình
 * không có gì để xem lại, và hiện dữ liệu mùa cho họ là nói rằng họ vẫn đang
 * tham gia.
 */
import { describe, expect, it } from "vitest";
import {
  VISIBLE_MEMBERSHIP_STATUSES,
  participantRoleLabel,
  sortMemberships,
  type ParticipantMembership
} from "@/lib/participant-home";

function membership(overrides: Partial<ParticipantMembership> = {}): ParticipantMembership {
  return {
    programId: "prog-1",
    programCode: "UEHM",
    programName: "UEH Mentoring",
    seasonId: "season-12",
    seasonCode: "UEHM-S12",
    seasonName: "Season 12",
    role: "mentor",
    status: "active",
    isPast: false,
    ...overrides
  };
}

describe("trạng thái nào được thấy", () => {
  it("mùa đang chạy và mùa đã hoàn thành đều thấy", () => {
    expect([...VISIBLE_MEMBERSHIP_STATUSES].sort()).toEqual(["active", "completed"]);
  });

  it("người đã rút KHÔNG nằm trong danh sách", () => {
    // 1 người `withdrawn` và 1 người `opted_out` trên production. Hiện dữ liệu
    // mùa cho họ là nói rằng họ vẫn đang tham gia.
    for (const status of ["withdrawn", "opted_out", "invited", "paused"]) {
      expect([...VISIBLE_MEMBERSHIP_STATUSES], status).not.toContain(status);
    }
  });
});

describe("thứ tự hiển thị", () => {
  it("mùa đang chạy đứng trước mùa đã xong", () => {
    const rows = sortMemberships([
      membership({ seasonCode: "UEHM-S11", status: "completed", isPast: true }),
      membership({ seasonCode: "UEHM-S12", status: "active", isPast: false })
    ]);
    expect(rows.map((row) => row.seasonCode)).toEqual(["UEHM-S12", "UEHM-S11"]);
  });

  it("trong cùng nhóm thì mùa gần nhất đứng trước", () => {
    const rows = sortMemberships([
      membership({ seasonId: "a", seasonCode: "UEHM-S09", status: "completed", isPast: true }),
      membership({ seasonId: "b", seasonCode: "UEHM-S11", status: "completed", isPast: true }),
      membership({ seasonId: "c", seasonCode: "UEHM-S10", status: "completed", isPast: true })
    ]);
    expect(rows.map((row) => row.seasonCode)).toEqual(["UEHM-S11", "UEHM-S10", "UEHM-S09"]);
  });

  it("một người vừa đang tham gia vừa có mùa cũ: mùa đang chạy lên đầu", () => {
    // Cựu mentor S11 quay lại làm mentor S12 — trường hợp thật và sẽ nhiều dần.
    const rows = sortMemberships([
      membership({ seasonId: "s11", seasonCode: "UEHM-S11", status: "completed", isPast: true }),
      membership({ seasonId: "s12", seasonCode: "UEHM-S12", status: "active", isPast: false })
    ]);
    expect(rows[0].isPast).toBe(false);
    expect(rows[1].isPast).toBe(true);
  });

  it("KHÔNG sửa mảng gốc", () => {
    const original = [
      membership({ seasonCode: "UEHM-S11", isPast: true }),
      membership({ seasonCode: "UEHM-S12", isPast: false })
    ];
    const snapshot = original.map((row) => row.seasonCode);
    sortMemberships(original);
    expect(original.map((row) => row.seasonCode)).toEqual(snapshot);
  });

  it("thiếu mã mùa cũng không làm hỏng phép sắp", () => {
    const rows = sortMemberships([
      membership({ seasonId: "a", seasonCode: null }),
      membership({ seasonId: "b", seasonCode: "UEHM-S12" })
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe("nhãn vai trò", () => {
  it("mentor và mentee ra chữ người đọc được", () => {
    expect(participantRoleLabel("mentor")).toBe("Mentor");
    expect(participantRoleLabel("mentee")).toBe("Mentee");
  });

  it("vai trò lạ thì hiện chính nó, không nuốt mất", () => {
    // Bảng từ vựng của person_season_memberships có chín giá trị và còn thêm.
    // Trả về chuỗi rỗng nghĩa là một ô trống trên màn hình mà không ai biết vì
    // sao.
    expect(participantRoleLabel("interviewer")).toBe("interviewer");
  });

  it("rỗng thì ra dấu gạch ngang", () => {
    for (const value of [null, undefined, "", "  "]) {
      expect(participantRoleLabel(value), String(value)).toBe("—");
    }
  });
});
