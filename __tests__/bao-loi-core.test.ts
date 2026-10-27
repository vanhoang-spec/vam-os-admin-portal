/**
 * Báo lỗi — phần thuần (lib/bao-loi-core.ts). Chủ chương trình 27/10/2026.
 *
 * Trọng tâm: mọi thứ trình duyệt gửi lên là thứ người gửi tự đặt được. Đường dẫn ảnh phải nằm đúng thư
 * mục của CHÍNH người gửi (nếu không, gắn được ảnh người khác rồi đọc qua link ký sẵn); trang đang mở
 * chỉ nhận đường dẫn nội bộ; thông tin máy chỉ giữ khoá đã biết.
 */
import { describe, expect, it } from "vitest";
import {
  chuanMaBaoLoi,
  duongDanAnhMoi,
  gonTrang,
  gonThietBi,
  kiemBaoLoiMoi,
  kiemBoSung,
  kiemCauHoi,
  laAnhCuaNguoiGui,
  vaCapNhat
} from "@/lib/bao-loi-core";

const TOI = "11111111-1111-4111-8111-111111111111";
const NGUOI_KHAC = "22222222-2222-4222-8222-222222222222";
const ANH = "33333333-3333-4333-8333-333333333333";
const anhCua = (id: string) => duongDanAnhMoi(id, ANH);

describe("đường dẫn ảnh", () => {
  it("chỉ nhận ảnh trong thư mục của chính người gửi, tên uuid, đuôi jpg", () => {
    expect(laAnhCuaNguoiGui(TOI, anhCua(TOI))).toBe(true);
    expect(laAnhCuaNguoiGui(TOI, anhCua(NGUOI_KHAC))).toBe(false);
    expect(laAnhCuaNguoiGui(TOI, `${TOI}/../${NGUOI_KHAC}/${ANH}.jpg`)).toBe(false);
    expect(laAnhCuaNguoiGui(TOI, `${TOI}/${ANH}.png`)).toBe(false);
    expect(laAnhCuaNguoiGui(TOI, `${TOI}/${ANH}xjpg`)).toBe(false);
    expect(laAnhCuaNguoiGui("khong-phai-uuid", `khong-phai-uuid/${ANH}.jpg`)).toBe(false);
  });
});

describe("kiemBaoLoiMoi", () => {
  const hopLe = { loai: "de_xuat", tieuDe: "  Thêm   nút xuất Excel  ", noiDung: "Mong có nút xuất\r\nExcel", trang: "/mentees?season=S12", anh: [anhCua(TOI)] };

  it("báo lỗi hợp lệ: gọn tiêu đề, giữ trang nội bộ", () => {
    const kq = kiemBaoLoiMoi(TOI, hopLe);
    expect(kq).toEqual({
      ok: true,
      value: { loai: "de_xuat", tieuDe: "Thêm nút xuất Excel", noiDung: "Mong có nút xuất\nExcel", trang: "/mentees?season=S12", anh: [anhCua(TOI)], thietBi: {} }
    });
  });

  it("từ chối ảnh của người khác, quá 5 ảnh, ảnh trùng", () => {
    expect(kiemBaoLoiMoi(TOI, { ...hopLe, anh: [anhCua(NGUOI_KHAC)] }).ok).toBe(false);
    expect(kiemBaoLoiMoi(TOI, { ...hopLe, anh: Array(6).fill(anhCua(TOI)) }).ok).toBe(false);
    expect(kiemBaoLoiMoi(TOI, { ...hopLe, anh: [anhCua(TOI), anhCua(TOI)] }).ok).toBe(false);
  });

  it("từ chối loại lạ (kể cả 'luong'), tiêu đề quá ngắn, mô tả quá dài", () => {
    expect(kiemBaoLoiMoi(TOI, { ...hopLe, loai: "luong" }).ok).toBe(false);
    expect(kiemBaoLoiMoi(TOI, { ...hopLe, tieuDe: " ab " }).ok).toBe(false);
    expect(kiemBaoLoiMoi(TOI, { ...hopLe, noiDung: "x".repeat(4001) }).ok).toBe(false);
  });

  it("trang ngoài (link tuyệt đối, //host) bị bỏ, không lưu", () => {
    for (const trang of ["https://evil.example/x", "//evil.example/x", "javascript:alert(1)"]) {
      const kq = kiemBaoLoiMoi(TOI, { ...hopLe, trang });
      expect(kq.ok && kq.value.trang).toBeNull();
    }
  });

  it("thông tin máy chỉ giữ khoá đã biết, cắt chuỗi dài", () => {
    expect(gonThietBi({ ua: "x".repeat(400), dpr: 2, ngoai_tuyen: false, mat_khau: "bí mật", khung: { a: 1 } })).toEqual({ ua: "x".repeat(300), dpr: 2, ngoai_tuyen: false });
  });
});

describe("kiemBoSung / kiemCauHoi / chuanMaBaoLoi", () => {
  it("bổ sung cần chữ hoặc hình; hình phải của chính người gửi", () => {
    expect(kiemBoSung(TOI, { noiDung: "  ", anh: [] }).ok).toBe(false);
    expect(kiemBoSung(TOI, { noiDung: "", anh: [anhCua(TOI)] })).toEqual({ ok: true, value: { noiDung: "", anh: [anhCua(TOI)] } });
    expect(kiemBoSung(TOI, { noiDung: "PT104390", anh: [anhCua(NGUOI_KHAC)] }).ok).toBe(false);
  });

  it("câu hỏi ít nhất 3 chữ", () => {
    expect(kiemCauHoi(" ab ").ok).toBe(false);
    expect(kiemCauHoi("Bạn chụp màn hình giúp nhé?")).toEqual({ ok: true, value: "Bạn chụp màn hình giúp nhé?" });
  });

  it("mã báo lỗi: viết thường vẫn nhận, sai dạng thì null", () => {
    expect(chuanMaBaoLoi(" vam00012 ")).toBe("VAM00012");
    expect(chuanMaBaoLoi("CRM00012")).toBeNull();
    expect(chuanMaBaoLoi("VAM0001")).toBeNull();
  });
});

describe("vaCapNhat", () => {
  const NOW = "2026-10-27T13:00:00.000Z";
  const cu = { trang_thai: "dang_xu_ly" as const, tra_loi: null, dong_luc: null };

  it("trả lời mới → ghi giờ trả lời, xoá 'đã xem' để người gửi thấy pop-up; đóng → ghi giờ đóng", () => {
    const p = vaCapNhat(cu, { trangThai: "da_xu_ly", traLoi: "Đã sửa", ghiChu: null, trungVoiId: undefined }, "admin", NOW);
    expect(p).toEqual({ trang_thai: "da_xu_ly", xu_ly_boi: "admin", cap_nhat_luc: NOW, tra_loi: "Đã sửa", tra_loi_luc: NOW, da_xem_luc: null, dong_luc: NOW });
  });

  it("không đổi trả lời / ghi chú (null) thì không chạm các cột đó; mở lại thì xoá giờ đóng", () => {
    const p = vaCapNhat({ trang_thai: "da_xu_ly", tra_loi: "Đã sửa", dong_luc: "2026-10-26T00:00:00.000Z" }, { trangThai: "dang_xu_ly", traLoi: null, ghiChu: null, trungVoiId: undefined }, "admin", NOW);
    expect(p).toEqual({ trang_thai: "dang_xu_ly", xu_ly_boi: "admin", cap_nhat_luc: NOW, dong_luc: null });
  });

  it("trả lời giữ nguyên chữ cũ thì không bắt người gửi xem lại", () => {
    const p = vaCapNhat({ trang_thai: "da_xu_ly", tra_loi: "Đã sửa", dong_luc: NOW }, { trangThai: "da_xu_ly", traLoi: "Đã sửa", ghiChu: null, trungVoiId: undefined }, "admin", NOW);
    expect(p).not.toHaveProperty("da_xem_luc");
    expect(p.dong_luc).toBe(NOW);
  });
});

describe("gonTrang", () => {
  it("bỏ ?query để gom cùng trang", () => {
    expect(gonTrang("/mentees?season=S12")).toBe("/mentees");
    expect(gonTrang(null)).toBe("(không rõ)");
  });
});
