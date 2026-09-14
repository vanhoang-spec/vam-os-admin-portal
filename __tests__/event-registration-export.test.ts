/**
 * Xuất danh sách đăng ký ra CSV.
 *
 * ---------------------------------------------------------------------------
 * BẢNG NÀY MỞ RA TRONG EXCEL, NÊN NÓ LÀ MỘT BỀ MẶT TẤN CÔNG
 * ---------------------------------------------------------------------------
 * Mọi ô trong bảng đều là chữ do người ngoài tự gõ vào biểu mẫu đăng ký công
 * khai. Một ô bắt đầu bằng dấu `=` được Excel hiểu là CÔNG THỨC, không phải
 * chữ — và công thức thì chạy trên máy của người mở file.
 *
 * Một ô chứa dấu xuống dòng hay dấu phẩy mà không được bọc đúng cách sẽ tự tách
 * thành ô mới, đẩy lệch mọi cột phía sau. Một bảng lệch cột trông vẫn như một
 * bảng bình thường, nên không ai phát hiện cho tới khi dùng nó để cộng điểm rèn
 * luyện cho nhầm người.
 */
import { describe, expect, it } from "vitest";

import {
  EVENT_EXPORT_HEADERS,
  buildEventRegistrationCsv,
  eventRegistrationRow,
  exportFileName,
  type ExportSession
} from "@/lib/event-export";

const SESSIONS = new Map<string, ExportSession>([
  ["e1", { id: "e1", seriesIndex: 1, startsAt: "2026-09-20T01:00:00.000Z" }],
  ["e2", { id: "e2", seriesIndex: 2, startsAt: "2026-09-27T01:00:00.000Z" }]
]);

function registration(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    event_id: "e1",
    full_name: "Nguyễn Văn A",
    email: "a@example.com",
    phone: "0900000000",
    registration_status: "registered",
    attendance_status: "checked_in",
    checked_in_at: "2026-09-20T01:20:00.000Z",
    is_walk_in: false,
    student_id: "31221020001",
    school: "UEH",
    program_of_study: "Kinh doanh quốc tế",
    checkin_code: "A7K2M9PQRS",
    short_code: "A7K2",
    registered_at: "2026-09-01T03:00:00.000Z",
    ...overrides
  };
}

describe("cột và nhãn", () => {
  it("mỗi dòng có đúng số ô bằng số cột tiêu đề", () => {
    // Thừa hay thiếu một ô là cả bảng lệch cột từ đó trở đi.
    const row = eventRegistrationRow(registration(), SESSIONS);
    expect(row).toHaveLength(EVENT_EXPORT_HEADERS.length);
  });

  it("nói đúng buổi nào của chuỗi", () => {
    const row = eventRegistrationRow(registration({ event_id: "e2" }), SESSIONS);
    expect(row[0]).toBe("Buổi 2");
    expect(row[1]).toContain("27/09/2026");
  });

  it("giờ hiện theo giờ Việt Nam, không phải giờ máy chủ", () => {
    // 01:00Z là 08:00 giờ Việt Nam. Máy chủ chạy UTC, nên một bảng in thẳng giờ
    // máy chủ sẽ lệch 7 tiếng cho toàn bộ chương trình.
    const row = eventRegistrationRow(registration(), SESSIONS);
    expect(row[1]).toBe("20/09/2026 08:00");
    expect(row[8]).toBe("20/09/2026 08:20");
  });

  it("trạng thái ra chữ tiếng Việt, không ra mã trong máy", () => {
    const row = eventRegistrationRow(registration(), SESSIONS);
    expect(row[5]).toBe("Đã đăng ký");
    expect(row[7]).toBe("Có");
    expect(row[10]).toBe("Không");
  });

  it("chưa check-in thì cột thời điểm để trống, không ghi số 0 hay chữ null", () => {
    const row = eventRegistrationRow(
      registration({ attendance_status: "pending", checked_in_at: null }),
      SESSIONS
    );
    expect(row[7]).toBe("Không");
    expect(row[8]).toBe("");
  });

  it("buổi đơn lẻ thì cột Buổi để trống", () => {
    const solo = new Map<string, ExportSession>([
      ["e9", { id: "e9", seriesIndex: null, startsAt: "2026-09-20T01:00:00.000Z" }]
    ]);
    const row = eventRegistrationRow(registration({ event_id: "e9" }), solo);
    expect(row[0]).toBe("");
  });
});

describe("ô do người ngoài tự gõ không được phá bảng", () => {
  it("ô bắt đầu bằng dấu bằng KHÔNG thành công thức trong Excel", () => {
    const csv = buildEventRegistrationCsv(
      [registration({ notes: '=HYPERLINK("http://xau.example","bấm vào đây")' })],
      SESSIONS
    );
    // Dấu nháy đơn đứng trước buộc Excel đọc ô đó là chữ.
    expect(csv).toContain(`"'=HYPERLINK`);
    expect(csv).not.toContain(`"=HYPERLINK`);
  });

  it("các ký tự mở đầu nguy hiểm khác cũng bị vô hiệu", () => {
    for (const lead of ["=", "+", "-", "@"]) {
      const csv = buildEventRegistrationCsv(
        [registration({ notes: `${lead}cmd|' /c calc'!A1` })],
        SESSIONS
      );
      expect(csv, lead).toContain(`"'${lead}cmd`);
    }
  });

  it("dấu xuống dòng trong ghi chú không tách thành dòng mới", () => {
    const csv = buildEventRegistrationCsv(
      [registration({ notes: "dòng một\ndòng hai\r\ndòng ba" })],
      SESSIONS
    );
    // Một dòng tiêu đề, một dòng dữ liệu. Không hơn.
    expect(csv.split("\n")).toHaveLength(2);
  });

  it("dấu phẩy và dấu nháy kép trong tên không đẩy lệch cột", () => {
    const csv = buildEventRegistrationCsv(
      [registration({ full_name: 'Nguyễn "Bé" A, Jr' })],
      SESSIONS
    );
    const dataRow = csv.split("\n")[1];
    // Đếm ô bằng cách tách theo dấu phẩy NGOÀI cặp nháy.
    const cells = dataRow.match(/"(?:[^"]|"")*"/g) ?? [];
    expect(cells).toHaveLength(EVENT_EXPORT_HEADERS.length);
    expect(dataRow).toContain('""Bé""');
  });
});

describe("tên file tải về", () => {
  it("có tên sự kiện và ngày, để ba buổi không cùng một tên", () => {
    const name = exportFileName("Mentor Orientation", "2026-09-20T01:00:00.000Z");
    expect(name).toBe("dang-ky_mentor-orientation_20-09-2026.csv");
  });

  it("bỏ dấu tiếng Việt và chữ đ", () => {
    // Tên file mang dấu tổ hợp là tên file hỏng trên máy khác, hoặc mở ra thành
    // một dãy ký tự lạ.
    const name = exportFileName("Định hướng Mentee", "2026-09-20T01:00:00.000Z");
    expect(name).toContain("dinh-huong-mentee");
    expect(name).toMatch(/^[a-z0-9._-]+$/);
  });

  it("ký tự Windows không nhận trong tên file bị loại hết", () => {
    const name = exportFileName('Sự kiện / thử: "A" \\ B *?', "2026-09-20T01:00:00.000Z");
    expect(name).toMatch(/^[a-z0-9._-]+$/);
  });

  it("thiếu tên hoặc thiếu ngày vẫn ra một tên dùng được", () => {
    expect(exportFileName(null, null)).toMatch(/^[a-z0-9._-]+\.csv$/);
    expect(exportFileName("", "")).toMatch(/^[a-z0-9._-]+\.csv$/);
  });
});

describe("bảng hoàn chỉnh", () => {
  it("dòng đầu là tiêu đề cột", () => {
    const csv = buildEventRegistrationCsv([registration()], SESSIONS);
    const header = csv.split("\n")[0];
    for (const column of EVENT_EXPORT_HEADERS) {
      expect(header, column).toContain(column);
    }
  });

  it("không có đăng ký nào thì vẫn ra bảng có tiêu đề", () => {
    // Một file rỗng hoàn toàn trông như một lần tải về hỏng.
    const csv = buildEventRegistrationCsv([], SESSIONS);
    expect(csv.split("\n")).toHaveLength(1);
    expect(csv).toContain("Họ và tên");
  });
});
